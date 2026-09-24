#!/usr/bin/env node
/**
 * PaperTrail venue-library generator (2016-2025).
 *
 * Builds public/data/venue-library/ from public scholarly metadata:
 *   - DBLP (official SPARQL endpoint, publishedInStream venue streams) for the
 *     CS conferences: NSDI, SIGCOMM, MobiCom, MobiSys, SenSys, INFOCOM,
 *     UbiComp (conf/huc stream) + IMWUT (journals/imwut stream).
 *     NOTE: dblp.org REST/HTML is behind an Anubis anti-bot challenge for
 *     scripted clients, so the official SPARQL endpoint is used instead.
 *   - OpenAlex (works API, source resolved by ISSN and identity-checked) for
 *     the journals Nature Communications and IEEE Transactions on Information
 *     Theory, plus DOI-based enrichment (citations/topics/references) for the
 *     DBLP-sourced conference records.
 *
 * Standard library only (Node >= 22, global fetch). No new dependencies.
 *
 * Usage:
 *   node scripts/build-venue-library.mjs [--only=nsdi,sigcomm] [--fresh]
 *                                        [--no-enrich]
 *
 * Responses are cached under scripts/.venue-cache/ (disposable) so reruns are
 * resumable; use --fresh to ignore the cache.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "public", "data", "venue-library");
const CACHE_DIR = path.join(ROOT, "scripts", ".venue-cache");
const START_YEAR = 2016;
const END_YEAR = 2025;
const YEARS = [];
for (let y = START_YEAR; y <= END_YEAR; y += 1) YEARS.push(y);
const SHARD_LIMIT = 1000;
const GENERATOR_VERSION = "1.0.0";
const MAILTO = "papertrail@example.com";
const USER_AGENT = `PaperTrail-venue-library/${GENERATOR_VERSION} (mailto:${MAILTO})`;

const args = process.argv.slice(2);
const FLAG_FRESH = args.includes("--fresh");
const FLAG_NO_ENRICH = args.includes("--no-enrich");
const FLAG_NO_JOURNAL_REFS = args.includes("--no-journal-refs");
const onlyArg = (args.find((a) => a.startsWith("--only=")) || "").slice(7);
const ONLY = onlyArg ? onlyArg.split(",").map((s) => s.trim()).filter(Boolean) : null;

// ---------------------------------------------------------------------------
// Venue configuration
// ---------------------------------------------------------------------------
const DBLP_PREFIX = "https://dblp.org/rdf/schema#";
const VENUES = [
  {
    id: "nature-communications",
    name: "Nature Communications",
    aliases: ["Nat Commun", "Nat. Commun."],
    kind: "journal",
    strategy: "openalex-journal",
    issn: "2041-1723",
    expectedSourceName: "Nature Communications",
    expectedHost: "Nature Portfolio",
  },
  {
    id: "nsdi",
    name: "USENIX NSDI",
    aliases: ["NSDI", "Networked Systems Design and Implementation"],
    kind: "conference",
    strategy: "dblp-stream",
    streams: [{ uri: "https://dblp.org/streams/conf/nsdi", keepLabels: ["NSDI"], series: null }],
  },
  {
    id: "sigcomm",
    name: "ACM SIGCOMM",
    aliases: ["SIGCOMM", "SIGCOM"],
    kind: "conference",
    strategy: "dblp-stream",
    streams: [{ uri: "https://dblp.org/streams/conf/sigcomm", keepLabels: ["SIGCOMM"], series: null }],
  },
  {
    id: "mobicom",
    name: "ACM MobiCom",
    aliases: ["MobiCom"],
    kind: "conference",
    strategy: "dblp-stream",
    streams: [{ uri: "https://dblp.org/streams/conf/mobicom", keepLabels: ["MobiCom"], series: null }],
  },
  {
    id: "mobisys",
    name: "ACM MobiSys",
    aliases: ["MobiSys"],
    kind: "conference",
    strategy: "dblp-stream",
    streams: [{ uri: "https://dblp.org/streams/conf/mobisys", keepLabels: ["MobiSys"], series: null }],
  },
  {
    id: "sensys",
    name: "ACM SenSys",
    aliases: ["SenSys"],
    kind: "conference",
    strategy: "dblp-stream",
    streams: [{ uri: "https://dblp.org/streams/conf/sensys", keepLabels: ["SenSys"], series: null }],
  },
  {
    id: "infocom",
    name: "IEEE INFOCOM",
    aliases: ["INFOCOM"],
    kind: "conference",
    strategy: "dblp-stream",
    streams: [{ uri: "https://dblp.org/streams/conf/infocom", keepLabels: ["INFOCOM"], series: null }],
  },
  {
    id: "ubicomp",
    name: "ACM UbiComp / IMWUT",
    aliases: ["UbiComp", "UBICOM", "IMWUT", "PACM IMWUT", "Proc. ACM Interact. Mob. Wearable Ubiquitous Technol."],
    kind: "conference",
    strategy: "dblp-stream",
    // IMWUT first so its records win DOI deduplication against the conf stream.
    streams: [
      { uri: "https://dblp.org/streams/journals/imwut", keepLabels: null, series: "IMWUT" },
      { uri: "https://dblp.org/streams/conf/huc", keepLabels: ["UbiComp"], series: "UbiComp" },
    ],
  },
  {
    id: "tit",
    name: "IEEE Transactions on Information Theory",
    aliases: ["IEEE TIT", "TIT", "Trans. Inf. Theory"],
    kind: "journal",
    strategy: "openalex-journal",
    issn: "0018-9448",
    expectedSourceName: "IEEE Transactions on Information Theory",
    expectedHost: "Institute of Electrical and Electronics Engineers",
  },
  {
    id: "jsac",
    name: "IEEE Journal on Selected Areas in Communications",
    aliases: ["IEEE JSAC", "JSAC", "J. Sel. Areas Commun."],
    kind: "journal",
    strategy: "openalex-journal",
    issn: "0733-8716",
    expectedSourceName: "IEEE Journal on Selected Areas in Communications",
    expectedHost: "Institute of Electrical and Electronics Engineers",
  },
];

// ---------------------------------------------------------------------------
// Exclusion rules
// ---------------------------------------------------------------------------
const EXCLUSION_RULES = [
  ["front-matter-or-index", /^(front\s*matter|back\s*matter|table of contents|contents|preface|foreword|prologue|author index|subject index|program committee|organizing committee|front cover|back cover|inside front cover|title page|call for papers|list of (authors|reviewers)|reviewers?)\b/i],
  ["annual-volume-index", /^\d{4}\s*index\s*ieee/i],
  ["welcome-or-editorial", /^(welcome|message from|chairs['’] message|editorial)\b/i],
  ["correction-or-retraction-notice", /^(correction|corrigendum|erratum|errata|retraction|retracted|publisher correction|author correction|publisher'?s note|expression of concern)\b/i],
  ["proceedings-volume-record", /^proceedings of\b/i],
];

function exclusionReason(title) {
  if (!title) return "empty-title";
  for (const [rule, re] of EXCLUSION_RULES) {
    if (re.test(title)) return rule;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function log(...parts) {
  console.error(`[${new Date().toISOString()}]`, ...parts);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDoi(raw) {
  if (!raw) return null;
  const doi = String(raw)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
    .replace(/^doi:\s*/, "");
  return doi || null;
}

