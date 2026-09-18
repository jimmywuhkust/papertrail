#!/usr/bin/env node

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "data", "venue-library");
const START_YEAR = 2016;
const END_YEAR = 2025;
const YEARS = Array.from({ length: END_YEAR - START_YEAR + 1 }, (_, index) => START_YEAR + index);

const VENUES = [
  { id: "nature-communications", name: "Nature Communications", aliases: ["Nat Commun", "Nat. Commun."], kind: "journal", source: { strategy: "openalex-journal", issn: "2041-1723", openAlexSourceId: "https://openalex.org/S64187185", openAlexSourceIssnL: "2041-1723", verifiedName: "Nature Communications", verifiedHost: "Nature Portfolio", openAlexMetaCount: 73526 } },
  { id: "nsdi", name: "USENIX NSDI", aliases: ["NSDI", "Networked Systems Design and Implementation"], kind: "conference", stream: "nsdi" },
  { id: "sigcomm", name: "ACM SIGCOMM", aliases: ["SIGCOMM", "SIGCOM"], kind: "conference", stream: "sigcomm" },
  { id: "mobicom", name: "ACM MobiCom", aliases: ["MobiCom"], kind: "conference", stream: "mobicom" },
  { id: "mobisys", name: "ACM MobiSys", aliases: ["MobiSys"], kind: "conference", stream: "mobisys" },
  { id: "sensys", name: "ACM SenSys", aliases: ["SenSys"], kind: "conference", stream: "sensys" },
  { id: "infocom", name: "IEEE INFOCOM", aliases: ["INFOCOM"], kind: "conference", stream: "infocom" },
  { id: "ubicomp", name: "ACM UbiComp / IMWUT", aliases: ["UbiComp", "UBICOM", "IMWUT", "PACM IMWUT", "Proc. ACM Interact. Mob. Wearable Ubiquitous Technol."], kind: "conference", stream: "ubicomp" },
  { id: "tit", name: "IEEE Transactions on Information Theory", aliases: ["IEEE TIT", "TIT", "Trans. Inf. Theory"], kind: "journal", source: { strategy: "openalex-journal", issn: "0018-9448", openAlexSourceId: "https://openalex.org/S4502562", openAlexSourceIssnL: "0018-9448", verifiedName: "IEEE Transactions on Information Theory", verifiedHost: "Institute of Electrical and Electronics Engineers", openAlexMetaCount: 5502 } },
];

const RECOVERED_GENERATION_STATS = {
  dedup: { doi: 8, sourceId: 0, titleYear: 206 },
  exclusions: {
    "non-research-type:review": 93,
    "correction-or-retraction-notice": 60,
    "non-research-type:book-chapter": 1,
    "non-research-type:paratext": 365,
    "non-research-type:erratum": 3254,
    "non-research-type:letter": 211,
    "non-research-type:dissertation": 8,
    "non-research-type:book-review": 3,
    "non-research-type:retraction": 53,
    "non-research-type:conference-abstract": 6,
    "non-research-type:supplementary-materials": 1,
    "non-research-type:editorial": 7,
    "non-research-type:dataset": 3,
    "year-out-of-range": 15517,
    "non-research-type": 95,
    "non-main-series:SIGCOMM Posters and Demos": 252,
    "non-main-series:SIGCOMM (Posters and Demos)": 111,
    "non-main-series:CryBlock@MOBICOM": 13,
    "non-main-series:MobiSys (Companion Volume)": 147,
    "non-main-series:MobiSys PhDForum": 10,
    "non-main-series:SenSys-ML": 7,
    "non-main-series:INFOCOM Workshops": 1721,
    "non-main-series:INFOCOM (Workshops)": 193,
    "non-main-series:INFOCOM WKSHPS": 243,
    "welcome-or-editorial": 1,
    "non-main-series:UbiComp Companion": 515,
    "non-main-series:UbiComp/ISWC Adjunct": 1381,
    "non-main-series:UbiComp Adjunct": 321,
    "proceedings-volume-record": 2,
  },
};

