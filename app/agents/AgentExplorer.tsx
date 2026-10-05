"use client";

import { useRef, useState } from "react";
import { PaperTrail, PaperTrailError, type Author, type Envelope, type Paper } from "../../public/agents/papertrail.mjs";
import { dataUrl } from "@/lib/client-gateway";

type Mode = "author" | "topic" | "title" | "identifier";
type Query = { mode: Mode; text: string; affiliation: string; venue: string; authorId?: string };
type Relation = { id: string; title: string; direction: "references" | "cited_by"; result: Envelope<Paper> };
const venues = [["infocom", "IEEE INFOCOM"], ["mobicom", "ACM MobiCom"], ["mobisys", "ACM MobiSys"], ["sensys", "ACM SenSys"], ["nsdi", "USENIX NSDI"], ["sigcomm", "ACM SIGCOMM"], ["ubicomp", "UbiComp / IMWUT"], ["tit", "IEEE TIT"], ["jsac", "IEEE JSAC"], ["nature-communications", "Nature Communications"]];

export default function AgentExplorer() {
  const [mode, setMode] = useState<Mode>("author");
  const [query, setQuery] = useState("Mo Li");
  const [affiliation, setAffiliation] = useState("HKUST");
  const [venue, setVenue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [authors, setAuthors] = useState<Author[]>([]);
  const [authorCursor, setAuthorCursor] = useState<string | null>(null);
  const [authorQuery, setAuthorQuery] = useState<{ text: string; affiliation: string } | null>(null);
  const [result, setResult] = useState<Envelope<Paper> | null>(null);
  const [active, setActive] = useState<Query | null>(null);
  const [relation, setRelation] = useState<Relation | null>(null);
  const [snapshot, setSnapshot] = useState("");
  const api = useRef<PaperTrail | null>(null);

  function client() {
    api.current ??= new PaperTrail({ baseUrl: new URL(dataUrl("/"), window.location.origin).href });
    return api.current;
  }
  function report(err: unknown) { setError(err instanceof PaperTrailError ? `${err.error.code}: ${err.message}` : err instanceof Error ? err.message : "Query failed"); }
  function changeMode(value: Mode) { setMode(value); setQuery(value === "author" ? "Mo Li" : value === "identifier" ? "10.1145/3372224.3419200" : "federated learning"); }

  async function readPapers(parameters: Query, cursor?: string | null) {
    const sdk = client(), filter = { venue: parameters.venue || null, limit: 5, cursor };
    const found = parameters.authorId ? await sdk.authorPapers(parameters.authorId, filter) : parameters.mode === "identifier" ? await sdk.paper(parameters.text) : await sdk.search(parameters.text, { ...filter, fields: parameters.mode === "title" ? ["title"] : ["title", "topics"] });
    setResult(found); setSnapshot(found.snapshotId); setActive(parameters); setRelation(null);
  }
  async function search(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setResult(null); setAuthors([]); setRelation(null); setActive(null);
    setAuthorCursor(null);
    const parameters = { mode, text: query, affiliation, venue };
    try {
      if (mode === "author") {
        const found = await client().authors(query, { affiliation: affiliation || null, limit: 20 });
        setAuthors(found.items); setSnapshot(found.snapshotId);
        setAuthorCursor(found.pagination?.nextCursor || null); setAuthorQuery({ text: query, affiliation });
        if (found.items.length === 1) await readPapers({ ...parameters, authorId: found.items[0].id });
        else if (!found.items.length) setError("No evidenced candidate matches this name and affiliation in the snapshot. Try without the affiliation filter.");
      } else await readPapers(parameters);
    } catch (err) { report(err); } finally { setBusy(false); }
  }
  async function choose(authorId: string) {
    setBusy(true); setError("");
    try { await readPapers({ mode: "author", text: query, affiliation, venue, authorId }); } catch (err) { report(err); } finally { setBusy(false); }
  }
  async function next() {
    if (!active || !result?.pagination?.nextCursor) return;
    setBusy(true); setError("");
    try { await readPapers(active, result.pagination.nextCursor); } catch (err) { report(err); } finally { setBusy(false); }
  }
  async function nextAuthors() {
    if (!authorCursor || !authorQuery) return;
    setBusy(true); setError("");
    try {
      const found = await client().authors(authorQuery.text, { affiliation: authorQuery.affiliation || null, cursor: authorCursor });
      setAuthors(found.items); setAuthorCursor(found.pagination?.nextCursor || null); setResult(null); setRelation(null);
    } catch (err) { report(err); } finally { setBusy(false); }
  }
  async function inspect(paper: Paper, direction: Relation["direction"], cursor?: string | null) {
    setBusy(true); setError("");
    try {
      const options = { limit: 5, expand: true, cursor };
      const found = direction === "references" ? await client().references(paper.id, options) : await client().citedBy(paper.id, options);
      setRelation({ id: paper.id, title: paper.title || paper.id, direction, result: found });
    } catch (err) { report(err); } finally { setBusy(false); }
  }

  function paperList(items: Paper[], inspectable: boolean) {
    return <ul className="agent-results">{items.map((paper) => <li key={paper.id}><div><b>{paper.title || paper.id}</b><small>{paper.year ? `${paper.year} · ${paper.venueId} · ` : ""}{paper.authors?.join(", ") || paper.resolutionState}{paper.doi && <> · <a href={`https://doi.org/${paper.doi}`}>DOI ↗</a></>}</small>{paper.matchEvidence && <small>Match: {paper.matchEvidence.method} · {paper.matchEvidence.matchedFields?.join(", ") || paper.matchEvidence.associationStatus}{paper.matchEvidence.sourceUrl && <> · <a href={paper.matchEvidence.sourceUrl}>Evidence ↗</a></>}</small>}{paper.counts && <small>Upstream citations: {paper.counts.upstreamCitationCount ?? "unknown"} · Corpus citations: {paper.counts.incomingCorpusCitationCount} · Recorded references: {paper.counts.recordedReferenceCount}</small>}{paper.relationship && <small>Citation source: {paper.relationship.sources.join(" + ")}</small>}{paper.sourceUrl && <small><a href={paper.sourceUrl}>Source record ↗</a></small>}</div>{inspectable && paper.resolutionState !== "not_in_snapshot" && <div className="agent-row-actions"><button type="button" disabled={busy} onClick={() => inspect(paper, "references")}>References →</button><button type="button" disabled={busy} onClick={() => inspect(paper, "cited_by")}>Cited by →</button></div>}</li>)}</ul>;
  }
  return <div className="agent-explorer"><form onSubmit={search}>
    <label>Search mode<select value={mode} onChange={(e) => changeMode(e.target.value as Mode)}><option value="author">Author identity</option><option value="topic">Topic / title words</option><option value="title">Title words</option><option value="identifier">DOI / OpenAlex / source ID</option></select></label>
    <label>{mode === "author" ? "Author name" : mode === "identifier" ? "Paper identifier" : "Research question"}<input value={query} onChange={(e) => setQuery(e.target.value)} required maxLength={300} /></label>
    {mode === "author" && <label>Affiliation (optional)<input value={affiliation} onChange={(e) => setAffiliation(e.target.value)} placeholder="HKUST" maxLength={200} /></label>}
    {mode !== "identifier" && <label>Venue<select value={venue} onChange={(e) => setVenue(e.target.value)}><option value="">All 10 venues</option>{venues.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
    <button type="submit" disabled={busy}>{busy ? "Reading data…" : "Query papers →"}</button>
  </form><p aria-live="polite">{result ? `${result.pagination?.total ?? result.items.length} matches · ${result.pagination && result.items.length ? `${result.pagination.offset + 1}–${result.pagination.offset + result.items.length}` : result.items.length} shown` : "Find an author, then read their evidenced publications. No API key needed."}{snapshot && ` · snapshot ${snapshot}`}</p>
    {error && <p role="alert" className="agent-error">{error}</p>}
    {authors.map((author) => <article className="agent-author" key={author.id}><h3>{author.name}</h3><p>{author.identityStatus === "upstream_identifier" ? "Identified upstream researcher" : "Name-only group · identity unresolved"} · {author.paperCount} corpus papers</p><p>{author.affiliations.map((a) => <a key={a.name} href={a.sourceUrl}>{a.name} ↗ </a>)}</p><small><code>{author.id}</code> · Affiliation evidence identifies the researcher; it does not assert an affiliation for every paper.</small><button type="button" disabled={busy} onClick={() => choose(author.id)}>Read publications →</button></article>)}
    {authorCursor && <button type="button" disabled={busy} onClick={nextAuthors}>Next author candidates →</button>}
    {result && <>{result.warnings.map((warning) => <p key={warning}>{warning}</p>)}{paperList(result.items, true)}{result.pagination?.hasMore && <button type="button" disabled={busy} onClick={next}>Next papers →</button>}<details><summary>Query result · JSON</summary><pre><code>{JSON.stringify(result, null, 2)}</code></pre></details></>}
    {relation && <section className="agent-relations" aria-live="polite"><h3>{relation.direction === "references" ? "Recorded references" : "Citations from corpus papers"}</h3><p>{relation.title}</p><p>{relation.result.pagination?.total} recorded edges · Data status: {relation.result.relationshipStatus}. External references may have no title in this corpus.</p>{paperList(relation.result.items, false)}{relation.result.pagination?.hasMore && <button type="button" disabled={busy} onClick={() => inspect({ id: relation.id, title: relation.title }, relation.direction, relation.result.pagination?.nextCursor)}>Next citations →</button>}<details><summary>Relationship evidence · JSON</summary><pre><code>{JSON.stringify(relation.result, null, 2)}</code></pre></details></section>}
  </div>;
}
