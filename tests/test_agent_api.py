import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("papertrail", ROOT / "public/agents/papertrail-v1.py")
sdk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sdk)


class AgentApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.api = sdk.PaperTrail(ROOT / "work/agent-api/papertrail.sqlite")
        cls.manifest = json.loads((ROOT / "public/api/v1/manifest.json").read_text(encoding="utf-8"))

    @classmethod
    def tearDownClass(cls):
        cls.api.close()

    def test_full_snapshot_counts_and_indexes(self):
        self.assertEqual(self.api.metadata["stats"], self.manifest["stats"])
        self.assertEqual(self.api.db.execute("SELECT COUNT(*) FROM papers").fetchone()[0], self.manifest["stats"]["papers"])
        self.assertEqual(self.api.db.execute("SELECT COUNT(*) FROM edges").fetchone()[0], self.manifest["stats"]["citationEdges"])
        self.assertEqual(self.api.db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        self.assertEqual(self.api.db.execute("PRAGMA foreign_key_check").fetchall(), [])
        self.assertIn("edges_target", [row[1] for row in self.api.db.execute("PRAGMA index_list(edges)")])

    def test_search_filters_pagination_and_escaping(self):
        first = self.api.search("federated learning", venue="infocom", to_year=2024, limit=3)
        second = self.api.search("federated learning", venue="infocom", to_year=2024, limit=3, offset=3)
        self.assertGreater(first["total"], 6)
        self.assertTrue(all(p["venueId"] == "infocom" and p["year"] <= 2024 for p in first["papers"]))
        self.assertFalse({p["id"] for p in first["papers"]} & {p["id"] for p in second["papers"]})
        self.assertEqual(self.api.search('" OR 1=1; DROP TABLE papers --', limit=1)["total"], 0)
        with self.assertRaises(ValueError):
            self.api.search("", limit=1)
        with self.assertRaises(ValueError):
            self.api.search("learning", limit=101)

    def test_aliases_and_bidirectional_edges_have_source_evidence(self):
        record = self.api.paper("https://doi.org/10.1038/NCOMMS9959")
        self.assertEqual(record["id"], self.api.paper("doi:10.1038/ncomms9959")["id"])
        if record["openAlexId"]:
            self.assertEqual(record["id"], self.api.paper(record["openAlexId"])["id"])
        refs = self.api.references(record["id"], limit=1000)
        self.assertGreater(refs["total"], 0)
        target = refs["papers"][0]
        citing = self.api.cited_by(target["id"], limit=1000)
        self.assertIn(record["id"], [paper["id"] for paper in citing["papers"]])
        self.assertTrue(target["edgeSources"])
        external = next(p for p in refs["papers"] if p["external"])
        self.assertIsNone(external["title"])
        self.assertFalse(external["metadataAvailable"])
        self.assertEqual(self.api.references(record["id"], limit=3, offset=3)["total"], refs["total"])

    def test_related_counts_match_independent_sql(self):
        seed = self.api.paper("10.1038/ncomms9959")
        related = self.api.related(seed["id"], method="coupling", limit=3)
        self.assertTrue(related["papers"])
        source = self.api._node(seed["id"])
        for result in related["papers"]:
            candidate = self.api._node(result["id"])
            actual = self.api.db.execute("SELECT COUNT(*) FROM edges a JOIN edges b ON a.target=b.target WHERE a.source=? AND b.source=?", (source, candidate)).fetchone()[0]
            self.assertEqual(result["sharedCount"], actual)
            self.assertNotEqual(result["id"], seed["id"])
        for result in self.api.related(seed["id"], method="cocitation", limit=3)["papers"]:
            candidate = self.api._node(result["id"])
            actual = self.api.db.execute("SELECT COUNT(*) FROM edges a JOIN edges b ON a.source=b.source WHERE a.target=? AND b.target=?", (source, candidate)).fetchone()[0]
            self.assertEqual(result["sharedCount"], actual)
        self.assertTrue(self.api.related(seed["id"], method="text", limit=3)["papers"])

    def test_graph_cap_and_direction(self):
        result = self.api.graph("10.1038/ncomms9959", direction="references", depth=1, max_nodes=4, max_edges=2)
        self.assertLessEqual(len(result["nodes"]), 4)
        self.assertLessEqual(len(result["edges"]), 2)
        self.assertTrue(result["truncated"])
        nodes = {paper["id"] for paper in result["nodes"]}
        for edge in result["edges"]:
            self.assertEqual(edge["source"], result["root"])
            self.assertIn(edge["target"], nodes)
            self.assertTrue(edge["sources"])
        with self.assertRaises(KeyError):
            self.api.paper("doi:10.0000/unknown-papertrail")

    def test_static_graph_matches_database(self):
        lookup = json.loads((ROOT / "public/api/v1/lookup.json").read_text(encoding="utf-8"))["identifiers"]
        canonical = lookup["doi:10.1038/ncomms9959"]
        bucket = hashlib.sha256(canonical.encode()).hexdigest()[:2]
        entry = json.loads(gzip.decompress((ROOT / f"public/api/v1/graph/{bucket}.json.gz").read_bytes()))["papers"][canonical]
        self.assertEqual({r["id"] for r in entry["references"]}, {r["id"] for r in self.api.references(canonical, limit=1000)["papers"]})
        self.assertEqual(len(entry["citedBy"]), self.api.cited_by(canonical)["total"])

    def test_mcp_initialization_tools_execution_and_errors(self):
        messages = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05"}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
            {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "search", "arguments": {"q": "federated learning", "venue": "infocom", "limit": 1}}},
            {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "paper", "arguments": {"id": "unknown"}}},
            {"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {"name": "close", "arguments": {}}},
        ]
        completed = subprocess.run([sys.executable, str(ROOT / "public/agents/papertrail-v1.py"), "mcp", "--db", str(ROOT / "work/agent-api/papertrail.sqlite")], input="\n".join(json.dumps(m) for m in messages) + "\n", text=True, encoding="utf-8", capture_output=True, check=True, timeout=30)
        responses = [json.loads(line) for line in completed.stdout.splitlines()]
        self.assertEqual(len(responses), 5)
        self.assertEqual(len(responses[1]["result"]["tools"]), 6)
        self.assertFalse(responses[2]["result"]["isError"])
        self.assertTrue(responses[3]["result"]["isError"])
        self.assertIn("error", responses[4])


