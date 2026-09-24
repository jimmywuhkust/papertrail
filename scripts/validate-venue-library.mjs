#!/usr/bin/env node
/**
 * Focused validator for public/data/venue-library/.
 *
 * Checks the data contract:
 *   - index.json parses; all nine venue collections exist, each covering
 *     every year 2016-2025 (zero-record years still have a shard).
 *   - every listed shard exists, parses, matches its venue/year/part, and its
 *     record count and byte size match the index.
 *   - record schema: required fields, types, year/venue consistency.
 *   - global id uniqueness; normalized-DOI uniqueness.
 *   - aggregate counts equal the sum of shards (total, per venue, per year).
 *
 * Usage:
 *   node scripts/validate-venue-library.mjs [--spot-check]
 *
 * --spot-check additionally verifies three DOI-bearing records per venue
 * against Crossref and OpenAlex (network) and writes a machine report to
 * scripts/.venue-cache/spot-check-report.json.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "public", "data", "venue-library");
const CACHE_DIR = path.join(ROOT, "scripts", ".venue-cache");
const START_YEAR = 2016;
const END_YEAR = 2025;
const SHARD_LIMIT = 1000;
const MAILTO = "papertrail@example.com";
const SPOT_CHECK = process.argv.includes("--spot-check");

const EXPECTED_VENUES = [
  "nature-communications",
  "nsdi",
  "sigcomm",
  "mobicom",
  "mobisys",
  "sensys",
  "infocom",
  "ubicomp",
  "tit",
  "jsac",
];

const failures = [];
const warnings = [];
let checks = 0;

function check(condition, message) {
  checks += 1;
  if (!condition) failures.push(message);
  return condition;
}

function warn(message) {
  warnings.push(message);
}

function normalizeDoi(raw) {
  if (!raw) return null;
  const doi = String(raw).trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "").replace(/^doi:\s*/, "");
  return doi || null;
}

