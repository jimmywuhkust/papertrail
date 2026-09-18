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

PaperTrail is a vinext/React application deployed to Cloudflare Workers through OpenAI Sites. API routes normalize upstream scholarly metadata into a common `Paper` model. No database, account, or LLM key is required for the public experience.

## License

The source code is licensed under the MIT License. Upstream scholarly metadata remains subject to the terms of its respective provider.
