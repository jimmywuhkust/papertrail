import type { Metadata } from "next";
import Link from "next/link";
import manifest from "../../public/api/v1/manifest.json";
import AgentExplorer from "./AgentExplorer";
import "./agents.css";

export const metadata: Metadata = {
  title: "Agent API · Paper search & citation database",
  description: "Query PaperTrail with Python, JavaScript, SQLite or local MCP tools. Search papers, follow citations, and discover related work without an API key.",
};

const base = "https://jimmywuhkust.github.io/papertrail/";
const pythonExample = `from papertrail import PaperTrail

api = PaperTrail()
hits = api.search("federated learning", venue="infocom", to_year=2024)
id = hits["papers"][0]["id"]
print(api.references(id, limit=20))
print(api.cited_by(id, limit=20))
print(api.related(id, method="coupling", limit=10))
print(api.graph(id, depth=2, max_nodes=50))
api.close()`;
const jsExample = `import { PaperTrail } from "./papertrail.mjs";

const api = new PaperTrail();
const hits = await api.search("federated learning", { venue: "infocom" });
const id = hits.papers[0].id;
console.log(await api.paper(id));
console.log(await api.references(id));
console.log(await api.citedBy(id));
console.log(await api.related(id, { method: "text" }));`;
const mcpExample = `{
  "mcpServers": {
    "papertrail": {
      "command": "python",
      "args": ["/absolute/path/papertrail.py", "mcp"]
    }
  }
}`;

