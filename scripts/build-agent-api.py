"""Build the public, reproducible agent API from the checked-in scholarly snapshot."""
import gzip
import hashlib
import json
from pathlib import Path
import sqlite3
import runpy

ROOT = Path(__file__).resolve().parents[1]
LIBRARY = ROOT / "public/data/venue-library"
OUT = ROOT / "public/api/v1"
WORK = ROOT / "work/agent-api"
BASE = "https://jimmywuhkust.github.io/papertrail/"


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def normalize(raw):
    raw = str(raw).strip()
    if raw.startswith("https://openalex.org/"):
        return "oa:" + raw.rsplit("/", 1)[-1].upper()
    if raw.upper().startswith("W") and raw[1:].isdigit():
        return "oa:" + raw.upper()
    if raw.startswith("oa:"):
        return "oa:" + raw[3:].upper()
    doi = raw.lower()
    for prefix in ("https://doi.org/", "http://doi.org/", "https://dx.doi.org/", "http://dx.doi.org/", "doi:"):
        if doi.startswith(prefix):
            doi = doi[len(prefix):].strip()
            break
    return "doi:" + doi if doi.startswith("10.") else raw


def build():
    index = read(LIBRARY / "index.json")
    WORK.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    database = WORK / "papertrail.sqlite"
    database.unlink(missing_ok=True)
    db = sqlite3.connect(database)
    db.executescript("""
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        PRAGMA temp_store=MEMORY;
        CREATE TABLE nodes(node_id INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL);
        CREATE TABLE aliases(identifier TEXT PRIMARY KEY, node_id INTEGER NOT NULL REFERENCES nodes) WITHOUT ROWID;
        CREATE TABLE papers(node_id INTEGER PRIMARY KEY REFERENCES nodes, id TEXT UNIQUE NOT NULL,
            title TEXT NOT NULL, year INTEGER, venue_id TEXT, doi TEXT, openalex_id TEXT,
            authors TEXT, topics TEXT, citation_count INTEGER, metadata TEXT NOT NULL);
        CREATE TABLE edges(source INTEGER NOT NULL REFERENCES nodes, target INTEGER NOT NULL REFERENCES nodes,
            provenance INTEGER NOT NULL, PRIMARY KEY(source,target)) WITHOUT ROWID;
        CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT) WITHOUT ROWID;
        CREATE VIRTUAL TABLE papers_fts USING fts5(title,topics,authors, content='papers',content_rowid='node_id');
    """)
    records = []
    aliases = {}
    nodes = {}
    ids = {}
    for shard in index["shards"]:
        records.extend(read(LIBRARY / shard["url"])["records"])
    for number, record in enumerate(records, 1):
        nodes[record["id"]] = number
        ids[number] = record["id"]
        identifiers = [record["id"]]
        if record.get("doi"):
            identifiers.append(normalize(record["doi"]))
        if record.get("openAlexId"):
            identifiers.append(normalize(record["openAlexId"]))
        for identifier in identifiers:
            if identifier in aliases and aliases[identifier] != number:
                raise ValueError(f"Ambiguous identifier: {identifier}")
            aliases[identifier] = number
        db.execute("INSERT INTO nodes VALUES(?,?)", (number, record["id"]))
        db.execute("INSERT INTO papers VALUES(?,?,?,?,?,?,?,?,?,?,?)", (
            number, record["id"], record["title"], record["year"], record["venueId"],
            record.get("doi"), record.get("openAlexId"), json.dumps(record["authors"], ensure_ascii=False),
            json.dumps(record["topics"], ensure_ascii=False), record.get("citationCount"),
            json.dumps(record, ensure_ascii=False, separators=(",", ":")),
        ))
        db.execute("INSERT INTO papers_fts(rowid,title,topics,authors) VALUES(?,?,?,?)", (
            number, record["title"], " ".join(record["topics"]), " ".join(record["authors"])))
    db.executemany("INSERT INTO aliases VALUES(?,?)", aliases.items())
    print(f"Loaded {len(records):,} papers", flush=True)

    def target_node(raw):
        key = normalize(raw)
        if key in aliases:
            return aliases[key]
        if key not in nodes:
            number = len(nodes) + 1
            nodes[key] = number
            ids[number] = key
            db.execute("INSERT INTO nodes VALUES(?,?)", (number, key))
        return nodes[key]

    edge_sql = "INSERT INTO edges VALUES(?,?,?) ON CONFLICT(source,target) DO UPDATE SET provenance=provenance|excluded.provenance"
    for number, record in enumerate(records, 1):
        db.executemany(edge_sql, ((number, target_node(ref), 1) for ref in record.get("referenceIds", [])))
    for position, shard in enumerate(index.get("referenceShards", []), 1):
        for record in read(LIBRARY / shard["url"])["records"]:
            source = aliases.get(normalize(record["sourceDoi"]))
            if source is None:
                raise ValueError(f"Unknown citation source {record['sourceDoi']}")
            db.executemany(edge_sql, ((source, target_node(ref), 2) for ref in record["referenceDois"]))
        if position % 20 == 0:
            print(f"Indexed relationship shard {position}/{len(index['referenceShards'])}", flush=True)
    db.executescript("CREATE INDEX edges_target ON edges(target,source); CREATE INDEX papers_venue_year ON papers(venue_id,year); INSERT INTO papers_fts(papers_fts) VALUES('optimize');")
    stats = {
        "papers": len(records), "nodes": len(nodes),
        "citationEdges": db.execute("SELECT COUNT(*) FROM edges").fetchone()[0],
        "internalCitationEdges": db.execute("SELECT COUNT(*) FROM edges JOIN papers ON papers.node_id=edges.target").fetchone()[0],
        "venues": len(index["venues"]),
    }
    db.executemany("INSERT INTO metadata VALUES(?,?)", ((key, json.dumps(value)) for key, value in {
        "schemaVersion": 1, "snapshot": index["generatedAt"], "stats": stats}.items()))
    db.commit()
    assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert not db.execute("PRAGMA foreign_key_check").fetchall()

    # Bucket only corpus papers. External targets remain identified stubs;
    # the SQLite API can still retrieve their incoming corpus citations.
    lookup = {identifier: ids[number] for identifier, number in aliases.items()}
    write(OUT / "lookup.json", {"schemaVersion": 1, "snapshot": index["generatedAt"], "identifiers": lookup})
    buckets = [{} for _ in range(256)]
    search = {venue["id"]: [] for venue in index["venues"]}
    for number, record in enumerate(records, 1):
        refs = [{"id": ids[target], "provenance": provenance} for target, provenance in
                db.execute("SELECT target,provenance FROM edges WHERE source=? ORDER BY target", (number,))]
        citing = [{"id": ids[source], "provenance": provenance} for source, provenance in
                  db.execute("SELECT source,provenance FROM edges WHERE target=? ORDER BY source", (number,))]
        bucket = int(hashlib.sha256(record["id"].encode()).hexdigest()[:2], 16)
        buckets[bucket][record["id"]] = {"paper": record, "references": refs, "citedBy": citing}
        search[record["venueId"]].append({key: record[key] for key in
            ("id", "title", "year", "venueId", "topics", "citationCount")})
    resources = []
    for number, bucket in enumerate(buckets):
        path = OUT / "graph" / f"{number:02x}.json"
        write(path, {"schemaVersion": 1, "snapshot": index["generatedAt"], "papers": bucket})
    for venue, items in search.items():
        path = OUT / "search" / f"{venue}.json"
        write(path, {"schemaVersion": 1, "snapshot": index["generatedAt"], "papers": items})
        resources.append({"venueId": venue, "url": f"search/{venue}.json", "records": len(items), "bytes": path.stat().st_size})
    db.close()
    archive = OUT / "papertrail.sqlite.gz"
    with database.open("rb") as source, archive.open("wb") as target:
        with gzip.GzipFile(filename="", mode="wb", fileobj=target, mtime=0, compresslevel=6) as zipped:
            while chunk := source.read(1024 * 1024):
                zipped.write(chunk)
    manifest = {
        "schemaVersion": 1, "name": "PaperTrail Agent API", "baseUrl": BASE + "api/v1/",
        "snapshot": index["generatedAt"], "range": index["range"], "stats": stats,
        "transport": "static HTTPS GET resources plus local SDK queries; no hosted query server",
        "guide": BASE + "agents/", "agentInstructions": BASE + "llms.txt",
        "pythonSdk": BASE + "agents/papertrail.py", "javascriptSdk": BASE + "agents/papertrail.mjs",
        "mcp": {"transport": "stdio", "command": "python papertrail.py mcp"},
        "database": {"url": "papertrail.sqlite.gz", "compression": "gzip", "bytes": archive.stat().st_size,
                     "sha256": digest(archive), "uncompressedBytes": database.stat().st_size, "uncompressedSha256": digest(database)},
        "lookup": "lookup.json", "graph": {"urlTemplate": "graph/{bucket}.json", "bucket": "first two lowercase SHA-256 hex characters of canonical UTF-8 paper id"},
        "searchShards": resources, "venues": index["venues"],
        "provenance": {"1": "OpenAlex", "2": "Crossref", "3": "OpenAlex and Crossref"},
        "coverage": "Incoming citations count only sources in this corpus. External references are identifier-only nodes. Empty metadata is unknown; no abstracts or full text are provided. DOI and OpenAlex aliases are merged only when a corpus record establishes the identity.",
        "license": "SDK MIT; DBLP/OpenAlex metadata CC0; Crossref metadata subject to upstream terms",
    }
    write(OUT / "manifest.json", manifest)
    tools = runpy.run_path(str(ROOT / "public/agents/papertrail.py"))["TOOLS"]
    write(OUT / "tools.json", {"schemaVersion": 1, "transport": "local MCP stdio", "tools": tools})
    paths = {}
    for resource, summary in (
        ("/manifest.json", "Snapshot, coverage, SDKs and verified database download"),
        ("/lookup.json", "Map normalized DOI/OpenAlex/source identifiers to canonical corpus ids"),
        ("/search/{venue}.json", "Compact title/topic search records for one venue"),
        ("/graph/{bucket}.json", "Paper metadata plus both citation directions for one SHA-256 bucket"),
        ("/papertrail.sqlite.gz", "Complete indexed SQLite database compressed with gzip"),
        ("/tools.json", "MCP tool definitions; execute with the downloaded Python stdio server"),
    ):
        parameters = []
        if "{venue}" in resource:
            parameters.append({"name": "venue", "in": "path", "required": True, "schema": {"type": "string", "enum": [v["id"] for v in index["venues"]]}})
        if "{bucket}" in resource:
            parameters.append({"name": "bucket", "in": "path", "required": True, "schema": {"type": "string", "pattern": "^[0-9a-f]{2}$"}})
        paths[resource] = {"get": {"summary": summary, "parameters": parameters,
            "responses": {"200": {"description": "Static snapshot resource", "content": {
                "application/gzip" if resource.endswith(".gz") else "application/json": {"schema": {"type": "string", "format": "binary"} if resource.endswith(".gz") else {"type": "object"}}}},
                "404": {"description": "Unknown resource"}}}}
    write(OUT / "openapi.json", {"openapi": "3.1.0", "info": {"title": "PaperTrail static resource API", "version": "1.0.0",
        "description": "Public static HTTPS resources. Query strings do not run searches on GitHub Pages. Use the Python/JavaScript SDK, local SQLite SQL, or local MCP stdio tools for queries."},
        "servers": [{"url": BASE + "api/v1"}], "paths": paths})
    public_bytes = sum(path.stat().st_size for path in (ROOT / "public").rglob("*") if path.is_file())
    if public_bytes > 950_000_000:
        raise ValueError(f"Pages artifact too large: {public_bytes:,} bytes")
    print(json.dumps({"stats": stats, "databaseCompressedBytes": archive.stat().st_size, "publicBytes": public_bytes}, indent=2), flush=True)


if __name__ == "__main__":
    build()