function normalizeTitleKey(title) {
  return String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function shortOpenAlexId(idUrl) {
  if (!idUrl) return null;
  const parts = String(idUrl).split("/");
  return parts[parts.length - 1] || null;
}

function nowIso() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// HTTP layer with disk cache, retries, throttling, and bot-wall detection
// ---------------------------------------------------------------------------
const stats = {
  apiRequests: 0,
  cacheHits: 0,
  retries: 0,
  failedPages: [],
  exclusions: {},
  dedup: { doi: 0, sourceId: 0, titleYear: 0 },
  dedupByVenue: {},
  dedupDroppedSamples: [],
  enrichment: { recordsWithDoi: 0, batches: 0, matched: 0, failedBatches: 0 },
  incompleteSources: [],
  labelDistribution: {},
};

function cachePathFor(cacheKey) {
  const key = createHash("sha1").update(cacheKey).digest("hex");
  return path.join(CACHE_DIR, "http", `${key}.json`);
}

function bumpExclusion(rule, n = 1) {
  stats.exclusions[rule] = (stats.exclusions[rule] || 0) + n;
}

function isHtmlChallenge(body, contentType) {
  if (!contentType || !contentType.includes("text/html")) return false;
  const head = body.slice(0, 2000).toLowerCase();
  return head.includes("not a bot") || head.includes("within.website") || head.includes("anubis");
}

async function httpJson(url, { throttleMs = 200, retries = 4, method = "GET", body = null } = {}) {
  mkdirSync(path.join(CACHE_DIR, "http"), { recursive: true });
  const cachePath = cachePathFor(`${method} ${url} ${body || ""}`);
  if (!FLAG_FRESH && existsSync(cachePath)) {
    stats.cacheHits += 1;
    const cached = JSON.parse(readFileSync(cachePath, "utf8"));
    return cached.body;
  }
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) {
      stats.retries += 1;
      const challenge = lastError && String(lastError.message).includes("bot-challenge");
      const backoff = challenge
        ? Math.min(240000, 30000 * 2 ** (attempt - 1))
        : Math.min(30000, 2000 * 2 ** (attempt - 1));
      log(`retry ${attempt}/${retries} after ${backoff}ms: ${url.slice(0, 120)}`);
      await sleep(backoff);
    }
    await sleep(throttleMs);
    stats.apiRequests += 1;
    try {
      const headers = { "User-Agent": USER_AGENT, Accept: "application/json" };
      if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
      const response = await fetch(url, { method, headers, body, redirect: "follow" });
      const contentType = response.headers.get("content-type") || "";
      const text = await response.text();
      if (isHtmlChallenge(text, contentType)) {
        throw new Error(`HTML bot-challenge page returned instead of JSON (${url.slice(0, 120)})`);
      }
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} (non-retryable): ${text.slice(0, 200)}`);
      }
      const parsed = JSON.parse(text);
      writeFileSync(cachePath, JSON.stringify({ url, method, fetchedAt: nowIso(), body: parsed }));
      return parsed;
    } catch (error) {
      lastError = error;
      if (String(error.message).includes("non-retryable")) break;
    }
  }
  stats.failedPages.push({ url: url.slice(0, 300), error: String(lastError), at: nowIso() });
  throw lastError;
}

async function sparql(query) {
  // POST form-encoded: long VALUES clauses exceed the GET URL length limit.
  const data = await httpJson("https://sparql.dblp.org/sparql", {
    method: "POST",
    body: `query=${encodeURIComponent(query)}&format=json`,
    throttleMs: 2500,
    retries: 6,
  });
  return data.results.bindings;
}

// ---------------------------------------------------------------------------
// DBLP stream harvesting via the official SPARQL endpoint
// ---------------------------------------------------------------------------
const DBLP_PAGE = 2000;
const DBLP_AUTHOR_CHUNK = 300;

function dblpPublicationQuery(streamUri, offset) {
  return `PREFIX dblp: <${DBLP_PREFIX}>
SELECT ?publ ?title ?year ?doi ?page ?venue ?type ?pagination WHERE {
  ?publ dblp:publishedInStream <${streamUri}> .
  ?publ dblp:title ?title .
  OPTIONAL { ?publ dblp:yearOfPublication ?year }
  OPTIONAL { ?publ dblp:doi ?doi }
  OPTIONAL { ?publ dblp:primaryDocumentPage ?page }
  OPTIONAL { ?publ dblp:publishedIn ?venue }
  OPTIONAL { ?publ dblp:pagination ?pagination }
  OPTIONAL { ?publ a ?type }
} ORDER BY ?publ LIMIT ${DBLP_PAGE} OFFSET ${offset}`;
}

function dblpAuthorsQuery(publUris) {
  const values = publUris.map((u) => `<${u}>`).join(" ");
  return `PREFIX dblp: <${DBLP_PREFIX}>
SELECT ?publ ?ord ?name WHERE {
  VALUES ?publ { ${values} }
  ?publ dblp:hasSignature ?sig .
  ?sig dblp:signatureDblpName ?name .
  OPTIONAL { ?sig dblp:signatureOrdinal ?ord }
}`;
}

async function fetchDblpStreamPubs(streamUri) {
  const pubs = new Map();
  for (let offset = 0; ; offset += DBLP_PAGE) {
    const rows = await sparql(dblpPublicationQuery(streamUri, offset));
    if (rows.length === 0) break;
    for (const row of rows) {
      const uri = row.publ.value;
      let pub = pubs.get(uri);
      if (!pub) {
        pub = { uri, title: null, year: null, doi: null, page: null, venue: null, pagination: null, types: new Set() };
        pubs.set(uri, pub);
      }
      const pick = (key, field) => {
        if (row[field] && !pub[key]) pub[key] = row[field].value;
      };
      pick("title", "title");
      pick("year", "year");
      pick("doi", "doi");
      pick("page", "page");
      pick("venue", "venue");
      pick("pagination", "pagination");
      if (row.type) pub.types.add(row.type.value);
    }
    log(`  dblp page offset=${offset} rows=${rows.length} pubs=${pubs.size}`);
    if (rows.length < DBLP_PAGE) break;
  }
  return [...pubs.values()];
}

async function attachDblpAuthors(pubs) {
  const uris = pubs.map((p) => p.uri);
  const byPubl = new Map();
  for (let i = 0; i < uris.length; i += DBLP_AUTHOR_CHUNK) {
    const chunk = uris.slice(i, i + DBLP_AUTHOR_CHUNK);
    const rows = await sparql(dblpAuthorsQuery(chunk));
    for (const row of rows) {
      const uri = row.publ.value;
      if (!byPubl.has(uri)) byPubl.set(uri, []);
      byPubl.get(uri).push({ ord: row.ord ? Number(row.ord.value) : 9999, name: row.name.value });
    }
  }
  for (const pub of pubs) {
    const list = (byPubl.get(pub.uri) || []).sort((a, b) => a.ord - b.ord);
    const seen = new Set();
    pub.authors = [];
    for (const entry of list) {
      const clean = entry.name.replace(/\s+\d{4}$/, "").trim();
      if (clean && !seen.has(clean)) {
        seen.add(clean);
        pub.authors.push(clean);
      }
    }
  }
}

function pageCount(pages) {
  const articlePages = String(pages || "").match(/:(\d+)/g) || [];
  if (articlePages.length >= 2) {
    const nums = articlePages.map((s) => Number(s.slice(1)));
    return Math.max(1, nums[nums.length - 1] - nums[nums.length - 2] + 1);
  }
  const numbers = String(pages || "").match(/\d+/g) || [];
  if (numbers.length >= 2) {
    return Math.max(1, Number(numbers[numbers.length - 1]) - Number(numbers[numbers.length - 2]) + 1);
  }
  return numbers.length ? 1 : null;
}

function classifyTrack(title, pages) {
  const lowered = String(title || "").toLowerCase();
  const prefixes = [
    ["poster", "Poster"],
    ["demo", "Demo"],
    ["demonstration", "Demo"],
    ["keynote", "Keynote"],
    ["tutorial", "Tutorial"],
    ["panel", "Panel"],
    ["doctoral", "Doctoral"],
    ["phd forum", "Doctoral"],
    ["workshop", "Workshop"],
    ["artifact", "Artifact"],
  ];
  for (const [prefix, label] of prefixes) {
    if (lowered.startsWith(prefix) || lowered.slice(0, 30).includes(`${prefix}:`)) return label;
  }
  const count = pageCount(pages);
  if (count !== null && count <= 2) return "Short / Poster";
  return "Main paper";
}

const DBLP_KEEP_TYPES = new Set([
  `${DBLP_PREFIX}Inproceedings`,
  `${DBLP_PREFIX}Article`,
]);

async function harvestDblpVenue(venue) {
  const records = [];
  for (const stream of venue.streams) {
    log(`dblp stream ${stream.uri} (${venue.id})`);
    const pubs = await fetchDblpStreamPubs(stream.uri);
    const survivors = [];
    for (const pub of pubs) {
      const label = pub.venue || "(none)";
      const labelKey = `${venue.id}|${stream.uri.split("/streams/")[1]}|${label}`;
      stats.labelDistribution[labelKey] = (stats.labelDistribution[labelKey] || 0) + 1;

      const year = Number(pub.year);
      if (!Number.isInteger(year)) {
        bumpExclusion("missing-year");
        continue;
      }
      if (year < START_YEAR || year > END_YEAR) {
        bumpExclusion("year-out-of-range");
        continue;
      }
      const isResearchType = [...pub.types].some((t) => DBLP_KEEP_TYPES.has(t));
      if (!isResearchType) {
        bumpExclusion("non-research-type");
        continue;
      }
      if (stream.keepLabels && (!pub.venue || !stream.keepLabels.includes(pub.venue))) {
        bumpExclusion(pub.venue ? `non-main-series:${pub.venue}` : "missing-venue-label");
        continue;
      }
      const title = String(pub.title || "").trim().replace(/\.+$/, "").trim();
      const reason = exclusionReason(title);
      if (reason) {
        bumpExclusion(reason);
        continue;
      }
      pub.title = title;
      pub.year = year;
      survivors.push(pub);
    }
    // Author signatures are fetched only for survivors to keep query volume low.
    await attachDblpAuthors(survivors);
    for (const pub of survivors) {
      const key = pub.uri.replace("https://dblp.org/rec/", "");
      const doi = normalizeDoi(pub.doi);
      records.push({
        id: `dblp:${key}`,
        title: pub.title,
        authors: pub.authors || [],
        year: pub.year,
        venueId: venue.id,
        venueName: venue.name,
        series: stream.series,
        type: classifyTrack(pub.title, pub.pagination),
        doi,
        url: pub.page || (doi ? `https://doi.org/${doi}` : pub.uri),
        sourceId: key,
        sourceUrl: pub.uri,
        citationCount: null,
        openAlexId: null,
        topics: [],
        referenceIds: [],
        metadataSources: ["DBLP"],
        sourceUpdatedAt: null,
      });
    }
  }
  return records;
}