export default function AgentsPage() {
  return (
    <main className="agent-page" lang="en">
      <header className="agent-header"><Link href="/">文脉 · PaperTrail</Link><span>PUBLIC RESEARCH INFRASTRUCTURE</span><a href={`${base}llms.txt`}>llms.txt ↗</a></header>
      <section className="agent-hero">
        <p className="agent-kicker">PAPERTRAIL / AGENT API / V1</p>
        <h1>Follow the paper.<br /><em>Query the connections.</em></h1>
        <p className="agent-intro">Give your research agent a paper library it can search, a citation graph it can traverse, and evidence it can explain.</p>
        <p className="agent-chinese">为研究智能体提供论文搜索、引用关系与相关工作发现。公开数据，无需 API 密钥。</p>
        <div className="agent-actions"><a className="agent-primary" href="#quickstart">Start querying ↓</a><a href={`${base}api/v1/manifest.json`}>Read API manifest ↗</a><a href={`${base}agents/README.md`}>Plain-text guide ↗</a></div>
      </section>
      <section className="agent-stats" aria-label="Dataset coverage">
        <div><b>{manifest.stats.papers.toLocaleString("en-US")}</b><span>paper records</span></div>
        <div><b>{(manifest.stats.citationEdges / 1_000_000).toFixed(2)}M</b><span>recorded citation edges</span></div>
        <div><b>{manifest.stats.venues} venues</b><span>2016–2025 publications</span></div>
        <div><b>No key</b><span>public, read-only access</span></div>
      </section>
      <section className="agent-section" id="quickstart">
        <p className="agent-kicker">01 / CHOOSE YOUR CONNECTION</p><h2>One dataset. Four ways in.</h2>
        <p>GitHub Pages serves the versioned JSON and database files. Queries run in your SDK, SQLite, or local MCP server. Adding a query string to a Pages URL does not execute a search.</p>
        <div className="agent-cards">
          <article><span>01</span><h3>Python</h3><p>Full-text search, both citation directions, bibliographic coupling, co-citation and bounded graph traversal.</p><a href={`${base}agents/papertrail.py`}>Download SDK + MCP server ↗</a><small>Python 3.11+ · no packages · SQLite FTS5</small></article>
          <article><span>02</span><h3>JavaScript</h3><p>Fetch compact venue search indexes and citation buckets. Explore with Node.js or directly in a browser.</p><a href={`${base}agents/papertrail.mjs`}>Download ES module ↗</a><small>Node.js 22+ · browser fetch + Web Crypto</small></article>
          <article><span>03</span><h3>SQLite</h3><p>An indexed relationship database for your own SQL, cross-venue analysis and offline agent workflows.</p><a href={`${base}api/v1/papertrail.sqlite.gz`}>Download database ↗</a><small>{Math.round(manifest.database.bytes / 1_000_000)} MB gzip · {Math.round(manifest.database.uncompressedBytes / 1_000_000)} MB extracted</small></article>
          <article><span>04</span><h3>MCP tools</h3><p>Six callable tools for an agent: search, paper, references, cited_by, related and graph.</p><a href="#mcp">Configure local stdio MCP ↓</a><small>Local process · uses the same verified cache</small></article>
        </div>
      </section>
      <section className="agent-section"><p className="agent-kicker">02 / TRY THE PUBLISHED DATA</p><h2>A real query, right here.</h2><p>This explorer uses the same downloadable JavaScript SDK. It fetches one venue index, then retrieves the selected paper’s recorded citation relationships.</p><AgentExplorer /></section>
      <section className="agent-section"><p className="agent-kicker">03 / COPY A WORKING CALL</p><h2>From a question to a graph.</h2>
        <div className="agent-code-grid"><article><h3>Python · full relationship queries</h3><p>Download <a href={`${base}agents/papertrail.py`}>papertrail.py</a> into your working directory. The first query downloads and verifies the database; later queries use the local cache.</p><pre><code>{pythonExample}</code></pre><small>Allow time for the first download and roughly 1 GB free disk space during extraction.</small></article>
          <article><h3>JavaScript · lighter HTTPS access</h3><p>Download <a href={`${base}agents/papertrail.mjs`}>papertrail.mjs</a>. Use a venue filter to keep requests small. Coupling and co-citation require Python or SQLite.</p><pre><code>{jsExample}</code></pre><small>JS ranks title/topic overlap; Python uses BM25 over title, topics and authors.</small></article></div>
      </section>
      <section className="agent-section" id="mcp"><p className="agent-kicker">04 / CONNECT AN AGENT</p><h2>Six tools. A local MCP server.</h2><p>Register the downloaded Python file in your MCP client. Replace the path with an absolute path on that machine. Initialize and list tools immediately; warm the database cache before short-timeout agent calls.</p><pre><code>{mcpExample}</code></pre><p>Transport: local stdio, MCP 2024-11-05. For an offline snapshot, append <code>--db /absolute/path/papertrail.sqlite</code> to the arguments. The <a href={`${base}api/v1/tools.json`}>tool schemas</a> list all parameters and bounds.</p></section>
      <section className="agent-section"><p className="agent-kicker">05 / DATA CONTRACT</p><h2>Relationships you can inspect.</h2>
        <div className="agent-table-wrap"><table><thead><tr><th>Query</th><th>Meaning</th><th>Bounds / evidence</th></tr></thead><tbody>
          <tr><td><code>search</code></td><td>Find words in paper metadata</td><td>Venue/year filters; limit ≤100; offset pagination</td></tr>
          <tr><td><code>paper</code></td><td>Resolve DOI, OpenAlex or stable source ID</td><td>Canonical metadata or an external identifier stub</td></tr>
          <tr><td><code>references</code></td><td>Source paper cites these targets</td><td>Recorded edges; provenance; limit ≤1,000</td></tr>
          <tr><td><code>cited_by</code></td><td>These corpus papers cite the target</td><td>Snapshot incoming edges, rather than global citation totals</td></tr>
          <tr><td><code>related</code></td><td>Shared references, co-citation or text overlap</td><td>Inferred similarity; reasons and counts; limit ≤100</td></tr>
          <tr><td><code>graph</code></td><td>Traverse a citation neighborhood</td><td>Depth ≤3; nodes ≤500; edges ≤5,000; truncation reported</td></tr>
        </tbody></table></div>
        <p>Snapshot: <code>{manifest.snapshot}</code>. {manifest.stats.internalCitationEdges.toLocaleString("en-US")} edges link two papers with full metadata in this corpus; other references can point to external identifier-only nodes. Empty references may reflect missing upstream data. No abstracts or full text are supplied.</p>
        <p>Preserve <code>metadataSources</code>, <code>sourceUrl</code> and edge provenance. Similarity is a discovery signal; check the original work before drawing conclusions. Unaligned external DOI/OpenAlex identifiers may represent the same work separately.</p>
      </section>
      <section className="agent-section"><p className="agent-kicker">06 / MACHINE DISCOVERY</p><h2>Readable by people. Usable by agents.</h2><div className="agent-resource-links">
        <a href={`${base}llms.txt`}>llms.txt · agent entry point ↗</a><a href={`${base}agents/README.md`}>Full guide · parameters, SQL and MCP ↗</a><a href={`${base}api/v1/manifest.json`}>Manifest · coverage and SHA-256 checksums ↗</a><a href={`${base}api/v1/openapi.json`}>OpenAPI · static GET resource contract ↗</a><a href={`${base}api/v1/tools.json`}>Tool schemas · callable local queries ↗</a><a href="https://github.com/jimmywuhkust/papertrail">Source · reproducible build and tests ↗</a>
      </div></section>
      <footer className="agent-footer"><Link href="/">← Open PaperTrail</Link><span>SDK MIT · public scholarly metadata · no account required</span><Link href="/methodology">Sources & methodology</Link></footer>
    </main>
  );
}
