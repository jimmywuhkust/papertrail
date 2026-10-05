/** PaperTrail v1 static HTTPS SDK. Node.js 22+ and modern browsers. MIT. */
export function normalize(identifier) {
  let value = String(identifier).trim();
  if (/^https:\/\/openalex\.org\//.test(value)) value = value.split("/").at(-1);
  if (/^(?:oa:)?W\d+$/i.test(value)) return `oa:${value.replace(/^oa:/i, "").toUpperCase()}`;
  value = value.replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "");
  return value.startsWith("10.") ? `doi:${value.toLowerCase()}` : value;
}

function bound(value, max, min = 1) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Expected integer ${min}–${max}`);
  return value;
}

export class PaperTrail {
  constructor({ baseUrl = "https://jimmywuhkust.github.io/papertrail/", fetch: fetcher = globalThis.fetch } = {}) {
    this.baseUrl = new URL("api/v1/", `${baseUrl.replace(/\/$/, "")}/`).href;
    this.fetch = fetcher.bind(globalThis);
    this.cache = new Map();
  }

  async resource(path) {
    if (!this.cache.has(path)) {
      const task = this.fetch(new URL(path, this.baseUrl), { signal: AbortSignal.timeout(60000) }).then(async (response) => {
        if (!response.ok) throw new Error(`PaperTrail HTTP ${response.status}: ${path}`);
        const result = await response.json();
        if (result.schemaVersion !== 1) throw new Error("Unsupported schema");
        if (path !== "manifest.json" && result.snapshot && result.snapshot !== (await this.manifest()).snapshot) {
          throw new Error("Snapshot changed; create a new SDK client and retry");
        }
        return result;
      }).catch((error) => { this.cache.delete(path); throw error; });
      this.cache.set(path, task);
    }
    return this.cache.get(path);
  }

  manifest() { return this.resource("manifest.json"); }

  async entry(id) {
    const key = normalize(id);
    const { identifiers } = await this.resource("lookup.json");
    const canonical = identifiers[key];
    if (!canonical) return { paper: { id: key, external: true, title: null, metadataAvailable: false }, references: [], citedBy: [] };
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)));
    const bucket = digest[0].toString(16).padStart(2, "0");
    const payload = await this.resource(`graph/${bucket}.json`);
    if (!payload.papers[canonical]) throw new Error("Snapshot mismatch; create a new SDK client and retry");
    return payload.papers[canonical];
  }

  async paper(id) { return (await this.entry(id)).paper; }

  async search(q, { venue, fromYear, toYear, limit = 20, offset = 0 } = {}) {
    bound(limit, 100); bound(offset, 1000000, 0);
    const terms = String(q).toLowerCase().match(/[\p{L}\p{N}]+/gu)?.slice(0, 30) || [];
    if (!terms.length) throw new Error("q must contain a word");
    const manifest = await this.manifest();
    const shards = manifest.searchShards.filter((shard) => !venue || shard.venueId === venue);
    const papers = [];
    // Sequential downloads avoid a burst of large concurrent requests.
    for (const shard of shards) {
      const payload = await this.resource(shard.url);
      for (const paper of payload.papers) {
        if ((fromYear && paper.year < fromYear) || (toYear && paper.year > toYear)) continue;
        const title = paper.title.toLowerCase(), topics = paper.topics.join(" ").toLowerCase();
        if (!terms.every((term) => title.includes(term) || topics.includes(term))) continue;
        const score = terms.reduce((sum, term) => sum + (title.includes(term) ? 4 : 0) + (topics.includes(term) ? 2 : 0), 0);
        papers.push({ ...paper, score });
      }
    }
    papers.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return { papers: papers.slice(offset, offset + limit), total: papers.length, offset, snapshot: manifest.snapshot, ranking: "All words in title/topics; title weight 4, topic weight 2; higher score is better" };
  }

  async relationships(id, incoming, { limit = 100, offset = 0 } = {}) {
    bound(limit, 1000); bound(offset, 1000000, 0);
    const entry = await this.entry(id);
    if (entry.paper.external) throw new Error("JavaScript relationship lookup requires a corpus paper; use Python/SQLite for external identifiers");
    const edges = incoming ? entry.citedBy : entry.references;
    return { edges: edges.slice(offset, offset + limit), total: edges.length, offset, hasMore: offset + limit < edges.length, direction: incoming ? "cited_by" : "references", scope: "snapshot corpus sources; external targets have identifier-only metadata" };
  }
  references(id, options) { return this.relationships(id, false, options); }
  citedBy(id, options) { return this.relationships(id, true, options); }

  async related(id, { method = "text", limit = 20 } = {}) {
    bound(limit, 100);
    if (method !== "text") throw new Error("Use Python/SQLite for exact coupling or co-citation over the complete graph");
    const paper = await this.paper(id);
    if (paper.external) throw new Error("Related search requires corpus metadata");
    const terms = paper.title.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter((term) => term.length > 3) || [];
    const stop = new Set(["with", "from", "using", "based", "through", "towards", "their", "that", "this", "into", "over"]);
    const candidates = new Map();
    for (const term of [...new Set(terms.filter((term) => !stop.has(term)))].slice(0, 6)) {
      for (const candidate of (await this.search(term, { venue: paper.venueId, limit: 100 })).papers) {
        if (candidate.id === paper.id) continue;
        const value = candidates.get(candidate.id) || { ...candidate, score: 0, sharedTerms: [] };
        value.score += candidate.score;
        value.sharedTerms.push(term);
        candidates.set(candidate.id, value);
      }
    }
    return { papers: [...candidates.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit), method, scope: "Heuristic title similarity within the seed venue; at most six term searches and 100 candidates per term; not citation evidence" };
  }
}
