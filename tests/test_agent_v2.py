import gzip
import hashlib
import importlib.util
import io
import json
import math
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from urllib.error import URLError
from urllib.parse import urlparse

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("papertrail_v2", ROOT/"public/agents/papertrail.py")
sdk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sdk)
BENCHMARK = json.loads((ROOT/"tests/agent-benchmark.json").read_text(encoding="utf-8"))
SEED = "dblp:conf/mobicom/GamageLGTL20"


class Static(sdk.PaperTrail):
    def __init__(self, **kwargs):
        self.requests=[]
        super().__init__(base_url="https://papertrail.test/papertrail/", **kwargs)

    def _fetch(self,url):
        path=urlparse(url).path.removeprefix("/papertrail/")
        data=(ROOT/"public"/path).read_bytes()
        self.requests.append({"path":path,"bytes":len(data)})
        return data


class AgentV2Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.api=sdk.PaperTrail(ROOT/"work/agent-api/papertrail.sqlite")
        cls.static=Static()
        cls.schemas=json.loads((ROOT/"public/api/v2/schemas.json").read_text(encoding="utf-8"))

    @classmethod
    def tearDownClass(cls):
        cls.api.close()

    def schema(self,result):
        schema={"$defs":self.schemas["$defs"],"$ref":"#/$defs/"+result["operation"]+"Result"}
        Draft202012Validator(schema).validate(result)

    def test_real_author_identity_task_and_cost(self):
        cold=Static(); started=time.monotonic()
        candidates=cold.authors("Mo Li",affiliation="HKUST")
        self.assertEqual([a["id"] for a in candidates["items"]],[BENCHMARK["identity"]])
        works=cold.author_papers(candidates["items"][0]["id"],limit=100)
        expected=set(BENCHMARK["expectedPaperIds"])
        self.assertEqual({p["id"] for p in works["items"]},expected)
        self.assertTrue(all(p["matchEvidence"]["associationStatus"]=="upstream_identifier" for p in works["items"]))
        self.assertEqual({p["id"] for p in self.api.author_papers(BENCHMARK["identity"],limit=100)["items"]},expected)
        self.assertEqual(self.api.authors("Li, Mo",affiliation="HKUST")["items"][0]["id"],BENCHMARK["identity"])
        partial=self.api.authors("Li Mo",affiliation="HKUST",match="all_tokens")["items"][0]
        self.assertTrue(partial["matchEvidence"]["matchedVariants"])
        self.assertEqual(self.api.authors("Mo Li",affiliation="unrecorded-institution")["items"],[])
        self.assertFalse(any("sqlite" in r["path"] for r in cold.requests))
        self.assertLess(sum(r["bytes"] for r in cold.requests),15_000_000)
        report={"task":BENCHMARK["task"],"snapshotId":cold.snapshot_id,"matchedPaperCount":len(expected),"expectedPaperCount":len(expected),"precision":1,"recall":1,"latencySeconds":round(time.monotonic()-started,3),"requestCount":len(cold.requests),"downloadBytes":sum(r["bytes"] for r in cold.requests),"sqliteDownloaded":False,"requests":cold.requests}
        (ROOT/"work/agent-api/benchmark-results.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
        self.schema(candidates);self.schema(works)

    def test_whole_author_matching_and_explicit_fields(self):
        result=self.api.search("Mo Li",fields=["authors"],match="exact_name",venue="infocom",limit=100)
        self.assertEqual({p["id"] for p in result["items"]},{id for id in BENCHMARK["expectedPaperIds"] if "/infocom/" in id})
        self.assertTrue(all("Mo Li" in p["authors"] for p in result["items"]))
        false={"title":"Mo Li systems","topics":[],"authors":["Jiamo Liu","Mo Wang","Jie Li"]}
        self.assertIsNone(sdk.matching(false,"Mo Li",["authors"],"all_tokens"))
        self.assertIsNone(sdk.matching({**false,"title":"Mo systems"},"Mo Li",["title","authors"],"all_tokens"))
        with self.assertRaises(sdk.PaperTrailError):self.api.search("learning",fields=[])
        with self.assertRaises(sdk.PaperTrailError):self.api.search("Mo Li",match="exact_name")
        with self.assertRaises(sdk.PaperTrailError):self.api.search("learning",from_year=2025,to_year=2020)
        with self.assertRaises(sdk.PaperTrailError):self.api.search("learning",venue="unknown")

    def test_transport_equivalence_and_cross_transport_cursor(self):
        cases={}
        for name,q,args in [("topics","federated learning",{"venue":"infocom","limit":3}), ("authors","Mo Li",{"venue":"infocom","fields":["authors"],"match":"exact_name","limit":3}), ("phrase","federated learning",{"venue":"infocom","fields":["title"],"match":"exact_phrase","limit":3}), ("projection","wireless",{"venue":"infocom","limit":3,"select":["id","title"]})]:
            result=self.api.search(q,**args)
            self.assertEqual(result,self.static.search(q,**args));self.schema(result)
            cases[name] = result
        first=cases["topics"]
        second=self.static.search("federated learning",venue="infocom",limit=3,cursor=first["pagination"]["nextCursor"])
        self.assertFalse({p["id"] for p in first["items"]}&{p["id"] for p in second["items"]})
        with self.assertRaises(sdk.PaperTrailError) as error:self.static.search("wireless",venue="infocom",cursor=first["pagination"]["nextCursor"])
        self.assertEqual(error.exception.error["code"],"CURSOR_MISMATCH")
        with self.assertRaises(sdk.PaperTrailError):self.static.search("federated learning",venue="infocom",select=["id"],cursor=first["pagination"]["nextCursor"])
        for cursor in ("", "W10", "bnVsbA", "MQ"):
            with self.assertRaises(sdk.PaperTrailError) as error:self.static.search("federated learning",venue="infocom",cursor=cursor)
            self.assertEqual(error.exception.error["code"],"INVALID_CURSOR")
        cases["people"]=self.static.authors("Mo Li",affiliation="HKUST")
        cases["works"]=self.static.author_papers(BENCHMARK["identity"],limit=5)
        cases["paper"]=self.static.paper(SEED)
        cases["references"]=self.static.references(SEED,limit=3,expand=True)
        cases["cited_by"]=self.static.cited_by(SEED,limit=3,expand=True)
        cases["text"]=self.static.related(SEED,limit=3)
        for result in cases.values():self.schema(result)
        (ROOT/"work/agent-api/transport-fixtures.json").write_text(json.dumps(cases,ensure_ascii=False),encoding="utf-8")

    def test_resolution_states_batch_projection_and_counts(self):
        seed=self.api.paper(SEED)["items"][0]
        self.assertEqual(seed,self.static.paper(SEED)["items"][0])
        self.assertEqual(self.api.paper(seed["doi"])["items"][0]["id"],SEED)
        refs=self.api.references(SEED,limit=1000,expand=True)
        external=next(p for p in refs["items"] if p["resolutionState"]=="external_reference")
        self.assertEqual(external["resolutionState"],self.static.paper(external["id"])["items"][0]["resolutionState"])
        batch=self.api.papers([SEED,external["id"],"10.0000/absent-papertrail"],fields=["id","title"])
        self.assertEqual([p["resolutionState"] for p in batch["items"]],["resolved","external_reference","not_in_snapshot"])
        self.assertNotIn("authors",batch["items"][0]);self.schema(batch)
        with self.assertRaises(sdk.PaperTrailError) as error:self.api.paper("not-an-id")
        self.assertEqual(error.exception.error["code"],"INVALID_IDENTIFIER")
        counts=seed["counts"]
        self.assertEqual(refs["pagination"]["total"],counts["recordedReferenceCount"])
        self.assertEqual(self.api.cited_by(SEED)["pagination"]["total"],counts["incomingCorpusCitationCount"])
        self.assertNotEqual(counts["upstreamCitationCount"],counts["incomingCorpusCitationCount"])
        for edge in refs["items"]:
            self.assertEqual(edge["relationship"]["source"],SEED)
            self.assertEqual(edge["relationship"]["target"],edge["id"])
            self.assertTrue(edge["relationship"]["sources"])
        unknown=self.api.db.execute("SELECT id FROM papers WHERE json_extract(metadata,'$.relationshipStatus.references')='unknown' LIMIT 1").fetchone()[0]
        unknown_result=self.api.references(unknown)
        self.assertEqual(unknown_result["relationshipStatus"],"unknown")
        self.assertIn("RELATIONSHIP_DATA_UNKNOWN",unknown_result["warnings"])
        self.schema(unknown_result)

    def test_related_witnesses_normalization_and_graph_bounds(self):
        seed=self.api.paper(SEED)["items"][0]
        for method, count_field in [("coupling","recordedReferenceCount"),("cocitation","incomingCorpusCitationCount")]:
            result=self.api.related(SEED,method=method,limit=3);self.schema(result)
            for p in result["items"]:
                ev=p["matchEvidence"]
                self.assertAlmostEqual(ev["normalizedScore"],ev["sharedCount"]/math.sqrt(seed["counts"][count_field]*p["counts"][count_field]))
                self.assertTrue(ev["sharedIdentifiers"])
                incoming=method=="cocitation"
                fn=self.api.cited_by if incoming else self.api.references
                neighbors={p["id"] for p in fn(p["id"],limit=1000)["items"]}
                seed_neighbors={p["id"] for p in fn(SEED,limit=1000)["items"]}
                self.assertTrue(set(ev["sharedIdentifiers"])<=neighbors&seed_neighbors)
                self.assertEqual(ev["sharedCount"],len(neighbors&seed_neighbors))
        result=self.api.graph(SEED,depth=2,max_nodes=3,max_edges=2);self.schema(result)
        self.assertLessEqual(len(result["items"]),3);self.assertLessEqual(len(result["edges"]),2)
        self.assertTrue(result["truncated"]);self.assertTrue(result["truncationReasons"])
        self.schema(self.api.status());self.schema(self.api.warm_cache())
        self.assertEqual(self.api.status()["items"][0]["capabilities"],self.static.manifest["capabilities"]["python"])

    def test_mcp_discovery_offline_and_structured_errors(self):
        messages=[{"id":1,"method":"initialize"},{"id":2,"method":"tools/list"},{"id":3,"method":"tools/call","params":{"name":"unknown"}}]
        def run(args,messages):
            done=subprocess.run([sys.executable,str(ROOT/"public/agents/papertrail.py"),"mcp",*args],input="\n".join(json.dumps(m) for m in messages)+"\n",text=True,encoding="utf-8",capture_output=True,timeout=10,check=True)
            return [json.loads(line) for line in done.stdout.splitlines()]
        results=run(["--base-url","http://127.0.0.1:1/"],messages)
        self.assertEqual(len(results[1]["result"]["tools"]),11)
        self.assertEqual(json.loads(results[2]["result"]["content"][0]["text"])["error"]["code"],"UNKNOWN_TOOL")
        done=run(["--db",str(ROOT/"work/agent-api/papertrail.sqlite")],[{"id":1,"method":"tools/call","params":{"name":"authors","arguments":{"name":"Mo Li","affiliation":"HKUST"}}},{"id":2,"method":"tools/call","params":{"name":"references","arguments":{"id":SEED,"expand":"yes"}}}])
        self.assertEqual(json.loads(done[0]["result"]["content"][0]["text"])["items"][0]["id"],BENCHMARK["identity"])
        error=json.loads(done[1]["result"]["content"][0]["text"])
        Draft202012Validator({"$defs":self.schemas["$defs"],"$ref":"#/$defs/Error"}).validate(error)


class CacheV2Tests(unittest.TestCase):
    def test_resumed_transfer_checksums_and_reuse(self):
        with tempfile.TemporaryDirectory() as temp:
            client=Static(cache_dir=Path(temp)/"cache")
            database=Path(temp)/"fixture.sqlite";db=sqlite3.connect(database)
            db.execute("CREATE TABLE metadata(key TEXT,value TEXT)")
            db.execute("INSERT INTO metadata VALUES('snapshotId',?)",(json.dumps(client.snapshot_id),));db.commit();db.close()
            raw=database.read_bytes();compressed=gzip.compress(raw); halfway=len(compressed)//2
            client.manifest["database"]={"url":"fixture.gz","bytes":len(compressed),"sha256":hashlib.sha256(compressed).hexdigest(),"uncompressedBytes":len(raw),"uncompressedSha256":hashlib.sha256(raw).hexdigest()}
            requests=[]
            class Response(io.BytesIO):
                def __init__(self,data,status,broken=False):super().__init__(data);self.status=status;self.broken=broken;self.reads=0
                def read(self,size=-1):
                    self.reads+=1
                    if self.broken and self.reads>1:raise URLError("interrupted")
                    return super().read(size)
            def fetch(request,timeout):
                requests.append(dict(request.header_items()))
                return Response(compressed[:halfway],200,True) if len(requests)==1 else Response(compressed[halfway:],206)
            with patch.object(sdk,"urlopen",side_effect=fetch),patch.object(sdk.time,"sleep"):
                self.assertTrue(client.warm_cache()["items"][0]["cacheReady"])
            self.assertEqual(requests[1].get("Range"),f"bytes={halfway}-")
            client.close()
            with patch.object(sdk,"urlopen",side_effect=AssertionError("cache must be reused")):
                client.warm_cache()
            client.close()
            client.path.write_bytes(b"corrupt")
            with patch.object(sdk,"urlopen",return_value=Response(compressed,200)):
                client.warm_cache()
            self.assertEqual(sdk.sha(client.path),hashlib.sha256(raw).hexdigest());client.close()


if __name__=="__main__":unittest.main()
