import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`https://papertrail.test${path}`, { headers: { accept: "text/html", host: "papertrail.test", "x-forwarded-host": "papertrail.test", "x-forwarded-proto": "https" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {} });
}

test("renders the PaperTrail research product", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /PaperTrail/);
  assert.match(html, /Citation Graphs &amp; Missing Reference Discovery/);
  assert.match(html, /CITATION INTELLIGENCE/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("renders privacy and methodology pages", async () => {
  assert.match(await (await render("/privacy")).text(), /Your draft stays yours/);
  assert.match(await (await render("/methodology")).text(), /Explain the ranking/);
});

