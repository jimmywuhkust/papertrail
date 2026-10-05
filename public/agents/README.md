# PaperTrail for agents

Start here: https://jimmywuhkust.github.io/papertrail/agents/
Machine discovery: https://jimmywuhkust.github.io/papertrail/llms.txt
Manifest: https://jimmywuhkust.github.io/papertrail/api/v1/manifest.json
OpenAPI: https://jimmywuhkust.github.io/papertrail/api/v1/openapi.json
Tool schemas: https://jimmywuhkust.github.io/papertrail/api/v1/tools.json

## Choose a transport

GitHub Pages serves versioned static HTTPS resources. It does not execute a
search when you append `?q=...`. Execute queries with either SDK, download the
SQLite relationship database, or register the Python SDK as a local MCP stdio
server. No API key, paid service, account, or third-party package is required.

Python requires 3.11+ with SQLite FTS5. JavaScript requires Node.js 22+ or a
modern browser with fetch and Web Crypto. Python downloads approximately
157 MB once and caches a verified approximately 479 MB database locally.
The first use needs approximately 1 GB free disk space for extraction; subsequent
queries use the cached database. Cache names use the database SHA-256 and every
download is checked against the manifest. Updating the source snapshot causes
the SDK to cache a new version; delete old `.cache/papertrail/*.sqlite` files
when no longer needed. Every query reports the dataset scope, and the manifest
reports the exact source snapshot timestamp, coverage and artifact sizes.

## Python: search, citation relationships and related papers

Download `https://jimmywuhkust.github.io/papertrail/agents/papertrail.py` into
your working directory, then:

```python
from papertrail import PaperTrail

api = PaperTrail()
hits = api.search("federated learning", venue="infocom", to_year=2024, limit=5)
paper = hits["papers"][0]
print(paper["id"], paper["title"], paper["doi"])
print(api.paper(paper["doi"] or paper["id"]))
print(api.references(paper["id"], limit=20))
print(api.cited_by(paper["id"], limit=20))
print(api.related(paper["id"], method="coupling", limit=10))
print(api.related(paper["id"], method="cocitation", limit=10))
print(api.related(paper["id"], method="text", limit=10))
print(api.graph(paper["id"], direction="both", depth=2, max_nodes=50))
api.close()
```

Search uses title/topic/author FTS5 BM25 (weights 4/2/1, lower rank is better)
and requires all query words. `venue`, `from_year`, `to_year`, `limit`, and
`offset` filter/page results. Search maximum: 100 results per call.
Citation maximum: 1,000 results per call, with `total`, `offset`, `hasMore`.
Graphs: 1–3 layers, up to 500 nodes and 5,000 edges; `truncated` reports caps.
Unknown identifiers raise `KeyError`; malformed arguments raise `ValueError`.

CLI arguments are the same JSON object used by an MCP tool:

```sh
python papertrail.py search --args '{"q":"federated learning","venue":"infocom","limit":5}'
python papertrail.py references --args '{"id":"10.1038/ncomms9959","limit":10}'
```

On PowerShell use single quotes around the JSON too. Offline or with your own
snapshot, pass `PaperTrail(path="papertrail.sqlite")` or CLI `--db PATH`.

## MCP: expose six callable tools to another agent

Register the downloaded file in your MCP client's configuration. Use an
absolute path and the Python executable available on that machine:

```json
{
  "mcpServers": {
    "papertrail": {
      "command": "python",
      "args": ["/absolute/path/papertrail.py", "mcp"]
    }
  }
}
```

This is a **local stdio MCP server**, not a remotely hosted HTTP MCP endpoint.
It exposes `search`, `paper`, `references`, `cited_by`, `related`, `graph`.
For an offline database add `--db /absolute/path/papertrail.sqlite` to args.
Initialization and tool discovery are immediate; the first actual query
downloads/verifies the database if needed, so allow time for the first call
or warm the cache with the Python example first. Protocol: MCP 2024-11-05.

## JavaScript: lighter HTTPS queries

Download `https://jimmywuhkust.github.io/papertrail/agents/papertrail.mjs`.

```js
import { PaperTrail } from "./papertrail.mjs";
const api = new PaperTrail();
const hits = await api.search("federated learning", { venue: "infocom", toYear: 2024 });
const id = hits.papers[0].id;
console.log(await api.paper(id));
console.log(await api.references(id, { limit: 20 }));
console.log(await api.citedBy(id, { limit: 20 }));
console.log(await api.related(id, { method: "text", limit: 10 }));
```