function normalizeTitleKey(title) {
  return String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function validateRecord(record, shardLabel) {
  const where = `${shardLabel}: ${record && record.id}`;
  check(typeof record.id === "string" && record.id.length > 0, `${where} missing id`);
  check(typeof record.title === "string" && record.title.length > 0, `${where} missing title`);
  check(Array.isArray(record.authors), `${where} authors not array`);
  check(Number.isInteger(record.year), `${where} year not integer`);
  check(typeof record.venueId === "string", `${where} venueId missing`);
  check(typeof record.venueName === "string" && record.venueName.length > 0, `${where} venueName missing`);
  check(record.series === null || typeof record.series === "string", `${where} series bad type`);
  check(record.type === null || typeof record.type === "string", `${where} type field bad type`);
  check(record.doi === null || typeof record.doi === "string", `${where} doi bad type`);
  check(typeof record.url === "string" && record.url.length > 0, `${where} url missing`);
  check(typeof record.sourceUrl === "string" && record.sourceUrl.length > 0, `${where} sourceUrl missing`);
  check(record.citationCount === null || typeof record.citationCount === "number", `${where} citationCount bad type`);
  check(record.openAlexId === null || typeof record.openAlexId === "string", `${where} openAlexId bad type`);
  check(Array.isArray(record.topics), `${where} topics not array`);
  check(Array.isArray(record.referenceIds), `${where} referenceIds not array`);
  check(Array.isArray(record.metadataSources) && record.metadataSources.length > 0, `${where} metadataSources empty`);
  check(record.sourceUpdatedAt === null || typeof record.sourceUpdatedAt === "string", `${where} sourceUpdatedAt bad type`);
}

async function spotCheck(allRecords) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const report = { generatedAt: new Date().toISOString(), results: [] };
  const headers = { "User-Agent": `PaperTrail-venue-validator/1.0 (mailto:${MAILTO})` };
  const titlesMatch = (a, b) => {
    const ours = normalizeTitleKey(a);
    const theirs = normalizeTitleKey(b);
    return ours.length > 0 && theirs.length > 0 && (ours === theirs || ours.includes(theirs) || theirs.includes(ours));
  };
  for (const venueId of EXPECTED_VENUES) {
    const doiCandidates = allRecords.filter((r) => r.venueId === venueId && r.doi);
    const useTitleSearch = doiCandidates.length < 3;
    if (useTitleSearch) {
      warn(`spot-check: venue ${venueId} has only ${doiCandidates.length} DOI-bearing records; using OpenAlex title search`);
    }
    const pool = useTitleSearch ? allRecords.filter((r) => r.venueId === venueId) : doiCandidates;
    const picks = [];
    for (let k = 0; k < 3 && pool.length; k += 1) {
      picks.push(pool[Math.floor((k * pool.length) / 3)]);
    }
    for (const record of picks) {
      const entry = { venueId, id: record.id, doi: record.doi, method: useTitleSearch ? "openalex-title-search" : "doi", crossref: null, openalex: null, pass: false };
      if (useTitleSearch) {
        try {
          const params = new URLSearchParams({ "per-page": "5", select: "id,display_name,publication_year", mailto: MAILTO });
          const oa = await fetch(
            `https://api.openalex.org/works?filter=title.search:${encodeURIComponent(record.title)}&${params}`,
            { headers },
          );
          if (oa.ok) {
            const body = await oa.json();
            const hit = (body.results || []).find((w) => titlesMatch(record.title, w.display_name));
            entry.openalex = { status: oa.status, id: hit ? hit.id : null, titleMatch: Boolean(hit) };
          } else {
            entry.openalex = { status: oa.status, titleMatch: false };
          }
        } catch (error) {
          entry.openalex = { status: "error", error: String(error.message) };
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
        // USENIX coverage in OpenAlex is incomplete; fall back to the
        // publisher landing page recorded by DBLP (primaryDocumentPage).
        if (!entry.openalex.titleMatch && record.url) {
          try {
            const page = await fetch(record.url, { headers });
            const text = (await page.text()).toLowerCase().replace(/[^a-z0-9]+/g, "");
            entry.publisher = { status: page.status, url: record.url, titleMatch: page.ok && text.includes(normalizeTitleKey(record.title)) };
          } catch (error) {
            entry.publisher = { status: "error", error: String(error.message) };
          }
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        entry.pass = Boolean(
          (entry.openalex && entry.openalex.titleMatch) || (entry.publisher && entry.publisher.titleMatch),
        );
        report.results.push(entry);
        console.log(`  spot ${entry.pass ? "PASS" : "FAIL"} ${venueId} "${record.title.slice(0, 60)}" titleSearch=${JSON.stringify(entry.openalex && entry.openalex.titleMatch)} publisher=${JSON.stringify(entry.publisher && entry.publisher.titleMatch)}`);
        continue;
      }
      try {
        const cr = await fetch(`https://api.crossref.org/works/${encodeURIComponent(record.doi)}?mailto=${MAILTO}`, { headers });
        if (cr.ok) {
          const body = await cr.json();
          const crTitle = body.message && Array.isArray(body.message.title) ? body.message.title[0] : "";
          entry.crossref = { status: cr.status, titleMatch: titlesMatch(record.title, crTitle) };
        } else {
          entry.crossref = { status: cr.status, titleMatch: false };
        }
      } catch (error) {
        entry.crossref = { status: "error", error: String(error.message) };
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
      try {
        const oa = await fetch(`https://api.openalex.org/works/https://doi.org/${record.doi}?mailto=${MAILTO}&select=id,display_name`, { headers });
        if (oa.ok) {
          const body = await oa.json();
          entry.openalex = { status: oa.status, id: body.id, titleMatch: titlesMatch(record.title, body.display_name) };
        } else {
          entry.openalex = { status: oa.status, titleMatch: false };
        }
      } catch (error) {
        entry.openalex = { status: "error", error: String(error.message) };
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
      entry.pass = Boolean(
        (entry.crossref && entry.crossref.titleMatch) || (entry.openalex && entry.openalex.titleMatch),
      );
      report.results.push(entry);
      console.log(
        `  spot ${entry.pass ? "PASS" : "FAIL"} ${venueId} ${record.doi} crossref=${JSON.stringify(entry.crossref && entry.crossref.titleMatch)} openalex=${JSON.stringify(entry.openalex && entry.openalex.titleMatch)}`,
      );
    }
  }
  writeFileSync(path.join(CACHE_DIR, "spot-check-report.json"), JSON.stringify(report, null, 2));
  const failed = report.results.filter((r) => !r.pass);
  check(failed.length === 0, `spot-check: ${failed.length}/${report.results.length} records failed source verification`);
  check(report.results.length >= EXPECTED_VENUES.length * 3, "spot-check: fewer sampled records than required");
}

async function main() {
  check(existsSync(path.join(OUT_DIR, "index.json")), "index.json missing");
  const index = JSON.parse(readFileSync(path.join(OUT_DIR, "index.json"), "utf8"));

  const venueIds = index.venues.map((v) => v.id).sort();
  check(
    JSON.stringify(venueIds) === JSON.stringify([...EXPECTED_VENUES].sort()),
    `venue collections mismatch: ${venueIds.join(",")}`,
  );
  for (const venue of index.venues) {
    for (let y = START_YEAR; y <= END_YEAR; y += 1) {
      check(Object.prototype.hasOwnProperty.call(venue.years, String(y)), `venue ${venue.id} missing year ${y}`);
    }
  }

  const globalIds = new Set();
  const globalDois = new Set();
  const allRecords = [];
  const shardSums = { total: 0, byVenue: {}, byYear: {} };
  const coverage = {};
  for (const id of EXPECTED_VENUES) {
    coverage[id] = new Set();
    shardSums.byVenue[id] = 0;
  }
  for (let y = START_YEAR; y <= END_YEAR; y += 1) shardSums.byYear[y] = 0;

  for (const shard of index.shards) {
    const label = shard.url;
    const filePath = path.join(OUT_DIR, shard.url);
    if (!check(existsSync(filePath), `shard missing: ${label}`)) continue;
    check(statSync(filePath).size === shard.bytes, `shard byte size mismatch: ${label}`);
    const payload = JSON.parse(readFileSync(filePath, "utf8"));
    check(payload.venueId === shard.venueId, `shard venueId mismatch: ${label}`);
    check(payload.year === shard.year, `shard year mismatch: ${label}`);
    check(payload.part === shard.part && payload.parts === shard.parts, `shard part mismatch: ${label}`);
    check(Array.isArray(payload.records), `shard records not array: ${label}`);
    check(payload.records.length === shard.records, `shard record count mismatch: ${label}`);
    check(payload.records.length === payload.count, `shard count field mismatch: ${label}`);
    check(payload.records.length <= SHARD_LIMIT, `shard exceeds ${SHARD_LIMIT} records: ${label}`);
    coverage[shard.venueId].add(shard.year);
    shardSums.total += payload.records.length;
    shardSums.byVenue[shard.venueId] += payload.records.length;
    shardSums.byYear[shard.year] += payload.records.length;
    for (const record of payload.records) {
      validateRecord(record, label);
      check(record.year === shard.year, `record year != shard year: ${record.id}`);
      check(record.venueId === shard.venueId, `record venue != shard venue: ${record.id}`);
      check(record.year >= START_YEAR && record.year <= END_YEAR, `record year out of range: ${record.id}`);
      if (globalIds.has(record.id)) check(false, `duplicate global id: ${record.id}`);
      globalIds.add(record.id);
      const doi = normalizeDoi(record.doi);
      if (doi) {
        if (globalDois.has(doi)) check(false, `duplicate normalized DOI: ${doi} (${record.id})`);
        globalDois.add(doi);
      }
      allRecords.push(record);
    }
  }

  const referenceCoverage = { papers: 0, edges: 0, bytes: 0 };
  const referenceYears = new Map(["nature-communications", "tit"].map((id) => [id, new Set()]));
  check(Array.isArray(index.referenceShards), "referenceShards missing from index");
  for (const shard of index.referenceShards || []) {
    const label = shard.url;
    const filePath = path.join(OUT_DIR, label);
    if (!check(existsSync(filePath), `reference shard missing: ${label}`)) continue;
    check(statSync(filePath).size === shard.bytes, `reference shard byte size mismatch: ${label}`);
    const payload = JSON.parse(readFileSync(filePath, "utf8"));
    check(payload.venueId === shard.venueId, `reference shard venue mismatch: ${label}`);
    check(payload.year === shard.year, `reference shard year mismatch: ${label}`);
    check(payload.part === shard.part && payload.parts === shard.parts, `reference shard part mismatch: ${label}`);
    check(payload.relationType === "cites-doi", `reference shard relation type mismatch: ${label}`);
    check(Array.isArray(payload.records), `reference shard records not array: ${label}`);
    check(payload.records.length === payload.count && payload.count === shard.records, `reference shard count mismatch: ${label}`);
    check(payload.records.length <= SHARD_LIMIT, `reference shard exceeds ${SHARD_LIMIT} records: ${label}`);
    referenceYears.get(shard.venueId)?.add(shard.year);
    referenceCoverage.papers += payload.records.length;
    referenceCoverage.bytes += shard.bytes;
    let shardEdges = 0;
    for (const relation of payload.records) {
      const sourceDoi = normalizeDoi(relation.sourceDoi);
      check(Boolean(sourceDoi) && globalDois.has(sourceDoi), `reference source DOI not in paper library: ${relation.sourceDoi}`);
      check(Array.isArray(relation.referenceDois) && relation.referenceDois.length > 0, `reference list empty: ${relation.sourceDoi}`);
      check(new Set(relation.referenceDois).size === relation.referenceDois.length, `duplicate DOI in reference list: ${relation.sourceDoi}`);
      for (const target of relation.referenceDois) check(normalizeDoi(target) === target, `non-normalized target DOI: ${target}`);
      shardEdges += relation.referenceDois.length;
    }
    check(shardEdges === shard.edges, `reference edge count mismatch: ${label}`);
    referenceCoverage.edges += shardEdges;
  }
  for (const [venueId, years] of referenceYears) {
    for (let year = START_YEAR; year <= END_YEAR; year += 1) {
      check(years.has(year), `no reference shard covers ${venueId} year ${year}`);
    }
  }
  check(index.stats.referenceCoverage.crossrefSourcePapersWithReferences === referenceCoverage.papers, "reference paper aggregate mismatch");
  check(index.stats.referenceCoverage.crossrefDoiReferenceEdges === referenceCoverage.edges, "reference edge aggregate mismatch");
  check(index.stats.referenceCoverage.crossrefReferenceBytes === referenceCoverage.bytes, "reference byte aggregate mismatch");

  for (const venue of index.venues) {
    for (let y = START_YEAR; y <= END_YEAR; y += 1) {
      check(coverage[venue.id].has(y), `no shard covers ${venue.id} year ${y}`);
      check(venue.years[String(y)] === shardSumFor(venue.id, y), `venue year count mismatch ${venue.id}/${y}`);
    }
  }

  function shardSumFor(venueId, year) {
    return index.shards
      .filter((s) => s.venueId === venueId && s.year === year)
      .reduce((a, s) => a + s.records, 0);
  }

  for (const venue of index.venues) {
    check(venue.records === shardSums.byVenue[venue.id], `venue.records mismatch for ${venue.id}`);
  }
  check(index.stats.totalRecords === shardSums.total, `stats.totalRecords (${index.stats.totalRecords}) != shard sum (${shardSums.total})`);
  for (const [id, count] of Object.entries(index.stats.byVenue)) {
    check(count === shardSums.byVenue[id], `stats.byVenue.${id} mismatch`);
  }
  for (const [year, count] of Object.entries(index.stats.byYear)) {
    check(count === (shardSums.byYear[year] || 0), `stats.byYear.${year} mismatch`);
  }
  check(index.stats.totalShards === index.shards.length, "stats.totalShards mismatch");
  check(
    index.stats.totalBytes === index.shards.reduce((a, s) => a + s.bytes, 0),
    "stats.totalBytes mismatch",
  );
  check(
    Array.isArray(index.stats.incompleteSources) && index.stats.incompleteSources.length === 0,
    `incomplete sources reported: ${JSON.stringify(index.stats.incompleteSources)}`,
  );

  if (SPOT_CHECK) await spotCheck(allRecords);

  console.log(`\nchecks run: ${checks}`);
  if (warnings.length) {
    console.log("warnings:");
    for (const w of warnings) console.log(`  - ${w}`);
  }
  if (failures.length) {
    console.log(`FAILURES (${failures.length}):`);
    for (const f of failures.slice(0, 50)) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("venue-library validation: PASS");
}

main().catch((error) => {
  console.error("fatal:", error);
  process.exit(1);
});
