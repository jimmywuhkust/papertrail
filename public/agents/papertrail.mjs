/** PaperTrail 2.0 identity-aware static HTTPS SDK. Node 22+/modern browsers. MIT. */
export const VERSION = "2.0.0";
export class PaperTrailError extends Error {
  constructor(code, message, retryable = false, details = {}) { super(message); this.name = "PaperTrailError"; this.error = { code, message, retryable, ...details }; }
}
const fail = (code, message, details = {}) => { throw new PaperTrailError(code, message, false, details); };
export const key = (value) => String(value).normalize("NFKC").toLowerCase().trim().replace(/\s+/gu, " ");
export const tokens = (value) => key(value).match(/[\p{L}\p{N}]+/gu) || [];
export function normalized(identifier) {
  if (typeof identifier !== "string" || !identifier.trim()) fail("INVALID_IDENTIFIER", "Supply a DOI, OpenAlex or source identifier");
  const raw = identifier.trim();
  if (/^(?:https?:\/\/openalex\.org\/|oa:)?W\d+$/i.test(raw)) return `oa:${raw.match(/W\d+$/i)[0].toUpperCase()}`;
  const doi = raw.toLowerCase().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "").trim();
  if (/^10\.\d{4,9}\/\S+$/.test(doi)) return `doi:${doi}`;
  if (/^dblp:[A-Za-z0-9_./-]+$/.test(raw)) return raw;
  fail("INVALID_IDENTIFIER", "Expected DOI 10.<registrant>/<suffix>, oa:W<number>, or dblp:<key>", { input: identifier });
}
const DEFAULT_FIELDS = ["id", "title", "authors", "year", "venueId", "venueName", "doi", "url", "sourceUrl", "metadataSources", "counts", "relationshipStatus"];
function bound(value, max, min = 1) { if (!Number.isInteger(value) || value < min || value > max) fail("INVALID_INPUT", `Expected integer ${min}–${max}`); return value; }
function canonical(value) { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`; return JSON.stringify(value); }
const lex = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const hash = async (value) => [...new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", typeof value === "string" ? new TextEncoder().encode(value) : value))].map((v) => v.toString(16).padStart(2, "0")).join("");
function matching(paper, q, fields, match) {
  const wanted = tokens(q), matches = {}, nonAuthorTokens = new Set();
  for (const field of fields) {
    const values = field === "title" ? [paper.title || ""] : paper[field] || [];
    for (const value of values) {
      const words = tokens(value), found = wanted.filter((term) => words.includes(term));
      let accepted = found.length > 0;
      if (field === "authors" && match === "all_tokens") accepted = wanted.every((term) => words.includes(term));
      if (match === "exact_name") accepted = key(q) === key(value);
      if (match === "exact_phrase") accepted = words.some((_, start) => canonical(words.slice(start, start + wanted.length)) === canonical(wanted));
      if (accepted) { matches[field] ||= new Set(); for (const term of found) matches[field].add(term); }
      if (field !== "authors") for (const term of words) nonAuthorTokens.add(term);
    }
  }
  if (match === "all_tokens" && !(wanted.every((term) => nonAuthorTokens.has(term)) || matches.authors)) return null;
  if (!Object.keys(matches).length) return null;
  const weights = { title: 4, topics: 2, authors: 1 };
  return { method: "weighted_token_overlap", score: Object.entries(matches).reduce((sum, [field, words]) => sum + words.size * weights[field], 0), scoreDirection: "higher_is_better", matchedFields: fields.filter((field) => matches[field]), matchedTerms: [...new Set(Object.values(matches).flatMap((words) => [...words]))].sort(), match };
}
export class PaperTrail {
  constructor({ baseUrl = "https://jimmywuhkust.github.io/papertrail/", fetch: fetcher = globalThis.fetch, snapshot = null } = {}) {
    this.baseUrl = `${baseUrl.replace(/\/$/, "")}/`; this.fetch = fetcher.bind(globalThis); this.snapshot = snapshot; this.cache = new Map();
    if (snapshot && !/^[0-9a-f]{24}$/.test(snapshot)) fail("INVALID_SNAPSHOT", "Snapshot ids have 24 lowercase hexadecimal characters");
  }
  async fetchBytes(path) {
    const url = new URL(path, this.baseUrl);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) { const transient = response.status === 429 || response.status >= 500; throw new PaperTrailError(response.status === 404 ? "SNAPSHOT_UNAVAILABLE" : "NETWORK_ERROR", `Resource HTTP ${response.status}`, transient, { url: url.href }); }
        return new Uint8Array(await response.arrayBuffer());
      } catch (error) {
        const failure = error instanceof PaperTrailError ? error : new PaperTrailError("NETWORK_ERROR", error.message, true, { url: url.href });
        if (!failure.error.retryable || attempt === 2) throw failure;
      }
      await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt));
    }
  }
  async manifest() {
    if (!this.manifestTask) this.manifestTask = this.fetchBytes(this.snapshot ? `api/v2/snapshots/${this.snapshot}/manifest.json` : "api/v2/manifest.json").then((bytes) => {
      const result = JSON.parse(new TextDecoder().decode(bytes));
      if (result.schemaVersion !== 2) fail("UNSUPPORTED_SCHEMA", "This SDK supports schema 2");
      if (this.snapshot && this.snapshot !== result.snapshotId) fail("SNAPSHOT_CHANGED", "Requested snapshot differs from loaded snapshot");
      return result;
    }).catch((error) => { this.manifestTask = null; throw error; });
    return this.manifestTask;
  }
  async resource(path) {
    const manifest = await this.manifest();
    if (!this.cache.has(path)) {
      this.cache.set(path, (async () => {
        const info = manifest.resources[path];
        if (!info) fail("UNSUPPORTED_CAPABILITY", "Resource is not declared by this snapshot");
        const bytes = await this.fetchBytes(manifest.snapshotPath + path);
        const digest = await hash(bytes), compressedValid = bytes.byteLength === info.bytes && digest === info.sha256, decodedValid = bytes.byteLength === info.uncompressedBytes && digest === info.uncompressedSha256;
        if (!compressedValid && !decodedValid) fail("INTEGRITY_FAILURE", "Resource differs from pinned snapshot", { resource: path });
        const text = path.endsWith(".gz") && compressedValid ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text() : new TextDecoder().decode(bytes);
        const result = JSON.parse(text);
        if (result.snapshotId !== manifest.snapshotId) fail("SNAPSHOT_CHANGED", "Resource belongs to another snapshot");
        return result;
      })().catch((error) => { this.cache.delete(path); throw error; }));
    }
    return this.cache.get(path);
  }
  async envelope(operation, items, warnings = [], extra = {}) { const manifest = await this.manifest(); return { schemaVersion: 2, snapshotId: manifest.snapshotId, operation, items, coverage: manifest.coverage, warnings, ...extra }; }
  async page(operation, items, context, { limit = 20, offset = 0, cursor = null } = {}, warnings = []) {
    bound(limit, ["references", "cited_by"].includes(operation) ? 1000 : 100); bound(offset, 1000000, 0);
    const manifest = await this.manifest();
    if (cursor !== null) {
      let payload;
      try { if (typeof cursor !== "string" || !cursor) throw new Error("Invalid cursor"); payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(cursor.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)))); if (!payload || typeof payload !== "object" || Array.isArray(payload) || !("offset" in payload)) throw new Error("Invalid cursor"); } catch { fail("INVALID_CURSOR", "Cursor could not be decoded"); }
      if (payload.snapshotId !== manifest.snapshotId || canonical(payload.context) !== canonical(context)) fail("CURSOR_MISMATCH", "Cursor belongs to another snapshot/query/projection");
      offset = bound(payload.offset, 1000000, 0);
    }
    const selected = items.slice(offset, offset + limit);
    const nextCursor = offset + selected.length < items.length ? btoa(String.fromCharCode(...new TextEncoder().encode(canonical({ snapshotId: manifest.snapshotId, context, offset: offset + selected.length })))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : null;
    return this.envelope(operation, selected, warnings, { pagination: { returned: selected.length, total: items.length, offset, nextCursor, hasMore: nextCursor !== null } });
  }
  async filters(venue, fromYear, toYear) { const manifest = await this.manifest(); if (venue !== null && !manifest.venues.some((v) => v.id === venue)) fail("UNKNOWN_VENUE", "Use a venue id from the manifest", { venue }); for (const year of [fromYear, toYear]) if (year !== null) bound(year, 2100, 1900); if (fromYear !== null && toYear !== null && fromYear > toYear) fail("INVALID_YEAR_RANGE", "fromYear must not exceed toYear"); }
  select(item, fields = null) {
    fields ??= DEFAULT_FIELDS;
    const always = ["id", "resolutionState", "matchEvidence", "relationship", "input", "normalizedIdentifier", "canonicalIdentifier"], allowed = new Set([...DEFAULT_FIELDS, ...always, "topics", "fieldProvenance", "authorships", "fieldConflicts", "referenceIds", "citationCount"]);
    if (!Array.isArray(fields) || !fields.length || fields.some((f) => !allowed.has(f))) fail("INVALID_FIELDS", "Unknown paper projection fields");
    return Object.fromEntries([...new Set([...fields, ...always])].filter((f) => f in item).map((f) => [f, item[f]]));
  }
  async records(venue = null) { const manifest = await this.manifest(), items = []; for (const v of manifest.venues.filter((v) => !venue || v.id === venue)) items.push(...(await this.resource(`search/${v.id}.json.gz`)).items); return items; }
  async search(q, { fields = ["title", "topics"], match = "all_tokens", venue = null, fromYear = null, toYear = null, limit = 20, offset = 0, cursor = null, select = null } = {}) {
    if (typeof q !== "string" || !tokens(q).length || q.length > 300) fail("INVALID_QUERY", "q must contain words and be at most 300 characters");
    if (!Array.isArray(fields) || !fields.length || fields.some((f) => !["title", "topics", "authors"].includes(f))) fail("INVALID_FIELDS", "Search fields: title, topics, authors");
    if (!["all_tokens", "any_tokens", "exact_name", "exact_phrase"].includes(match) || (match === "exact_name" && canonical(fields) !== '["authors"]')) fail("INVALID_MATCH", "exact_name requires fields=['authors']");
    bound(limit, 100); bound(offset, 1000000, 0); await this.filters(venue, fromYear, toYear);
    const items = [];
    for (const paper of await this.records(venue)) { if ((fromYear !== null && paper.year < fromYear) || (toYear !== null && paper.year > toYear)) continue; const evidence = matching(paper, q, fields, match); if (evidence) items.push(this.select({ ...paper, matchEvidence: evidence }, select)); }
    items.sort((a, b) => b.matchEvidence.score - a.matchEvidence.score || lex(a.id, b.id));
    return this.page("search", items, { operation: "search", q: key(q), fields, match, venue, fromYear, toYear, select }, { limit, offset, cursor });
  }
  async entry(identifier) { const value = normalized(identifier); const alias = (await this.resource(`lookup/${(await hash(value)).slice(0, 2)}.json.gz`)).identifiers[value] || value; return { entry: (await this.resource(`graph/${(await hash(alias)).slice(0, 2)}.json.gz`)).entries[alias], value }; }
  async paper(id, { fields = null } = {}) { const { entry, value } = await this.entry(id); return this.envelope("paper", [this.select({ ...(entry?.paper || { id: value, title: null, resolutionState: "not_in_snapshot" }), input: id, normalizedIdentifier: value, canonicalIdentifier: entry?.paper.id || null }, fields)]); }
  async papers(ids, { fields = null } = {}) { if (!Array.isArray(ids) || !ids.length) fail("INVALID_INPUT", "ids must be a nonempty list"); bound(ids.length, 100); const items = []; for (const id of ids) items.push((await this.paper(id, { fields })).items[0]); return this.envelope("papers", items); }
  async authors(name, { affiliation = null, match = "exact_name", limit = 20, offset = 0, cursor = null } = {}) {
    bound(limit, 100); bound(offset, 1000000, 0);
    if (affiliation !== null && (typeof affiliation !== "string" || !affiliation.trim())) fail("INVALID_INPUT", "affiliation must be a nonempty string");
    if (typeof name !== "string" || !tokens(name).length || name.length > 200 || !["exact_name", "all_tokens"].includes(match)) fail("INVALID_QUERY", "Provide a name and exact_name/all_tokens");
    const wanted = key(name);
    const ids = match === "exact_name" ? (await this.resource(`names/${(await hash(wanted)).slice(0, 2)}.json.gz`)).names[wanted] || [] : [...new Set((await this.resource("author-names.json.gz")).names.filter(([variant]) => tokens(name).every((term) => tokens(variant).includes(term))).map(([, id]) => id))];
    const items = [];
    for (const id of ids) {
      const profile = (await this.resource(`authors/${(await hash(id)).slice(0, 2)}.json.gz`)).authors[id];
      if (affiliation && !profile.affiliations.some((a) => key(a.name).includes(key(affiliation)) || (a.aliases || []).map(key).includes(key(affiliation)))) continue;
      const item = Object.fromEntries(Object.entries(profile).filter(([k]) => k !== "associations"));
      item.matchEvidence = { nameMatch: match, matchedVariants: profile.nameVariants.filter((v) => match === "exact_name" ? key(v) === wanted : tokens(name).every((t) => tokens(v).includes(t))), affiliationSources: profile.affiliations.map((a) => a.sourceUrl) }; items.push(item);
    }
    items.sort((a, b) => Number(a.identityStatus !== "upstream_identifier") - Number(b.identityStatus !== "upstream_identifier") || lex(a.id, b.id));
    return this.page("authors", items, { operation: "authors", name: wanted, affiliation, match }, { limit, offset, cursor }, items.some((p) => p.identityStatus === "name_only_group") ? ["NAME_ONLY_GROUPS_ARE_NOT_PERSON_IDENTITIES"] : []);
  }
  async authorPapers(authorId, { venue = null, fromYear = null, toYear = null, limit = 20, offset = 0, cursor = null, fields = null } = {}) {
    if (typeof authorId !== "string" || !authorId) fail("INVALID_INPUT", "authorId must be a candidate id string");
    bound(limit, 100); bound(offset, 1000000, 0); this.select({}, fields);
    await this.filters(venue, fromYear, toYear);
    const profile = (await this.resource(`authors/${(await hash(authorId)).slice(0, 2)}.json.gz`)).authors[authorId];
    if (!profile) fail("AUTHOR_NOT_IN_SNAPSHOT", "Unknown researcher candidate id");
    const links = new Map(profile.associations.filter((a) => (!venue || a.venueId === venue) && (fromYear === null || a.year >= fromYear) && (toYear === null || a.year <= toYear)).map((a) => [a.paperId, a])), items = [];
    for (const v of [...new Set([...links.values()].map((a) => a.venueId))].sort()) for (const paper of await this.records(v)) if (links.has(paper.id)) { const a = links.get(paper.id); items.push(this.select({ ...paper, matchEvidence: { method: "author_association", authorId, associationStatus: a.status, sourceUrl: a.sourceUrl, checkedAt: a.checkedAt } }, fields)); }
    items.sort((a, b) => links.get(b.id).year - links.get(a.id).year || lex(a.id, b.id));
    return this.page("author_papers", items, { operation: "author_papers", authorId, venue, fromYear, toYear, fields }, { limit, offset, cursor }, profile.identityStatus === "name_only_group" ? ["NAME_ONLY_ASSOCIATIONS_NOT_DISAMBIGUATED"] : []);
  }
  async relationships(id, incoming, { limit = 100, offset = 0, cursor = null, expand = false, fields = null } = {}) {
    bound(limit, 1000); bound(offset, 1000000, 0); this.select({}, fields);
    if (typeof expand !== "boolean") fail("INVALID_INPUT", "expand must be boolean");
    const operation = incoming ? "cited_by" : "references", { entry } = await this.entry(id);
    if (!entry) fail("IDENTIFIER_NOT_IN_SNAPSHOT", "No corpus record or recorded external node matches");
    const seed = entry.paper;
    const items = entry[operation].map(([neighbor, mask]) => ({ id: neighbor, relationship: { source: incoming ? neighbor : seed.id, target: incoming ? seed.id : neighbor, kind: "cites", sources: [[1, "OpenAlex"], [2, "Crossref"]].filter(([bit]) => mask & bit).map(([, name]) => name), checkedAt: null } })).sort((a, b) => lex(a.id, b.id));
    const status = seed.relationshipStatus[operation], result = await this.page(operation, items, { operation, id: seed.id, expand, fields }, { limit, offset, cursor }, status === "unknown" ? ["RELATIONSHIP_DATA_UNKNOWN"] : []);
    if (expand) { const expanded = []; for (const item of result.items) expanded.push({ ...(await this.paper(item.id, { fields })).items[0], relationship: item.relationship }); result.items = expanded; }
    return { ...result, relationshipStatus: status, counts: seed.counts };
  }
  references(id, options) { return this.relationships(id, false, options); }
  citedBy(id, options) { return this.relationships(id, true, options); }
  async related(id, { method = "text", limit = 20, fields = null } = {}) {
    bound(limit, 100);
    if (method !== "text") fail("UNSUPPORTED_CAPABILITY", "Use Python/SQLite for exact coupling or co-citation", { suggestedTransport: "python", supportedMethods: ["text"] });
    const seed = (await this.paper(id)).items[0];
    if (seed.resolutionState !== "resolved") fail("METADATA_UNAVAILABLE", "Related discovery needs corpus metadata");
    const stop = new Set(["with", "from", "using", "based", "through", "towards", "their", "that", "this", "into", "over"]), terms = [...new Set(tokens(seed.title).filter((term) => term.length > 3 && !stop.has(term)))].slice(0, 6), items = [];
    for (const paper of await this.records(seed.venueId)) { const evidence = terms.length ? matching(paper, terms.join(" "), ["title", "topics"], "any_tokens") : null; if (paper.id !== seed.id && evidence) items.push(this.select({ ...paper, matchEvidence: { ...evidence, relationType: "inferred_similarity" } }, fields)); }
    items.sort((a, b) => b.matchEvidence.score - a.matchEvidence.score || lex(a.id, b.id));
    return this.envelope("related", items.slice(0, limit), ["METADATA_SIMILARITY_NOT_CONTENT_EVIDENCE"], { method, scope: "SEED_VENUE_TITLE_TOPICS" });
  }
  async status() { const manifest = await this.manifest(); return this.envelope("status", [{ sdkVersion: VERSION, schemaVersion: 2, cacheReady: true, database: manifest.database, capabilities: manifest.capabilities.javascript, startup: "On-demand static resources; no SQLite download", cachedResources: this.cache.size }]); }
  graph() { fail("UNSUPPORTED_CAPABILITY", "Use Python/SQLite for bounded graph traversal", { suggestedTransport: "python" }); }
}