The JS SDK fetches compact venue search shards (typically under 1 MB for
conferences), an alias lookup and graph buckets, then caches them in memory.
Global search loads all venue search shards, including the large Nature
Communications collection. Prefer a venue filter. JS searches titles/topics
with weighted substring overlap, not Python's BM25/author search. JS related
search is an explicitly bounded title heuristic within the seed venue.
Use Python/SQLite for exact bibliographic coupling, co-citation, graph traversal,
or incoming citations to external identifier-only nodes.

## Static JSON without an SDK

1. GET `api/v1/manifest.json` and check `schemaVersion: 1` and `snapshot`.
2. GET `api/v1/lookup.json`. Normalize DOI to `doi:10...` lowercase;
   OpenAlex to `oa:W...`; source ids such as `dblp:conf/infocom/...` stay intact.
   Resolve `identifiers[normalized]` to a canonical corpus paper id.
3. SHA-256 the UTF-8 canonical id; use the first two lowercase hex digits.
4. GET `api/v1/graph/{bucket}.json`, then read `papers[canonicalId]`.
   It contains `paper`, `references`, `citedBy`. Each edge has `id` and
   `provenance`: bit 1=OpenAlex, bit 2=Crossref, 3=both.
5. Follow `searchShards` in the manifest for title/topic search records.
   URLs in the manifest are relative to `api/v1/`. All these resources are
   public read-only GET files. There are no POST, write, or hosted query routes.

Unknown venue/bucket resources return HTTP 404; HTTP 429/5xx may need a retry.
Missing identifier entries mean outside the paper corpus, not nonexistent.

## SQL for relationship databases

The compressed database URL, sizes and SHA-256 checksums are in the manifest.
After extraction it opens with ordinary SQLite (FTS5 required for full text).
`papers` has metadata JSON and indexed venue/year; `nodes` includes external
identifier stubs; `aliases` resolves DOI, OpenAlex and source ids; `edges`
stores integer `source`/`target` node ids and provenance bits. Both edge
directions are indexed. `papers_fts` indexes titles, topics and authors.
`metadata` contains schemaVersion, snapshot and aggregate stats.

```sql
-- Papers citing a DOI, with their original metadata.
SELECT p.id, p.title, p.year, e.provenance
FROM aliases a JOIN edges e ON e.target=a.node_id
JOIN papers p ON p.node_id=e.source
WHERE a.identifier='doi:10.1038/ncomms9959'
ORDER BY p.year DESC;

-- Cross-venue citations inside the covered paper corpus.
SELECT s.venue_id AS citing_venue, t.venue_id AS cited_venue, COUNT(*) AS edges
FROM edges e JOIN papers s ON s.node_id=e.source
JOIN papers t ON t.node_id=e.target
GROUP BY s.venue_id,t.venue_id ORDER BY edges DESC;
```

## Interpret evidence correctly

- Coverage: ten venues, publication years 2016–2025. Read manifest for the
  exact snapshot time and counts. This is not a live worldwide paper index.
- Source→target means source cites target. References are recorded edges;
  coupling (shared references), co-citation (shared citing papers) and text
  overlap are inferred similarity, not evidence of a direct citation.
- Incoming citations count only source papers in the snapshot. A paper's
  upstream `citationCount` is a different metric and can be null.
- External referenced nodes retain DOI/OpenAlex identifiers but have no
  invented titles, authors, abstracts or publication years. An empty reference
  list can reflect missing source metadata. No full text or abstracts are provided.
- DOI/OpenAlex aliases merge only when an existing corpus record establishes
  identity; unaligned external ids may identify the same work separately.
- SDK MIT; upstream DBLP/OpenAlex metadata CC0; Crossref metadata remains
  subject to upstream terms. Preserve metadataSources/sourceUrl and verify
  the original work before drawing research conclusions.

## Rebuild

From the repository: `npm run agents:build`, then `npm run agents:test`.
The generated API is excluded from Git; GitHub Actions builds it from the
checked-in dataset before every Pages deployment. Published artifact size is
checked against Pages' limit. No third-party packages are needed by the
Python generator or SDK.