// ---------------------------------------------------------------------------
// OpenAlex journal harvesting (source identity checked by ISSN first)
// ---------------------------------------------------------------------------
async function resolveOpenAlexSource(venue) {
  const url = `https://api.openalex.org/sources/issn:${venue.issn}?mailto=${MAILTO}`;
  const source = await httpJson(url, { throttleMs: 130 });
  const name = source.display_name || "";
  const host = source.host_organization_name || "";
  if (name.toLowerCase() !== venue.expectedSourceName.toLowerCase()) {
    throw new Error(
      `OpenAlex source identity mismatch for ISSN ${venue.issn}: expected "${venue.expectedSourceName}", got "${name}" (${source.id})`,
    );
  }
  if (venue.expectedHost && host.toLowerCase() !== venue.expectedHost.toLowerCase()) {
    throw new Error(
      `OpenAlex source publisher mismatch for ISSN ${venue.issn}: expected "${venue.expectedHost}", got "${host}"`,
    );
  }
  log(`openalex source verified: ${source.id} "${name}" issn_l=${source.issn_l} host=${host}`);
  return { id: source.id, issnL: source.issn_l || venue.issn, name, host };
}

const OPENALEX_JOURNAL_SELECT = [
  "id",
  "doi",
  "display_name",
  "publication_year",
  "authorships",
  "cited_by_count",
  "type",
  "type_crossref",
  "language",
  "primary_location",
  "topics",
  ...(FLAG_NO_JOURNAL_REFS ? [] : ["referenced_works"]),
  "updated_date",
].join(",");