function conferenceSource(venue) {
  if (venue.id === "ubicomp") {
    return {
      strategy: "dblp-stream",
      dblpStreams: [
        { uri: "https://dblp.org/streams/journals/imwut", keepLabels: null, series: "IMWUT" },
        { uri: "https://dblp.org/streams/conf/huc", keepLabels: ["UbiComp"], series: "UbiComp" },
      ],
      enrichment: "openalex-doi",
    };
  }
  return {
    strategy: "dblp-stream",
    dblpStreams: [{ uri: `https://dblp.org/streams/conf/${venue.stream}`, keepLabels: [venue.id === "nsdi" ? "NSDI" : venue.id === "sigcomm" ? "SIGCOMM" : venue.id === "mobicom" ? "MobiCom" : venue.id === "mobisys" ? "MobiSys" : venue.id === "sensys" ? "SenSys" : "INFOCOM"], series: null }],
    enrichment: "openalex-doi",
  };
}

const shards = [];
const venueEntries = [];
const byVenue = {};
const byYear = Object.fromEntries(YEARS.map((year) => [year, 0]));
const ids = new Set();
const dois = new Set();
let totalBytes = 0;
let recordsWithReferenceIds = 0;
let recordsWithReferenceDois = 0;

for (const venue of VENUES) {
  const directory = path.join(OUT, "shards", venue.id);
  const names = readdirSync(directory).filter((name) => name.endsWith(".json")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const years = Object.fromEntries(YEARS.map((year) => [year, 0]));
  let venueRecords = 0;
  for (const name of names) {
    const fullPath = path.join(directory, name);
    const payload = JSON.parse(readFileSync(fullPath, "utf8"));
    if (payload.venueId !== venue.id || !YEARS.includes(payload.year) || payload.count !== payload.records.length) {
      throw new Error(`invalid shard ${venue.id}/${name}`);
    }
    for (const record of payload.records) {
      if (record.venueId !== venue.id || record.year !== payload.year) throw new Error(`record/shard mismatch ${record.id}`);
      if (ids.has(record.id)) throw new Error(`duplicate id ${record.id}`);
      ids.add(record.id);
      if (record.doi) {
        if (dois.has(record.doi)) throw new Error(`duplicate DOI ${record.doi}`);
        dois.add(record.doi);
      }
      if (record.referenceIds?.length) recordsWithReferenceIds += 1;
      if (record.referenceDois?.length) recordsWithReferenceDois += 1;
    }
    const bytes = statSync(fullPath).size;
    totalBytes += bytes;
    years[payload.year] += payload.count;
    byYear[payload.year] += payload.count;
    venueRecords += payload.count;
    shards.push({
      url: `shards/${venue.id}/${name}`,
      venueId: venue.id,
      year: payload.year,
      part: payload.part,
      parts: payload.parts,
      records: payload.count,
      bytes,
    });
  }
  byVenue[venue.id] = venueRecords;
  venueEntries.push({
    id: venue.id,
    name: venue.name,
    aliases: venue.aliases,
    kind: venue.kind,
    source: venue.source || conferenceSource(venue),
    years,
    records: venueRecords,
  });
}

const index = {
  schemaVersion: 1,
  generator: { name: "build-venue-library.mjs + reindex-venue-library.mjs", version: "1.1.0" },
  generatedAt: new Date().toISOString(),
  range: { startYear: START_YEAR, endYear: END_YEAR },
  venues: venueEntries,
  shards,
  stats: {
    totalRecords: ids.size,
    totalShards: shards.length,
    totalBytes,
    byVenue,
    byYear,
    ...RECOVERED_GENERATION_STATS,
    referenceCoverage: { recordsWithReferenceIds, recordsWithReferenceDois },
    incompleteSources: [],
    failedPages: [],
    reindexedFromValidatedShards: true,
  },
  provenance: {
    sources: {
      DBLP: "Official DBLP SPARQL venue streams.",
      OpenAlex: "Journal metadata and DOI-based conference enrichment.",
      Crossref: "Journal DOI reference enrichment when present in record metadataSources.",
    },
    recoveryNote: "Index reconstructed from the complete validated shard set after OpenAlex exhausted its daily free API budget during a reference-only refresh. Publication records were not regenerated or dropped.",
  },
};

writeFileSync(path.join(OUT, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
console.log(`reindexed ${index.stats.totalRecords} records across ${index.stats.totalShards} shards (${index.stats.totalBytes} bytes)`);
