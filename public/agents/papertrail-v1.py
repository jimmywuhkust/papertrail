"""PaperTrail v1: dependency-free Python SDK, CLI and MCP stdio server. MIT."""
import argparse
from collections import deque
import gzip
import hashlib
import json
from pathlib import Path
import re
import shutil
import sqlite3
import sys
import tempfile
from urllib.parse import urljoin
from urllib.request import urlopen

DEFAULT_BASE = "https://jimmywuhkust.github.io/papertrail/"


def normalize(identifier):
    raw = str(identifier).strip()
    if raw.startswith("https://openalex.org/"):
        return "oa:" + raw.rsplit("/", 1)[-1].upper()
    if re.fullmatch(r"W\d+", raw, re.I):
        return "oa:" + raw.upper()
    if raw.startswith("oa:"):
        return "oa:" + raw[3:].upper()
    doi = re.sub(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)", "", raw.lower()).strip()
    return "doi:" + doi if doi.startswith("10.") else raw


def bounded(value, maximum=100, minimum=1):
    if isinstance(value, bool) or (isinstance(value, float) and not value.is_integer()):
        raise ValueError("Expected an integer")
    value = int(value)
    if not minimum <= value <= maximum:
        raise ValueError(f"Value must be between {minimum} and {maximum}")
    return value