async function harvestOpenAlexVenue(venue, sourceInfo) {
  const sourceShort = shortOpenAlexId(sourceInfo.id);
  const records = [];
  let cursor = "*";
  let page = 0;
  let expected = null;
  for (;;) {
    page += 1;
    const params = new URLSearchParams({
      filter: `primary_location.source.id:${sourceShort},publication_year:${START_YEAR}-${END_YEAR}`,
      "per-page": "200",
      cursor,
      select: OPENALEX_JOURNAL_SELECT,
      mailto: MAILTO,
    });
    const data = await httpJson(`https://api.openalex.org/works?${params}`, { throttleMs: 130 });
    if (expected === null) {
      expected = data.meta ? data.meta.count : null;
      log(`openalex ${venue.id}: meta.count=${expected}`);
    }
    const works = data.results || [];
    for (const work of works) {
      const year = Number(work.publication_year);
      if (!Number.isInteger(year) || year < START_YEAR || year > END_YEAR) {
        bumpExclusion("year-out-of-range");
        continue;
      }
      if (work.type !== "article") {
        bumpExclusion(`non-research-type:${work.type || "unknown"}`);
        continue;
      }
      // OpenAlex mis-files some non-English companion/translation metadata
      // records under these journals (e.g. Japanese J-Global records under
      // IEEE TIT); both journals publish in English only.
      if (work.language && work.language !== "en") {
        bumpExclusion(`non-english-record:${work.language}`);
        continue;
      }
      const title = String(work.display_name || "").trim();
      const reason = exclusionReason(title);
      if (reason) {
        bumpExclusion(reason);
        continue;
      }
      const doi = normalizeDoi(work.doi);
      const authors = [];
      for (const authorship of work.authorships || []) {
        const name = authorship && authorship.author ? authorship.author.display_name : null;
        if (name) authors.push(String(name).trim());
      }
      const topics = [];
      for (const topic of work.topics || []) {
        const name = topic && topic.display_name;
        if (name && !topics.includes(name)) topics.push(name);
      }
      const openAlexId = shortOpenAlexId(work.id);
      records.push({
        id: `oa:${openAlexId}`,
        title,
        authors,
        year,
        venueId: venue.id,
        venueName: venue.name,
        series: null,
        type: work.type_crossref || work.type || null,
        doi,
        url:
          (work.primary_location && work.primary_location.landing_page_url) ||
          (doi ? `https://doi.org/${doi}` : work.id),
        sourceId: openAlexId,
        sourceUrl: work.id,
        citationCount: typeof work.cited_by_count === "number" ? work.cited_by_count : null,
        openAlexId,
        topics: topics.slice(0, 3),
        referenceIds: (work.referenced_works || []).map(shortOpenAlexId).filter(Boolean),
        metadataSources: ["OpenAlex"],
        sourceUpdatedAt: work.updated_date || null,
      });
    }
    log(`openalex ${venue.id}: page ${page}, works=${works.length}, kept=${records.length}`);
    const next = data.meta && data.meta.next_cursor;
    if (!works.length || !next || next === cursor) break;
    cursor = next;
  }
  return { records, expected, collected: records.length };
}