class DownloadTests(unittest.TestCase):
    def test_download_verifies_integrity_and_reuses_cache(self):
        with tempfile.TemporaryDirectory() as temp:
            database = Path(temp) / "fixture.sqlite"
            db = sqlite3.connect(database)
            db.execute("CREATE TABLE metadata(key TEXT,value TEXT)")
            db.execute("INSERT INTO metadata VALUES('schemaVersion','1')")
            db.commit(); db.close()
            data = database.read_bytes()
            compressed = gzip.compress(data)
            manifest = {"schemaVersion": 1, "database": {"url": "fixture.sqlite.gz", "bytes": len(compressed), "sha256": hashlib.sha256(compressed).hexdigest(), "uncompressedBytes": len(data), "uncompressedSha256": hashlib.sha256(data).hexdigest()}}
            requests = []

            def fetch(url, timeout):
                requests.append(url)
                return io.BytesIO(json.dumps(manifest).encode() if url.endswith("manifest.json") else compressed)

            with patch.object(sdk, "urlopen", fetch):
                first = sdk.PaperTrail(base_url="https://example.test/papertrail/", cache_dir=Path(temp) / "cache")
                first.close()
                second = sdk.PaperTrail(base_url="https://example.test/papertrail/", cache_dir=Path(temp) / "cache")
                second.close()
            self.assertEqual(sum(url.endswith(".gz") for url in requests), 1)
            manifest["database"]["sha256"] = "bad"
            with patch.object(sdk, "urlopen", fetch), self.assertRaises(ValueError):
                sdk.PaperTrail(base_url="https://example.test/", cache_dir=Path(temp) / "corrupt")


if __name__ == "__main__":
    unittest.main()