def checksum(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


class PaperTrail:
    def __init__(self, path=None, base_url=DEFAULT_BASE, cache_dir=None):
        if path is None:
            base_url = base_url.rstrip("/") + "/"
            with urlopen(urljoin(base_url, "api/v1/manifest.json"), timeout=60) as response:
                manifest = json.load(response)
            if manifest["schemaVersion"] != 1:
                raise ValueError("Unsupported PaperTrail schema")
            info = manifest["database"]
            cache = Path(cache_dir or Path.home() / ".cache/papertrail")
            cache.mkdir(parents=True, exist_ok=True)
            path = cache / f"{info['uncompressedSha256']}.sqlite"
            if not path.exists() or checksum(path) != info["uncompressedSha256"]:
                # Unique temporary files make concurrent agents safe. Only verified
                # data is moved into the content-addressed shared cache.
                with tempfile.TemporaryDirectory(dir=cache) as temp:
                    compressed = Path(temp) / "snapshot.gz"
                    with urlopen(urljoin(base_url, "api/v1/" + info["url"]), timeout=60) as response, compressed.open("wb") as target:
                        shutil.copyfileobj(response, target)
                    if compressed.stat().st_size != info["bytes"] or checksum(compressed) != info["sha256"]:
                        raise ValueError("Snapshot download failed integrity verification")
                    extracted = Path(temp) / "snapshot.sqlite"
                    with gzip.open(compressed, "rb") as source, extracted.open("wb") as target:
                        shutil.copyfileobj(source, target)
                    if extracted.stat().st_size != info["uncompressedBytes"] or checksum(extracted) != info["uncompressedSha256"]:
                        raise ValueError("Database failed integrity verification")
                    extracted.replace(path)
        self.db = sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA query_only=ON")
        self.metadata = {row["key"]: json.loads(row["value"]) for row in self.db.execute("SELECT * FROM metadata")}

    def close(self):
        self.db.close()

    def _node(self, identifier):
        key = normalize(identifier)
        row = self.db.execute("SELECT node_id FROM aliases WHERE identifier=? UNION SELECT node_id FROM nodes WHERE id=? LIMIT 1", (key, key)).fetchone()
        if row is None:
            raise KeyError(f"Identifier is outside the snapshot: {identifier}")
        return row[0]

    def _paper(self, number):
        row = self.db.execute("SELECT metadata FROM papers WHERE node_id=?", (number,)).fetchone()
        if row:
            return {**json.loads(row[0]), "external": False}
        node = self.db.execute("SELECT id FROM nodes WHERE node_id=?", (number,)).fetchone()
        return {"id": node[0], "external": True, "title": None, "metadataAvailable": False}

    def paper(self, id):
        return self._paper(self._node(id))

    def search(self, q, venue=None, from_year=None, to_year=None, limit=20, offset=0):
        terms = re.findall(r"\w+", str(q), re.UNICODE)[:30]
        if not terms:
            raise ValueError("q must contain a word")
        expression = " AND ".join('"' + term.replace('"', '""') + '"' for term in terms)
        where = ["papers_fts MATCH ?"]
        params = [expression]
        for column, value, operator in (("venue_id", venue, "="), ("year", from_year, ">="), ("year", to_year, "<=")):
            if value is not None:
                where.append(f"p.{column}{operator}?")
                params.append(value)
        condition = " AND ".join(where)
        total = self.db.execute(f"SELECT COUNT(*) FROM papers_fts JOIN papers p ON p.node_id=papers_fts.rowid WHERE {condition}", params).fetchone()[0]
        rows = self.db.execute(f"SELECT p.metadata,bm25(papers_fts,4,2,1) AS score FROM papers_fts JOIN papers p ON p.node_id=papers_fts.rowid WHERE {condition} ORDER BY score,p.id LIMIT ? OFFSET ?", (*params, bounded(limit), bounded(offset, 1_000_000, 0)))
        return {"papers": [{**json.loads(row[0]), "rank": row[1]} for row in rows], "total": total,
                "offset": int(offset), "snapshot": self.metadata["snapshot"], "ranking": "FTS5 BM25; lower rank is better; title/topics/authors weights 4/2/1; all query words required"}

    def _relationships(self, id, incoming, limit, offset):
        number = self._node(id)
        endpoint, neighbor = ("target", "source") if incoming else ("source", "target")
        limit, offset = bounded(limit, 1000), bounded(offset, 1_000_000, 0)
        total = self.db.execute(f"SELECT COUNT(*) FROM edges WHERE {endpoint}=?", (number,)).fetchone()[0]
        rows = self.db.execute(f"SELECT {neighbor},provenance FROM edges WHERE {endpoint}=? ORDER BY {neighbor} LIMIT ? OFFSET ?", (number, limit, offset))
        return {"papers": [{**self._paper(row[0]), "edgeSources": self._provenance(row[1])} for row in rows],
                "total": total, "offset": offset, "hasMore": offset + limit < total,
                "direction": "cited_by" if incoming else "references", "scope": "snapshot corpus sources; external targets may lack metadata"}

    @staticmethod
    def _provenance(mask):
        return [name for bit, name in ((1, "OpenAlex"), (2, "Crossref")) if mask & bit]

    def references(self, id, limit=100, offset=0):
        return self._relationships(id, False, limit, offset)

    def cited_by(self, id, limit=100, offset=0):
        return self._relationships(id, True, limit, offset)

    def related(self, id, method="coupling", limit=20):
        number, limit = self._node(id), bounded(limit)
        if method == "text":
            paper = self._paper(number)
            if paper["external"]:
                raise ValueError("Text similarity requires a corpus paper")
            words = re.findall(r"\w+", paper["title"])[:20]
            expression = " OR ".join('"' + word + '"' for word in words)
            rows = self.db.execute("SELECT p.node_id,bm25(papers_fts,4,2,1) AS score FROM papers_fts JOIN papers p ON p.node_id=papers_fts.rowid WHERE papers_fts MATCH ? AND p.node_id<>? ORDER BY score,p.id LIMIT ?", (expression, number, limit))
            return {"papers": [{**self._paper(row[0]), "rank": row[1], "reason": "Title-word overlap (BM25), not a citation"} for row in rows], "method": method}
        if method not in ("coupling", "cocitation"):
            raise ValueError("method must be coupling, cocitation or text")
        if method == "coupling":
            sql = """SELECT b.source,COUNT(*) AS shared FROM edges a JOIN edges b ON a.target=b.target
                JOIN papers p ON p.node_id=b.source WHERE a.source=? AND b.source<>?
                GROUP BY b.source ORDER BY shared DESC,p.id LIMIT ?"""
            reason = "Shared recorded references (bibliographic coupling), not a direct citation"
        else:
            sql = """SELECT b.target,COUNT(*) AS shared FROM edges a JOIN edges b ON a.source=b.source
                JOIN papers p ON p.node_id=b.target WHERE a.target=? AND b.target<>?
                GROUP BY b.target ORDER BY shared DESC,p.id LIMIT ?"""
            reason = "Cited together by corpus papers (co-citation), not a direct citation"
        rows = self.db.execute(sql, (number, number, limit))
        return {"papers": [{**self._paper(row[0]), "sharedCount": row[1], "reason": reason} for row in rows],
                "method": method, "scope": "snapshot corpus; raw shared counts favor papers with longer reference lists"}

    def graph(self, id, direction="both", depth=2, max_nodes=100, max_edges=500):
        if direction not in ("references", "cited_by", "both"):
            raise ValueError("Invalid direction")
        depth, max_nodes, max_edges = bounded(depth, 3), bounded(max_nodes, 500), bounded(max_edges, 5000)
        root = self._node(id)
        nodes, edges, queue, truncated = {root: self._paper(root)}, {}, deque([(root, 0)]), False
        while queue:
            number, level = queue.popleft()
            if level >= depth:
                continue
            condition = {"references": "source=?", "cited_by": "target=?", "both": "source=? OR target=?"}[direction]
            params = (number, number) if direction == "both" else (number,)
            for source, target, provenance in self.db.execute(f"SELECT source,target,provenance FROM edges WHERE {condition} ORDER BY source,target", params):
                if (source, target) in edges:
                    continue
                if len(edges) >= max_edges:
                    truncated = True
                    break
                missing = [node for node in (source, target) if node not in nodes]
                if len(nodes) + len(set(missing)) > max_nodes:
                    truncated = True
                    continue
                for node in set(missing):
                    nodes[node] = self._paper(node)
                    queue.append((node, level + 1))
                edges[(source, target)] = {"source": nodes[source]["id"], "target": nodes[target]["id"], "kind": "cites", "sources": self._provenance(provenance)}
        return {"root": nodes[root]["id"], "nodes": list(nodes.values()), "edges": list(edges.values()),
                "depth": depth, "direction": direction, "truncated": truncated, "scope": "bounded snapshot neighborhood; edge source cites edge target"}


TOOLS = [
    {"name": "search", "description": "Search paper titles, topics and authors in the PaperTrail snapshot.", "inputSchema": {"type": "object", "properties": {"q": {"type": "string"}, "venue": {"type": "string"}, "from_year": {"type": "integer"}, "to_year": {"type": "integer"}, "limit": {"type": "integer", "minimum": 1, "maximum": 100}, "offset": {"type": "integer", "minimum": 0}}, "required": ["q"], "additionalProperties": False}},
    *[{"name": name, "description": description, "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}, **properties}, "required": ["id"], "additionalProperties": False}} for name, description, properties in [
        ("paper", "Resolve a stable paper id, DOI or OpenAlex identifier.", {}),
        ("references", "Outgoing recorded citations, including identified external targets.", {"limit": {"type": "integer", "minimum": 1, "maximum": 1000}, "offset": {"type": "integer", "minimum": 0}}),
        ("cited_by", "Incoming citations from this corpus only, not global citation counts.", {"limit": {"type": "integer", "minimum": 1, "maximum": 1000}, "offset": {"type": "integer", "minimum": 0}}),
        ("related", "Find inferred similarity by shared references, co-citation, or title overlap.", {"method": {"type": "string", "enum": ["coupling", "cocitation", "text"]}, "limit": {"type": "integer", "minimum": 1, "maximum": 100}}),
        ("graph", "Bounded citation neighborhood; each source cites its target.", {"direction": {"type": "string", "enum": ["references", "cited_by", "both"]}, "depth": {"type": "integer", "minimum": 1, "maximum": 3}, "max_nodes": {"type": "integer", "minimum": 1, "maximum": 500}, "max_edges": {"type": "integer", "minimum": 1, "maximum": 5000}}),
    ]],
]


def mcp(path=None, base_url=DEFAULT_BASE):
    client = None
    for line in sys.stdin:
        message = None
        try:
            message = json.loads(line)
            if "id" not in message:
                continue
            method, params = message.get("method"), message.get("params", {})
            if method == "initialize":
                result = {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}, "serverInfo": {"name": "papertrail", "version": "1.0.0"}}
            elif method == "ping":
                result = {}
            elif method == "tools/list":
                result = {"tools": TOOLS}
            elif method == "tools/call":
                name = params["name"]
                if name not in {tool["name"] for tool in TOOLS}:
                    raise ValueError("Unknown tool")
                try:
                    schema = next(tool["inputSchema"] for tool in TOOLS if tool["name"] == name)
                    arguments = params.get("arguments", {})
                    if not isinstance(arguments, dict) or set(arguments) - set(schema["properties"]):
                        raise ValueError("Unknown tool arguments")
                    if set(schema.get("required", [])) - set(arguments):
                        raise ValueError("Missing required tool arguments")
                    for key, value in arguments.items():
                        rule = schema["properties"][key]
                        if rule["type"] == "string" and not isinstance(value, str):
                            raise ValueError(f"{key} must be a string")
                        if rule["type"] == "integer" and (not isinstance(value, int) or isinstance(value, bool)):
                            raise ValueError(f"{key} must be an integer")
                        if "enum" in rule and value not in rule["enum"]:
                            raise ValueError(f"{key} has an unsupported value")
                        if "minimum" in rule and value < rule["minimum"]:
                            raise ValueError(f"{key} is below its minimum")
                        if "maximum" in rule and value > rule["maximum"]:
                            raise ValueError(f"{key} is above its maximum")
                    client = client or PaperTrail(path=path, base_url=base_url)
                    output = getattr(client, name)(**arguments)
                    result = {"content": [{"type": "text", "text": json.dumps(output, ensure_ascii=False)}], "isError": False}
                except Exception as error:
                    result = {"content": [{"type": "text", "text": str(error)}], "isError": True}
            else:
                print(json.dumps({"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32601, "message": "Method not found"}}), flush=True)
                continue
            print(json.dumps({"jsonrpc": "2.0", "id": message["id"], "result": result}, ensure_ascii=False), flush=True)
        except Exception as error:
            print(json.dumps({"jsonrpc": "2.0", "id": message.get("id") if isinstance(message, dict) else None, "error": {"code": -32602 if message else -32700, "message": str(error)}}), flush=True)
    if client:
        client.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=[tool["name"] for tool in TOOLS] + ["mcp"])
    parser.add_argument("--args", default="{}", help="JSON tool arguments")
    parser.add_argument("--db", help="Existing snapshot SQLite file; otherwise download and cache")
    parser.add_argument("--base-url", default=DEFAULT_BASE)
    options = parser.parse_args()
    if options.command == "mcp":
        mcp(options.db, options.base_url)
    else:
        client = PaperTrail(options.db, options.base_url)
        try:
            print(json.dumps(getattr(client, options.command)(**json.loads(options.args)), ensure_ascii=False, indent=2))
        finally:
            client.close()


if __name__ == "__main__":
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    main()