// ---------------------------------------------------------------------------
// OpenAlex DOI enrichment for DBLP-sourced conference records
// ---------------------------------------------------------------------------
const OPENALEX_ENRICH_SELECT = ["id", "doi", "cited_by_count", "referenced_works", "topics", "updated_date"].join(",");

async function enrichWithOpenAlex(records) {
  const byDoi = new Map();
  for (const record of records) {
    if (record.doi && !byDoi.has(record.doi)) byDoi.set(record.doi, record);
  }
  const dois = [...byDoi.keys()];
  stats.enrichment.recordsWithDoi += dois.length;
  for (let i = 0; i < dois.length; i += 50) {
    const batch = dois.slice(i, i + 50);
    stats.enrichment.batches += 1;
    const params = new URLSearchParams({
      filter: `doi:${batch.join("|")}`,
      "per-page": "100",
      select: OPENALEX_ENRICH_SELECT,
      mailto: MAILTO,
    });
    let data;
    try {
      data = await httpJson(`https://api.openalex.org/works?${params}`, { throttleMs: 130 });
    } catch (error) {
      stats.enrichment.failedBatches += 1;
      log(`enrichment batch ${i / 50 + 1} failed permanently: ${error.message}`);
      continue;
    }
    for (const work of data.results || []) {
      const doi = normalizeDoi(work.doi);
      const record = doi ? byDoi.get(doi) : null;
      if (!record) continue;
      record.openAlexId = shortOpenAlexId(work.id);
      record.citationCount = typeof work.cited_by_count === "number" ? work.cited_by_count : null;
      record.referenceIds = (work.referenced_works || []).map(shortOpenAlexId).filter(Boolean);
      const topics = [];
      for (const topic of work.topics || []) {
        const name = topic && topic.display_name;
        if (name && !topics.includes(name)) topics.push(name);
      }
      record.topics = topics.slice(0, 3);
      record.sourceUpdatedAt = work.updated_date || null;
      if (!record.metadataSources.includes("OpenAlex")) record.metadataSources.push("OpenAlex");
      stats.enrichment.matched += 1;
    }
    if ((i / 50) % 10 === 0) log(`enrichment ${i}/${dois.length} dois, matched=${stats.enrichment.matched}`);
  }
}

