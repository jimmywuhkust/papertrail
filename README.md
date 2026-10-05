# 文脉 · PaperTrail

PaperTrail is a bilingual citation-intelligence workspace for researchers. Drop in a draft PDF or paste an abstract, inspect its citation graph, discover relevant work that may be missing, and explore ten years of top mobile-computing venues.

The product is designed to work without an AI agent. Its default recommendations use a transparent ranking formula based on topic overlap, recency, citation impact, and venue signals. PDF text extraction happens locally in the browser; the original file is not uploaded.

## What is included

- Browser-local PDF parsing with DOI and RFC detection
- DOI resolution through OpenAlex and Crossref
- ACM, IETF, and broad scholarly search
- Deterministic missing-reference recommendations with an explainable score
- Citation-neighborhood expansion with adjustable depth
- A bounded, deterministic graph view that remains responsive on dense networks
- A sharded 2016–2025 library spanning Nature Communications, NSDI,
  SIGCOMM, MobiCom, MobiSys, SenSys, INFOCOM, UbiComp/IMWUT, and IEEE TIT
- 83,869 paper records plus 4,173,415 DOI citation edges, loaded by venue and
  year instead of as one browser-blocking bundle
- BibTeX export, DOI links, and a browser-local reading list
- Chinese and English interface
- Privacy, methodology, robots, sitemap, manifest, Open Graph, and structured metadata

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Verify a release

```bash
npm run lint
npm run typecheck
npm run venue:validate
npm test
```

`npm test` performs a production build and validates the rendered home, privacy, and methodology pages.
`npm run venue:validate` checks every paper and reference shard, aggregate
count, global ID, normalized DOI, and venue/year boundary. Regeneration and
source details are documented in `public/data/venue-library/README.md`.

## How recommendations work

The deterministic score is intentionally visible to users:

- 58% text and topic overlap
- 20% recency
- 14% citation impact, log-normalized
- 8% recognized venue signal

Already cited DOIs are excluded. This is a discovery aid, not a claim that a paper should be cited. See `/methodology` in the running site for limitations and source details.

## Data and privacy

- A selected PDF is parsed on the user's device with PDF.js.
- Only bounded extracted text, keywords, DOI/RFC identifiers, and query settings are sent to PaperTrail's lookup routes.
- Shortlisted papers remain in local browser storage.
- The public metadata services used by the current implementation are OpenAlex, Crossref, and IETF Datatracker.
- The bundled venue snapshot is derived from public scholarly metadata and should be refreshed before making time-sensitive claims.

See [SECURITY.md](SECURITY.md), [PRIVACY.md](PRIVACY.md), and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Architecture

PaperTrail is a vinext/React application. GitHub Pages uses a static export at
https://jimmywuhkust.github.io/papertrail/; the Workers build retains server
routes. The Pages browser calls public scholarly providers directly for live
search. No account or LLM key is required for the public experience.

## Agent API and relationship database

The [agent guide](https://jimmywuhkust.github.io/papertrail/agents/) provides
versioned JSON resources, dependency-free Python/JavaScript SDKs, a verified
SQLite download, and a local MCP stdio server with six query tools. Agents can
search paper metadata, resolve identifiers, follow both citation directions,
find related papers by coupling/co-citation/text, and traverse bounded graphs.
The snapshot contains 86,426 papers across ten venues and 4,557,794 deduplicated
recorded edges; only 160,219 edges connect two fully described corpus papers.
External targets remain identifier-only nodes. Check the manifest for current
snapshot counts and source dates.

GitHub Pages serves static resources; SDK/MCP queries execute locally. See
[the full API contract](public/agents/README.md),
[llms.txt](https://jimmywuhkust.github.io/papertrail/llms.txt), and
[the manifest](https://jimmywuhkust.github.io/papertrail/api/v1/manifest.json).

```bash
npm run agents:build  # Python 3.11+, SQLite FTS5; no pip packages
npm run agents:test
```

Generate the API before typechecking/building (the agent page imports its
manifest). CI and Pages workflows do this automatically. Generated artifacts
are ignored by Git and rebuilt from the checked-in venue snapshot. Every
Pages release tests the queries and checks the final site stays below 1 GB.

## License

The source code is licensed under the MIT License. Upstream scholarly metadata remains subject to the terms of its respective provider.
