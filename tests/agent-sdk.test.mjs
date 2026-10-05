import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PaperTrail, normalize } from "../public/agents/papertrail-v1.mjs";

const publicDir = new URL("../public/", import.meta.url);
function fixtureClient() {
  const requests = [];
  const client = new PaperTrail({
    baseUrl: "https://papertrail.test/papertrail/",
    fetch: async (url) => {
      requests.push(String(url));
      const path = new URL(url).pathname.replace(/^\/papertrail\//, "");
      try { return new Response(await readFile(new URL(path, publicDir))); }
      catch { return new Response("not found", { status: 404 }); }
    },
  });
  return { client, requests };
}

test("DOI and OpenAlex normalization", () => {
  assert.equal(normalize("https://doi.org/10.1038/NCOMMS9959"), "doi:10.1038/ncomms9959");
  assert.equal(normalize("https://openalex.org/W12345"), "oa:W12345");
  assert.equal(normalize("w12345"), "oa:W12345");
});

test("search real venue data, filters, pagination and reuse", async () => {
  const { client, requests } = fixtureClient();
  const first = await client.search("federated learning", { venue: "infocom", toYear: 2024, limit: 3 });
  assert.ok(first.total > 6);
  assert.ok(first.papers.every((p) => p.venueId === "infocom" && p.year <= 2024));
  const second = await client.search("federated learning", { venue: "infocom", toYear: 2024, limit: 3, offset: 3 });
  assert.equal(second.total, first.total);
  assert.ok(!first.papers.some((p) => second.papers.some((r) => r.id === p.id)));
  assert.equal(requests.length, 2);
  await assert.rejects(client.search("learning", { limit: 101 }));
  assert.deepEqual((await client.search("papertrail_unfindable_word", { venue: "infocom" })).papers, []);
});

test("lookup aliases, cite directions and graph bucket routing", async () => {
  const { client } = fixtureClient();
  const paper = await client.paper("10.1038/ncomms9959");
  assert.equal(paper.id, (await client.paper(paper.id)).id);
  const references = await client.references(paper.id, { limit: 3 });
  assert.ok(references.total > 3);
  assert.equal(references.edges.length, 3);
  assert.ok(references.hasMore);
  assert.ok(references.edges.every((edge) => edge.provenance >= 1 && edge.provenance <= 3));
  const entry = await client.entry(paper.id);
  assert.equal(entry.references.length, references.total);
  const citing = await client.entry("oa:W2741726665");
  assert.ok(citing.references.some((edge) => edge.id === "oa:W2337042264"));
  const cited = await client.entry("oa:W2337042264");
  assert.ok(cited.citedBy.some((edge) => edge.id === citing.paper.id));
  assert.equal((await client.paper("10.0000/unknown-papertrail")).external, true);
  await assert.rejects(client.citedBy("10.0000/unknown-papertrail"));
});

test("fetch retains the global receiver required by browser native fetch", async () => {
  const client = new PaperTrail({ fetch: function () {
    assert.equal(this, globalThis);
    return Promise.resolve(new Response(JSON.stringify({ schemaVersion: 1 })));
  } });
  assert.equal((await client.manifest()).schemaVersion, 1);
});

test("related candidates exclude seed and explain heuristic scope", async () => {
  const { client } = fixtureClient();
  const seed = (await client.search("federated learning", { venue: "infocom", limit: 1 })).papers[0];
  const related = await client.related(seed.id, { limit: 3 });
  assert.ok(related.papers.length);
  assert.ok(related.papers.every((paper) => paper.id !== seed.id && paper.sharedTerms.length));
  assert.match(related.scope, /Heuristic/);
  await assert.rejects(client.related(seed.id, { method: "coupling" }));
});