// ---------------------------------------------------------------------------
// Dedup, sharding, index
// ---------------------------------------------------------------------------
function dedupVenueRecords(records, venueId) {
  const seenDoi = new Set();
  const seenId = new Set();
  const seenTitleYear = new Set();
  const perVenue = { doi: 0, sourceId: 0, titleYear: 0 };
  const kept = [];
  const noteDropped = (rule, record) => {
    if (stats.dedupDroppedSamples.length < 500) {
      stats.dedupDroppedSamples.push({ venueId, rule, id: record.id, title: record.title.slice(0, 120), year: record.year });
    }
  };
  for (const record of records) {
    if (record.doi && seenDoi.has(record.doi)) {
      stats.dedup.doi += 1;
      perVenue.doi += 1;
      noteDropped("doi", record);
      continue;
    }
    if (seenId.has(record.id)) {
      stats.dedup.sourceId += 1;
      perVenue.sourceId += 1;
      noteDropped("sourceId", record);
      continue;
    }
    const titleKey = `${normalizeTitleKey(record.title)}|${record.year}`;
    if (titleKey.length > 6 && seenTitleYear.has(titleKey)) {
      stats.dedup.titleYear += 1;
      perVenue.titleYear += 1;
      noteDropped("titleYear", record);
      continue;
    }
    if (record.doi) seenDoi.add(record.doi);
    seenId.add(record.id);
    seenTitleYear.add(titleKey);
    kept.push(record);
  }
  stats.dedupByVenue[venueId] = perVenue;
  return kept;
}

