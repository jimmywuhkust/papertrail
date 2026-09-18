#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "public", "data", "venue-library");
const CACHE_DIR = path.join(ROOT, "scripts", ".venue-cache", "crossref");
const MAILTO = process.env.CROSSREF_MAILTO || "papertrail@example.com";
const YEARS = Array.from({ length: 10 }, (_, index) => 2016 + index);
const ROWS = 1000;
const SHARD_LIMIT = 1000;
const CONCURRENCY = 2;
const JOURNALS = [
  { id: "nature-communications", issn: "2041-1723" },
  { id: "tit", issn: "0018-9448" },
];

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const normalizeDoi = (value) => String(value || "").trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "").replace(/^doi:\s*/, "");

function cachePath(url) {
  return path.join(CACHE_DIR, `${createHash("sha1").update(url).digest("hex")}.json`);
}

async function fetchJson(url) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const destination = cachePath(url);
  if (existsSync(destination)) return JSON.parse(readFileSync(destination, "utf8"));
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt) await sleep(Math.min(30000, 1500 * (2 ** attempt)));
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": `PaperTrail venue-library/1.1 (mailto:${MAILTO})`,
        },
      });
      const body = await response.text();
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 160)}`);
      const parsed = JSON.parse(body);
      writeFileSync(destination, body);
      return parsed;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function loadKnownDois(venueId, year) {
  const directory = path.join(DATA_DIR, "shards", venueId);
  const prefixes = [`${year}.json`, `${year}.part-`];
  const dois = new Set();
  for (const name of readdirSync(directory)) {
    if (!prefixes.some((prefix) => name.startsWith(prefix))) continue;
    const payload = JSON.parse(readFileSync(path.join(directory, name), "utf8"));
    for (const record of payload.records || []) if (record.doi) dois.add(normalizeDoi(record.doi));
  }
  return dois;
}

async function fetchYear(journal, year) {
  const knownDois = loadKnownDois(journal.id, year);
  const relations = new Map();
  let cursor = "*";
  let pages = 0;
  let sourceItems = 0;
  for (;;) {
    const params = new URLSearchParams({
      filter: `from-pub-date:${year}-01-01,until-pub-date:${year}-12-31,type:journal-article`,
      rows: String(ROWS),
      select: "DOI,reference,indexed",
      cursor,
      mailto: MAILTO,
    });
    const data = await fetchJson(`https://api.crossref.org/journals/${journal.issn}/works?${params}`);
    const items = data?.message?.items || [];
    sourceItems += items.length;
    for (const item of items) {
      const sourceDoi = normalizeDoi(item.DOI);
      if (!sourceDoi || !knownDois.has(sourceDoi)) continue;
      const referenceDois = [...new Set((item.reference || [])
        .map((reference) => normalizeDoi(reference.DOI || reference.doi))
        .filter((doi) => doi && doi !== sourceDoi))];
      if (!referenceDois.length) continue;
      relations.set(sourceDoi, {
        sourceDoi,
        referenceDois,
        indexedAt: item.indexed?.["date-time"] || null,
        metadataSource: "Crossref",
      });
    }
    pages += 1;
    const next = data?.message?.["next-cursor"];
    if (!items.length || !next || next === cursor) break;
    cursor = next;
    console.log(`${journal.id} ${year}: page ${pages}, source=${sourceItems}, matched=${relations.size}`);
  }
  return { journal, year, knownDois: knownDois.size, sourceItems, pages, relations: [...relations.values()] };
}

async function runQueue(tasks) {
  const results = [];
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const task = tasks[next];
      next += 1;
      results.push(await fetchYear(task.journal, task.year));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
}

function writeReferenceShards(results) {
  const entries = [];
  for (const journal of JOURNALS) {
    const directory = path.join(DATA_DIR, "references", journal.id);
    rmSync(directory, { recursive: true, force: true });
    mkdirSync(directory, { recursive: true });
    for (const result of results.filter((item) => item.journal.id === journal.id).sort((a, b) => a.year - b.year)) {
      const parts = Math.max(1, Math.ceil(result.relations.length / SHARD_LIMIT));
      for (let part = 1; part <= parts; part += 1) {
        const records = result.relations.slice((part - 1) * SHARD_LIMIT, part * SHARD_LIMIT);
        const name = parts === 1 ? `${result.year}.json` : `${result.year}.part-${part}.json`;
        const destination = path.join(directory, name);
        const payload = {
          venueId: journal.id,
          year: result.year,
          part,
          parts,
          count: records.length,
          relationType: "cites-doi",
          records,
        };
        writeFileSync(destination, JSON.stringify(payload));
        entries.push({
          url: `references/${journal.id}/${name}`,
          venueId: journal.id,
          year: result.year,
          part,
          parts,
          records: records.length,
          edges: records.reduce((sum, record) => sum + record.referenceDois.length, 0),
          bytes: statSync(destination).size,
          source: "Crossref",
        });
      }
    }
  }
  return entries;
}

const tasks = JOURNALS.flatMap((journal) => YEARS.map((year) => ({ journal, year })));
const results = await runQueue(tasks);
const referenceShards = writeReferenceShards(results);
const indexPath = path.join(DATA_DIR, "index.json");
const index = JSON.parse(readFileSync(indexPath, "utf8"));
index.referenceShards = referenceShards;
index.stats.referenceCoverage = {
  ...(index.stats.referenceCoverage || {}),
  crossrefSourcePapersWithReferences: referenceShards.reduce((sum, shard) => sum + shard.records, 0),
  crossrefDoiReferenceEdges: referenceShards.reduce((sum, shard) => sum + shard.edges, 0),
  crossrefReferenceBytes: referenceShards.reduce((sum, shard) => sum + shard.bytes, 0),
  byVenueYear: Object.fromEntries(results.map((result) => [
    `${result.journal.id}:${result.year}`,
    { knownPapersWithDoi: result.knownDois, sourceItems: result.sourceItems, papersWithReferences: result.relations.length, pages: result.pages },
  ])),
};
index.provenance.sources.Crossref = "Crossref journal works API; DOI references are stored in separate lazy-loadable reference shards.";
index.generatedAt = new Date().toISOString();
writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);

console.log(JSON.stringify({
  status: "complete",
  referenceShards: referenceShards.length,
  papersWithReferences: index.stats.referenceCoverage.crossrefSourcePapersWithReferences,
  doiReferenceEdges: index.stats.referenceCoverage.crossrefDoiReferenceEdges,
  bytes: index.stats.referenceCoverage.crossrefReferenceBytes,
}, null, 2));
