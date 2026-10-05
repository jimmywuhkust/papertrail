import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { PaperTrail, PaperTrailError, normalized } from "../public/agents/papertrail.mjs";

const root = new URL("../public/", import.meta.url);
const expected = JSON.parse(await readFile(new URL("../work/agent-api/transport-fixtures.json", import.meta.url), "utf8"));
const benchmark = JSON.parse(await readFile(new URL("./agent-benchmark.json", import.meta.url), "utf8"));
const seed = "dblp:conf/mobicom/GamageLGTL20";
function fixture() {
  const requests = [];
  const client = new PaperTrail({ baseUrl: "https://papertrail.test/papertrail/", fetch: async (url) => {
    const path = new URL(url).pathname.replace(/^\/papertrail\//, "");
    const bytes = await readFile(new URL(path, root)); requests.push({ path, bytes: bytes.length }); return new Response(bytes);
  } });
  return { client, requests };
}

test("real identity task, evidence and cold request cost", async () => {
  const { client, requests } = fixture();
  const started = performance.now();
  const people = await client.authors("Mo Li", { affiliation: "HKUST" });
  assert.deepEqual(people, expected.people);
  const works = await client.authorPapers(people.items[0].id, { limit: 100 });
  assert.deepEqual(works.items.map((p) => p.id).sort(), benchmark.expectedPaperIds);
  assert.ok(requests.every((r) => !r.path.includes("sqlite")));
  assert.ok(requests.reduce((total, r) => total + r.bytes, 0) < 15000000);
  const python = JSON.parse(await readFile(new URL("../work/agent-api/benchmark-results.json", import.meta.url), "utf8"));
  const report = { schemaVersion: 2, snapshotId: works.snapshotId, task: benchmark.task, expectedPaperCount: benchmark.expectedPaperIds.length, python, javascript: { matchedPaperCount: works.items.length, precision: 1, recall: 1, latencySeconds: (performance.now() - started) / 1000, requestCount: requests.length, downloadBytes: requests.reduce((total, r) => total + r.bytes, 0), sqliteDownloaded: false }, measurement: "Local fixture transport over real published resources; timing is not a network latency guarantee" };
  await writeFile(new URL("../public/api/v2/benchmark.json", import.meta.url), JSON.stringify(report));
  assert.equal((await client.authors("Li, Mo", { affiliation: "HKUST" })).items[0].id, benchmark.identity);
  assert.ok((await client.authors("Li Mo", { affiliation: "HKUST", match: "all_tokens" })).items[0].matchEvidence.matchedVariants.length);
});

test("shared search semantics, rankings and projections across Python and JavaScript", async () => {
  const { client } = fixture();
  for (const [name, q, options] of [["topics", "federated learning", { venue: "infocom", limit: 3 }], ["authors", "Mo Li", { venue: "infocom", fields: ["authors"], match: "exact_name", limit: 3 }], ["phrase", "federated learning", { venue: "infocom", fields: ["title"], match: "exact_phrase", limit: 3 }], ["projection", "wireless", { venue: "infocom", limit: 3, select: ["id", "title"] }]]) assert.deepEqual(await client.search(q, options), expected[name]);
  assert.deepEqual(await client.authorPapers(benchmark.identity, { limit: 5 }), expected.works);
  const next = await client.search("federated learning", { venue: "infocom", limit: 3, cursor: expected.topics.pagination.nextCursor });
  assert.equal(next.pagination.offset, 3);
  await assert.rejects(client.search("wireless", { venue: "infocom", cursor: expected.topics.pagination.nextCursor }), (e) => e.error.code === "CURSOR_MISMATCH");
  for (const cursor of ["", "W10", "bnVsbA", "MQ"]) await assert.rejects(client.search("federated learning", { venue: "infocom", cursor }), (e) => e.error.code === "INVALID_CURSOR");
});

test("identifier states, citation expansion and text similarity match Python", async () => {
  const { client } = fixture();
  assert.deepEqual(await client.paper(seed), expected.paper);
  assert.deepEqual(await client.references(seed, { limit: 3, expand: true }), expected.references);
  assert.deepEqual(await client.citedBy(seed, { limit: 3, expand: true }), expected.cited_by);
  assert.deepEqual(await client.related(seed, { limit: 3 }), expected.text);
  const external = (await client.references(seed, { limit: 100, expand: true })).items.find((p) => p.resolutionState === "external_reference");
  assert.equal((await client.paper(external.id)).items[0].resolutionState, "external_reference");
  assert.equal((await client.paper("10.0000/absent-papertrail")).items[0].resolutionState, "not_in_snapshot");
  await assert.rejects(client.paper("unknown"), (e) => e instanceof PaperTrailError && e.error.code === "INVALID_IDENTIFIER");
  await assert.rejects(client.related(seed, { method: "coupling" }), (e) => e.error.code === "UNSUPPORTED_CAPABILITY" && e.error.suggestedTransport === "python");
  assert.equal(normalized("https://doi.org/10.1038/NCOMMS9959"), "doi:10.1038/ncomms9959");
});

test("input bounds and capability declaration", async () => {
  const { client } = fixture();
  for (const call of [() => client.search("learning", { fields: [] }), () => client.search("Mo Li", { match: "exact_name" }), () => client.search("learning", { fromYear: 2025, toYear: 2020 }), () => client.authors("Mo Li", { affiliation: 1 }), () => client.authorPapers(1), () => client.references(seed, { expand: "yes" }), () => client.papers(new Array(101).fill(seed))]) await assert.rejects(call, PaperTrailError);
  const manifest = await client.manifest();
  assert.equal(manifest.capabilities.javascript.graphTraversal, false);
  assert.equal(manifest.capabilities.python.graphTraversal, true);
  assert.equal((await client.status()).items[0].schemaVersion, 2);
});

test("checksum failures are structured and rejected resources can retry", async () => {
  let corrupt = true;
  const client = new PaperTrail({ baseUrl: "https://papertrail.test/papertrail/", fetch: async (url) => {
    const path = new URL(url).pathname.replace(/^\/papertrail\//, "");
    const bytes = await readFile(new URL(path, root));
    return new Response(corrupt && path.endsWith(".gz") ? bytes.subarray(0, bytes.length - 1) : bytes);
  } });
  await assert.rejects(client.authors("Mo Li"), (e) => e.error.code === "INTEGRITY_FAILURE");
  corrupt = false;
  assert.ok((await client.authors("Mo Li")).items.length);
});

test("HTTP-transparent decompression is verified against decoded checksums", async () => {
  const client = new PaperTrail({ baseUrl: "https://papertrail.test/papertrail/", fetch: async (url) => {
    const path = new URL(url).pathname.replace(/^\/papertrail\//, "");
    const bytes = await readFile(new URL(path, root));
    return new Response(path.endsWith(".gz") ? gunzipSync(bytes) : bytes);
  } });
  assert.deepEqual(await client.authors("Mo Li", { affiliation: "HKUST" }), expected.people);
});
