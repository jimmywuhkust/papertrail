# PaperTrail for agents — API v2

Start: https://jimmywuhkust.github.io/papertrail/agents/
Discovery: https://jimmywuhkust.github.io/papertrail/api/v2/manifest.json
Input/output contracts: https://jimmywuhkust.github.io/papertrail/api/v2/tools.json
Response/error schemas: https://jimmywuhkust.github.io/papertrail/api/v2/schemas.json
Static HTTPS OpenAPI: https://jimmywuhkust.github.io/papertrail/api/v2/openapi.json

GitHub Pages serves public files. Queries execute in the downloaded SDK or a
local MCP process. A query string on a Pages URL does not execute a search.
No authentication, API key or paid service is required.

## Choose a transport

| Capability | JavaScript | Python | Local MCP |
| --- | --- | --- | --- |
| Researcher candidates, author publications | Yes | Yes | Yes |
| Explicit field/token search | Yes | Same matching/ranking | Same as Python |
| Paper, batch resolution, both citation directions | Yes | Yes | Yes |
| Projection, snapshot/query-bound cursor | Yes | Yes | Yes |
| Related title/topic overlap | Yes | Same signal | Same as Python |
| Exact recorded coupling/co-citation | Unsupported; use Python | Lazy SQLite | Lazy SQLite |
| Bounded citation graph traversal | Unsupported; use Python | Lazy SQLite | Lazy SQLite |
| Startup | Manifest only | Manifest only | Discovery needs no network |

The manifest declares versions, coverage, capabilities, compressed resource
sizes, SHA-256 checksums and database costs. Unsupported operations raise a
structured error with a suggested transport.

## First useful task: find Mo Li at HKUST

Download https://jimmywuhkust.github.io/papertrail/agents/papertrail.py into
your directory. Python 3.11+; no additional packages:

```python
from papertrail import PaperTrail
api = PaperTrail()
people = api.authors("Mo Li", affiliation="HKUST")
person = people["items"][0]  # inspect candidates if there is more than one
assert person["id"] == "dblp-person:87/4982-1"
works = api.author_papers(person["id"], limit=5)
print(works)
if works["pagination"]["hasMore"]:
    print(api.author_papers(person["id"], limit=5,
          cursor=works["pagination"]["nextCursor"]))
api.close()
```

JavaScript: download https://jimmywuhkust.github.io/papertrail/agents/papertrail.mjs.
Node.js 22+ or a modern browser with fetch, Web Crypto and DecompressionStream:

```javascript
import { PaperTrail } from "./papertrail.mjs";
const api = new PaperTrail();
const people = await api.authors("Mo Li", { affiliation: "HKUST" });
const works = await api.authorPapers(people.items[0].id, { limit: 5 });
console.log(works);
```

DBLP person identifiers and signature positions provide publication associations.
Mo Li's HKUST affiliation is supported by https://cse.hkust.edu.hk/~lim/;
name variants and ORCID are recorded from https://dblp.org/pid/87/4982-1.
Affiliation evidence identifies the person; it does **not** assert that each
2016–2025 paper was written at that institution.

`authors` returns candidate identities, name variants, identifiers, affiliations,
source URLs, paper counts and matching evidence. Exact normalized name matching
is the default; `match="all_tokens"` supports partial names. `affiliation` matches
recorded institution names/aliases only. Missing evidence cannot satisfy a filter.
Most journal authors currently have name-only groups, not disambiguated identities.
Those groups have `identityStatus="name_only_group"` and explicit warnings.
Never treat two equal names as proof of one person, or infer an institution.

## Search semantics and parameters

```python
api.search("federated learning", fields=["title", "topics"],
           match="all_tokens", venue="infocom", from_year=2020,
           to_year=2024, limit=5, select=["id", "title", "year"])
api.search("Mo Li", fields=["authors"], match="exact_name", limit=100)
```

Use `authors` + `author_papers` for identity-aware retrieval. Searching author
strings finds recorded names, which can include homonyms.

| Parameter | Meaning / default |
| --- | --- |
| q | Nonempty text, at most 300 characters |
| fields | title / topics / authors; default title + topics |
| match | all_tokens (default), any_tokens, exact_name, exact_phrase |
| venue | One ID from manifest. Omitted means all 10 venues |
| from_year / to_year | Inclusive integer bounds; from must not exceed to |
| limit / offset / cursor | Default 20; limit 1–100; offset default 0; cursor opaque |
| select | Optional paper field projection; ID/state/evidence retained |

JavaScript uses `fromYear` / `toYear`; author publications use `authorPapers`.
Python/MCP use `author_papers`, `author_id` and `fields` for its projection.

Matching uses Unicode NFKC, lowercase and whole alphanumeric tokens.
`all_tokens` requires all terms across the selected title/topics, or within
one author entry. It never constructs a name across multiple author entries
or across a title and an author. `exact_name` requires fields=[authors] and
equals one normalized author name. `exact_phrase` matches contiguous tokens
within a single field value. `any_tokens` accepts any term.
Thus "Mo Li" does not substring-match "Jiamo Liu" or "Zimo Liao".

