import type { Metadata } from "next";
import Link from "next/link";
import manifest from "../../public/api/v2/manifest.json";
import AgentExplorer from "./AgentExplorer";
import "./agents.css";

export const metadata: Metadata = {
  title: "Agent API · Paper search & citation database",
  description: "Query PaperTrail with Python, JavaScript, SQLite or local MCP tools. Search papers, follow citations, and discover related work without an API key.",
};

const base = "https://jimmywuhkust.github.io/papertrail/";
const pythonExample = `from papertrail import PaperTrail

api = PaperTrail()  # manifest only; no SQLite download
person = api.authors("Mo Li", affiliation="HKUST")["items"][0]
works = api.author_papers(person["id"], limit=5)
id = works["items"][0]["id"]
print(api.references(id, limit=5, expand=True))
print(api.cited_by(id, limit=5))
print(api.status())
# This operation downloads verified SQLite lazily:
print(api.related(id, method="coupling", limit=5))
api.close()`;
const jsExample = `import { PaperTrail } from "./papertrail.mjs";

const api = new PaperTrail();
const people = await api.authors("Mo Li", { affiliation: "HKUST" });
const works = await api.authorPapers(people.items[0].id, { limit: 5 });
const id = works.items[0].id;
console.log(await api.references(id, { limit: 5, expand: true }));
console.log(await api.citedBy(id));
// Explicit title/topic matching, identical across SDKs:
console.log(await api.search("federated learning", {
  venue: "infocom", fields: ["title", "topics"], match: "all_tokens"
}));`;
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
        <p className="agent-kicker">PAPERTRAIL / AGENT API / V2</p>
        <h1>Follow the paper.<br /><em>Query the connections.</em></h1>
        <p className="agent-intro">Give your research agent a paper library it can search, a citation graph it can traverse, and evidence it can explain.</p>
        <p className="agent-chinese">为研究智能体提供论文搜索、引用关系与相关工作发现。公开数据，无需 API 密钥。</p>
        <div className="agent-actions"><a className="agent-primary" href="#quickstart">Start querying ↓</a><a href={`${base}api/v2/manifest.json`}>Read API manifest ↗</a><a href={`${base}agents/README.md`}>Plain-text guide ↗</a></div>
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
          <article><span>01</span><h3>Python</h3><p>Evidenced author lookup, explicit field search, both citation directions, coupling, co-citation and bounded graph traversal.</p><a href={`${base}agents/papertrail.py`}>Download SDK + MCP server ↗</a><small>Python 3.11+ · no packages · lazy SQLite</small></article>
          <article><span>02</span><h3>JavaScript</h3><p>Fetch compact venue search indexes and citation buckets. Explore with Node.js or directly in a browser.</p><a href={`${base}agents/papertrail.mjs`}>Download ES module ↗</a><small>Node.js 22+ · browser fetch + Web Crypto</small></article>
          <article><span>03</span><h3>SQLite</h3><p>An indexed relationship database for your own SQL, cross-venue analysis and offline agent workflows.</p><a href={`${base}${manifest.snapshotPath}${manifest.database.url}`}>Download database ↗</a><small>{Math.round(manifest.database.bytes / 1_000_000)} MB gzip · {Math.round(manifest.database.uncompressedBytes / 1_000_000)} MB extracted</small></article>
          <article><span>04</span><h3>MCP tools</h3><p>Eleven tools, including researcher lookup, publications, batch resolution, status and cache preparation.</p><a href="#mcp">Configure local stdio MCP ↓</a><small>Local process · uses the same verified cache</small></article>
        </div>
      </section>
      <section className="agent-section"><p className="agent-kicker">02 / TRY THE PUBLISHED DATA</p><h2>A real query, right here.</h2><p>Resolve an author by name and affiliation, search title/topic words, or look up an identifier. The explorer uses the same downloadable SDK and shows matching evidence, source links and citation pages.</p><AgentExplorer /></section>
      <section className="agent-section"><p className="agent-kicker">03 / COPY A WORKING CALL</p><h2>From a question to a graph.</h2>
        <div className="agent-code-grid"><article><h3>Python · full relationship queries</h3><p>Download <a href={`${base}agents/papertrail.py`}>papertrail.py</a> into your working directory. Author, search and relationship queries read compressed resources on demand. Only coupling, co-citation and graph traversal download SQLite.</p><pre><code>{pythonExample}</code></pre><small>Use status to check readiness and warm_cache to prepare SQLite before time-sensitive calls. Progress is available in the CLI with --progress.</small></article>
          <article><h3>JavaScript · lighter HTTPS access</h3><p>Download <a href={`${base}agents/papertrail.mjs`}>papertrail.mjs</a>. Use a venue filter to keep requests small. Coupling and co-citation require Python or SQLite.</p><pre><code>{jsExample}</code></pre><small>Both SDKs use the same token matching, score, stable ordering, cursor and response schema.</small></article></div>
      </section>
      <section className="agent-section" id="mcp"><p className="agent-kicker">04 / CONNECT AN AGENT</p><h2>Eleven tools. A local MCP server.</h2><p>Register the downloaded Python file in your MCP client. Replace the path with an absolute path on that machine. Initialization and tool discovery need no download. Use status for capabilities and warm_cache to prepare the database for graph queries.</p><pre><code>{mcpExample}</code></pre><p>Transport: local stdio, MCP 2024-11-05. For an offline snapshot, append <code>--db /absolute/path/papertrail.sqlite</code> to the arguments. The <a href={`${base}api/v2/tools.json`}>tool schemas</a> list all parameters and bounds.</p></section>
      <section className="agent-section"><p className="agent-kicker">05 / DATA CONTRACT</p><h2>Relationships you can inspect.</h2>
        <div className="agent-table-wrap"><table><thead><tr><th>Query</th><th>Meaning</th><th>Bounds / evidence</th></tr></thead><tbody>
          <tr><td><code>authors / author_papers</code></td><td>Resolve a researcher, then collect evidenced papers</td><td>Stable upstream IDs, name variants, sourced affiliations; ambiguous name groups labeled</td></tr>
          <tr><td><code>papers</code></td><td>Batch identifier resolution with field projection</td><td>At most 100 inputs; one result per input, in input order</td></tr>
          <tr><td><code>status / warm_cache</code></td><td>Inspect readiness or prepare local SQLite</td><td>Versions, capabilities, sizes and checksum verification</td></tr>
          <tr><td><code>search</code></td><td>Find words in paper metadata</td><td>Explicit fields/match; venue/year filters; limit ≤100; snapshot-bound cursor</td></tr>
          <tr><td><code>paper</code></td><td>Resolve DOI, OpenAlex or stable source ID</td><td>resolved / external_reference / not_in_snapshot; malformed input gives INVALID_IDENTIFIER</td></tr>
          <tr><td><code>references</code></td><td>Source paper cites these targets</td><td>Directed edges; source evidence; unknown vs available data; limit ≤1,000</td></tr>
          <tr><td><code>cited_by</code></td><td>These corpus papers cite the target</td><td>Snapshot incoming edges, rather than global citation totals</td></tr>
          <tr><td><code>related</code></td><td>Shared references, co-citation or text overlap</td><td>Shared witnesses, count and cosine normalization; text is inferred metadata overlap</td></tr>
          <tr><td><code>graph</code></td><td>Traverse a citation neighborhood</td><td>Depth ≤3; nodes ≤500; edges ≤5,000; truncation reported</td></tr>
        </tbody></table></div>
        <p>Snapshot: <code>{manifest.snapshotId}</code> · paper data: <code>{manifest.snapshot}</code>. {manifest.stats.internalCitationEdges.toLocaleString("en-US")} edges link two papers with full metadata in this corpus; other references can point to external identifier-only nodes. Reference availability is explicit; an empty unknown list is not evidence of zero references. No abstracts or full text are supplied.</p>
        <p>Preserve <code>metadataSources</code>, <code>sourceUrl</code> and edge provenance. Similarity is a discovery signal; check the original work before drawing conclusions. Unaligned external DOI/OpenAlex identifiers may represent the same work separately.</p>
      </section>
      <section className="agent-section"><h2>Know what each connection supports.</h2><div className="agent-table-wrap"><table><thead><tr><th>Capability</th><th>JavaScript</th><th>Python / MCP</th></tr></thead><tbody><tr><td>Author identities, search, batch, citations</td><td>On-demand compressed resources</td><td>Same results and matching</td></tr><tr><td>Title/topic related work</td><td>Weighted word overlap</td><td>Same inferred signal</td></tr><tr><td>Coupling, co-citation, graph</td><td>Use Python / SQLite</td><td>Verified lazy SQLite download</td></tr><tr><td>Pagination and evidence</td><td>Snapshot/query-bound cursors</td><td>Same envelopes and cursor format</td></tr></tbody></table></div><p>Default search covers title and topics. Specify authors explicitly; names must match within one author entry. Institution evidence identifies a researcher and does not assert their affiliation for every publication. Every response states corpus coverage and warnings.</p></section>
      <section className="agent-section"><p className="agent-kicker">06 / MACHINE DISCOVERY</p><h2>Readable by people. Usable by agents.</h2><div className="agent-resource-links">
        <a href={`${base}llms.txt`}>llms.txt · agent entry point ↗</a><a href={`${base}agents/README.md`}>Full guide · parameters, SQL and MCP ↗</a><a href={`${base}api/v2/manifest.json`}>Manifest · coverage and SHA-256 checksums ↗</a><a href={`${base}api/v2/openapi.json`}>OpenAPI · static GET resource contract ↗</a><a href={`${base}api/v2/tools.json`}>Tool schemas · callable local queries ↗</a><a href={`${base}api/v2/schemas.json`}>Output schemas · exact result and error shapes ↗</a><a href={`${base}api/v2/benchmark.json`}>Identity benchmark · results, calls and bytes ↗</a><a href="https://github.com/jimmywuhkust/papertrail">Source · reproducible build and tests ↗</a>
      </div></section>
      <footer className="agent-footer"><Link href="/">← Open PaperTrail</Link><span>SDK MIT · public scholarly metadata · no account required</span><Link href="/methodology">Sources & methodology</Link></footer>
    </main>
  );
}