function sortRecords(records) {
  records.sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    const t = normalizeTitleKey(a.title).localeCompare(normalizeTitleKey(b.title));
    if (t !== 0) return t;
    return a.id.localeCompare(b.id);
  });
}

function writeShards(venue, records) {
  const venueDir = path.join(OUT_DIR, "shards", venue.id);
  mkdirSync(venueDir, { recursive: true });
  const shardEntries = [];
  const byYear = new Map(YEARS.map((y) => [y, []]));
  for (const record of records) byYear.get(record.year).push(record);
  for (const year of YEARS) {
    const yearRecords = byYear.get(year);
    const parts = Math.max(1, Math.ceil(yearRecords.length / SHARD_LIMIT));
    for (let part = 1; part <= parts; part += 1) {
      const slice = yearRecords.slice((part - 1) * SHARD_LIMIT, part * SHARD_LIMIT);
      const filename = parts === 1 ? `${year}.json` : `${year}.part-${part}.json`;
      const payload = {
        venueId: venue.id,
        venueName: venue.name,
        year,
        part,
        parts,
        count: slice.length,
        records: slice,
      };
      const body = JSON.stringify(payload);
      writeFileSync(path.join(venueDir, filename), body);
      shardEntries.push({
        url: `shards/${venue.id}/${filename}`,
        venueId: venue.id,
        year,
        part,
        parts,
        records: slice.length,
        bytes: Buffer.byteLength(body),
      });
    }
  }
  return shardEntries;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const selected = VENUES.filter((v) => !ONLY || ONLY.includes(v.id));
  if (ONLY) {
    const unknown = ONLY.filter((id) => !VENUES.some((v) => v.id === id));
    if (unknown.length) throw new Error(`unknown venue ids in --only: ${unknown.join(", ")}`);
  }
  const index = {
    schemaVersion: 1,
    generator: { name: "build-venue-library.mjs", version: GENERATOR_VERSION },
    generatedAt: nowIso(),
    range: { startYear: START_YEAR, endYear: END_YEAR },
    venues: [],
    shards: [],
    stats: {},
    provenance: {
      sources: {
        DBLP: "Official DBLP SPARQL endpoint (https://sparql.dblp.org/sparql); publishedInStream venue streams. dblp.org REST/HTML is behind an Anubis anti-bot challenge for scripted clients, so SPARQL is used as DBLP's official structured API.",
        OpenAlex: `OpenAlex works/sources API (https://api.openalex.org), polite pool via mailto=${MAILTO}.`,
      },
      retrievedAt: {},
    },
  };
  const perVenueCounts = {};
  const perYearCounts = Object.fromEntries(YEARS.map((y) => [y, 0]));
  let hadFailure = false;

  for (const venue of selected) {
    log(`=== ${venue.id} (${venue.name}) ===`);
    const venueEntry = {
      id: venue.id,
      name: venue.name,
      aliases: venue.aliases,
      kind: venue.kind,
      source: {},
      years: {},
      records: 0,
    };
    try {
      let records;
      if (venue.strategy === "dblp-stream") {
        venueEntry.source = {
          strategy: "dblp-stream",
          dblpStreams: venue.streams.map((s) => ({
            uri: s.uri,
            keepLabels: s.keepLabels,
            series: s.series,
          })),
          enrichment: FLAG_NO_ENRICH ? "disabled" : "openalex-doi",
        };
        records = await harvestDblpVenue(venue);
        records = dedupVenueRecords(records, venue.id);
        if (!FLAG_NO_ENRICH) await enrichWithOpenAlex(records);
      } else {
        const sourceInfo = await resolveOpenAlexSource(venue);
        venueEntry.source = {
          strategy: "openalex-journal",
          issn: venue.issn,
          openAlexSourceId: sourceInfo.id,
          openAlexSourceIssnL: sourceInfo.issnL,
          verifiedName: sourceInfo.name,
          verifiedHost: sourceInfo.host,
        };
        const result = await harvestOpenAlexVenue(venue, sourceInfo);
        records = dedupVenueRecords(result.records, venue.id);
        venueEntry.source.openAlexMetaCount = result.expected;
        if (result.expected !== null && result.expected !== records.length) {
          venueEntry.source.metaCountNote = `OpenAlex meta.count=${result.expected} vs kept records=${records.length} (difference = excluded non-article types, front matter, corrections, dedup)`;
        }
      }
      sortRecords(records);
      const shardEntries = writeShards(venue, records);
      index.shards.push(...shardEntries);
      const yearCounts = Object.fromEntries(YEARS.map((y) => [y, 0]));
      for (const record of records) {
        yearCounts[record.year] += 1;
        perYearCounts[record.year] += 1;
      }
      venueEntry.years = yearCounts;
      venueEntry.records = records.length;
      perVenueCounts[venue.id] = records.length;
      log(`=== ${venue.id}: ${records.length} records ===`);
    } catch (error) {
      hadFailure = true;
      stats.incompleteSources.push({ venueId: venue.id, error: String(error && error.message), at: nowIso() });
      log(`!!! venue ${venue.id} FAILED: ${error && error.message}`);
    }
    index.venues.push(venueEntry);
    index.provenance.retrievedAt[venue.id] = nowIso();
  }

  const totalRecords = Object.values(perVenueCounts).reduce((a, b) => a + b, 0);
  const totalBytes = index.shards.reduce((a, s) => a + s.bytes, 0);
  index.stats = {
    totalRecords,
    totalShards: index.shards.length,
    totalBytes,
    byVenue: perVenueCounts,
    byYear: perYearCounts,
    dedup: stats.dedup,
    dedupByVenue: stats.dedupByVenue,
    dedupDroppedSamples: stats.dedupDroppedSamples,
    exclusions: stats.exclusions,
    enrichment: stats.enrichment,
    labelDistribution: stats.labelDistribution,
    incompleteSources: stats.incompleteSources,
    failedPages: stats.failedPages,
    apiRequests: stats.apiRequests,
    cacheHits: stats.cacheHits,
    retries: stats.retries,
  };
  writeFileSync(path.join(OUT_DIR, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  writeFileSync(
    path.join(CACHE_DIR, "build-report.json"),
    JSON.stringify({ generatedAt: index.generatedAt, stats: index.stats }, null, 2),
  );
  log(`done: ${totalRecords} records, ${index.shards.length} shards, ${totalBytes} bytes`);
  if (hadFailure) {
    log("one or more venues failed; see stats.incompleteSources");
    process.exit(2);
  }
}

main().catch((error) => {
  console.error("fatal:", error);
  process.exit(1);
});