Ranking: count unique matched terms in each field, weighted title=4, topics=2,
authors=1. Higher scores rank first; ties use ascending canonical ID. Both SDKs
use the same semantics, scores and order. This is metadata word overlap, not
full-text semantic relevance. `matchEvidence` reports method, fields and terms.

## Results, errors and pagination

Every successful operation returns:

```json
{
  "schemaVersion": 2,
  "snapshotId": "24-lowercase-hex-characters",
  "operation": "search",
  "items": [],
  "pagination": {"returned": 0, "total": 0, "offset": 0,
                 "nextCursor": null, "hasMore": false},
  "coverage": {"code": "VENUE_SNAPSHOT"},
  "warnings": []
}
```

The abbreviated coverage above includes venue IDs, years, paper/identity dates,
incoming-citation scope and absent abstract/full-text flags in real responses.
Use tools.json outputSchema or schemas.json for **complete** types and required
fields. Pagination appears on search, authors, author_papers, references, cited_by.
Related/graph calls are bounded results; graph reports limits and truncation.

Copy `nextCursor` unchanged and retain the same query, filters and projection.
Cursors bind the snapshot and query; mismatches raise CURSOR_MISMATCH. They can
be passed between JavaScript and Python. Offsets remain supported.

Python raises `PaperTrailError`; JavaScript rejects with `PaperTrailError`.
Both expose `.error={code,message,retryable,...details}`. CLI and MCP tool errors:

```json
{"schemaVersion":2,"error":{"code":"INVALID_IDENTIFIER",
 "message":"Expected DOI, OpenAlex or source identifier","retryable":false}}
```

Common codes: INVALID_QUERY, INVALID_FIELDS, INVALID_MATCH, INVALID_INPUT,
INVALID_YEAR_RANGE, UNKNOWN_VENUE, INVALID_IDENTIFIER, INVALID_CURSOR,
CURSOR_MISMATCH, AUTHOR_NOT_IN_SNAPSHOT, IDENTIFIER_NOT_IN_SNAPSHOT,
METADATA_UNAVAILABLE, UNSUPPORTED_CAPABILITY, SNAPSHOT_UNAVAILABLE,
SNAPSHOT_CHANGED, NETWORK_ERROR, DOWNLOAD_INTERRUPTED, INTEGRITY_FAILURE.
MCP returns this object in text content with isError=true.

## Resolve identifiers and read relationships

```python
seed = api.paper("dblp:conf/mobicom/GamageLGTL20")["items"][0]
batch = api.papers([seed["id"], "10.0000/absent-papertrail"],
                   fields=["id", "title", "counts"])
references = api.references(seed["id"], limit=5, expand=True)
incoming = api.cited_by(seed["id"], limit=5, expand=True)
```

Accepted IDs: DOI `10.<4–9 digits>/<suffix>`, `doi:...` or DOI URL;
OpenAlex `W<number>`, `oa:W<number>` or OpenAlex URL; `dblp:<record-key>`.
DOIs are case-normalized. DOI and OpenAlex aliases merge only when a corpus
record asserts their identity; unaligned external aliases may stay separate.

Resolution states:

| State | Meaning |
| --- | --- |
| resolved | Metadata exists in this venue snapshot |
| external_reference | An actual recorded graph node exists, without corpus metadata |
| not_in_snapshot | Syntactically valid identifier absent from this snapshot |
| invalid_identifier | Malformed input; INVALID_IDENTIFIER error, no fabricated paper |

Batch accepts 1–100 IDs, returns one item per input in order, and retains input,
normalizedIdentifier, canonicalIdentifier and resolutionState. A malformed input
fails the operation. Projection retains IDs, resolution and matching evidence.

Edges state source, target, kind=cites, upstream sources and checkedAt (unknown
dates are null). Default relationship items are compact IDs and edges;
`expand=True` adds available neighbor metadata. Limit ≤1,000, default 100.
`relationshipStatus` is available / unknown / unavailable. Unknown empty lists
do not establish that a paper has zero references; completeness is not asserted.

Counts have distinct meanings:
- upstreamCitationCount: supplied OpenAlex total; nullable and potentially stale.
- incomingCorpusCitationCount: deduplicated incoming edges from corpus sources.
- recordedReferenceCount: deduplicated outgoing edges recorded in this snapshot.

`fieldProvenance` and `authorships` can be requested explicitly. Per-field source
strategy/source URL is recorded; unknown retrieval dates and unrecorded conflicts
remain null. These fields do not invent individual-source conflict resolution.

## Related papers and bounded graphs

```python
print(api.status())              # readiness, versions and download size
print(api.warm_cache())          # explicit preparation; optional
print(api.related(seed["id"], method="coupling", limit=5))
print(api.related(seed["id"], method="cocitation", limit=5))
print(api.graph(seed["id"], direction="both", depth=2,
                max_nodes=50, max_edges=100))
```

Coupling counts shared recorded references; co-citation counts shared corpus
citing sources. Evidence includes sharedCount, up to five sharedIdentifiers,
evidenceTruncated, seed/candidate available counts and cosine normalization
`sharedCount/sqrt(seedCount*candidateCount)`. Ranking uses shared count, then ID.
These inferred relationships do not establish agreement, influence or similarity
of full content. `method="text"` uses up to six non-stop title words against
title/topics in the seed venue, identically in both SDKs.

