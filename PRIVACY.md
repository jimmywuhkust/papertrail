# Privacy notes

PaperTrail follows a local-first model.

## What stays on the device

- The original PDF file
- The full extracted document text
- The user's saved-paper shortlist, stored in browser local storage

## What leaves the device

When a user starts an analysis or search, PaperTrail may send a bounded excerpt of extracted text, inferred keywords, discovered DOI/RFC identifiers, year filters, and source filters to its own API routes. Those routes query public metadata services including OpenAlex, Crossref, and IETF Datatracker.

PaperTrail does not require an account and does not ship an advertising tracker. Hosting and upstream metadata providers may retain standard network logs under their own policies.

Do not upload or paste material you are not permitted to process. For confidential drafts, review the deployed site's privacy notice and your institution's policy before using external metadata lookup.