Graph limits: depth 1–3, nodes 1–500, edges 1–5,000. `items` contains compact
nodes; edges carry direction/provenance. Truncation reasons distinguish node and
edge limits, with frontier IDs and suggested relationship paging. This is not a
resumable graph cursor; the response states the requested depth bound.

## Startup, cache, retries and reproducibility

Initialization fetches only the manifest. Author and scoped paper queries use
compact gzip resources with per-resource size/SHA-256 verification, including decoded checksums when a server automatically decompresses HTTP gzip. The manifest
provides the actual download sizes; a full-corpus search can still be large.
Python/MCP downloads SQLite only for warm_cache, coupling, co-citation or graph.
Initialization/tool discovery does not hide a large database download.

CLI examples:

```sh
python papertrail.py status
python papertrail.py authors --args '{"name":"Mo Li","affiliation":"HKUST"}'
python papertrail.py warm_cache --progress
python papertrail.py graph --args '{"id":"dblp:conf/mobicom/GamageLGTL20","max_nodes":20}'
```

CLI JSON is stdout; download progress is stderr. Static resources retry transient
network/429/5xx failures up to three attempts. Database transfer retries/resumes
with HTTP Range when supported, then verifies compressed and extracted sizes
and hashes. Corrupt cache files are replaced. Cache filename is content-addressed.
For offline use: `PaperTrail(path="/path/papertrail.sqlite")` or `--db PATH`.

Pin with Python `PaperTrail(snapshot="<manifest snapshotId>")` or JavaScript
`new PaperTrail({snapshot: "<id>"})`. Resource paths include the snapshot ID;
manifest checksums prevent silent mixing during a deployment. Historical snapshots
are not retained on Pages indefinitely. Archive the SDK, manifest and needed
resources/database for long-term reproducibility. Unavailable pins fail explicitly.

## MCP configuration

```json
{"mcpServers":{"papertrail":{"command":"python",
 "args":["/absolute/path/papertrail.py","mcp"]}}}
```

Local stdio, protocol 2024-11-05. Eleven tools: status, warm_cache, authors,
author_papers, search, paper, papers, references, cited_by, related, graph.
Discovery needs no network/database. Add `--db /path/papertrail.sqlite` for
offline use, or `--snapshot <id>` for a pin. Input bounds and output schemas
are published in tools.json. Use warm_cache before calls with short deadlines.

## Coverage, recipes and development

The snapshot covers 86,426 metadata records from 10 selected venues, 2016–2025,
with 4.56 million recorded citation edges. It is not all scholarly literature.
No abstracts or full text are provided. Incoming counts use corpus sources only.
Identity enrichment has its own checked date, separate from the paper snapshot.
Avoid inferring completeness, current global citation totals or uncaptured work.

Recipes: resolve an author before gathering papers; find recent work using
venue/year filters; page relationships with expanded metadata; use coupling
witnesses to explain candidate discovery; batch/project to reduce output.
Preserve source URLs and identifiers when exporting BibTeX or summaries.

SQLite tables: papers(node_id,id,venue_id,year,title,doi,metadata),
nodes(node_id,id), aliases(identifier,node_id), edges(source,target,provenance),
researchers(id,name_key,profile), author_names(name_key,author_id),
author_papers(author_id,node_id,association), metadata(key,value), papers_fts.
Use SDK search for transport-consistent matching; raw SQL/FTS can have different
semantics. All SDK database connections are read-only.

Build: `python -m pip install -r requirements-dev.txt`, `npm ci`,
`npm run agents:build`, `npm run agents:test`, lint/typecheck, then build.
The tests check real identity retrieval, false-name exclusion, transport equivalence,
cursor/projection isolation, schemas, citation evidence, normalized witnesses,
unknown references, MCP startup and verified/resumable cache transfer.
`tests/agent-benchmark.json` is the fixed identity/publication benchmark;
`work/agent-api/benchmark-results.json` records local latency/bytes/call evidence.
The combined published report is at https://jimmywuhkust.github.io/papertrail/api/v2/benchmark.json (fixture timings, not network guarantees).

`npm run agents:identities -- --refresh` refreshes DBLP signature evidence through the official
SPARQL endpoint. Its checked-in overlay allows network-free deployment builds.
Future ingestion retains DBLP/OpenAlex author identifiers and institution evidence.

Migration: v2 uses items/envelopes and explicit fields. Existing v1 APIs and SDKs
remain at `/api/v1/`, `/agents/papertrail-v1.py`, `/agents/papertrail-v1.mjs`.
V1 manifest declares the current verified database download location; graph/search resources are now gzip files, so use the versioned v1 SDK for those calls. V1 ranking
semantics remain legacy; prefer v2 for new integrations.

SDK: MIT. DBLP/OpenAlex metadata: CC0; Crossref metadata subject to upstream terms.
Source and workflows: https://github.com/jimmywuhkust/papertrail
