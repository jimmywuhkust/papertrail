"use client";

import { useState } from "react";
import { PaperTrail } from "../../public/agents/papertrail.mjs";
import { dataUrl } from "@/lib/client-gateway";

type Hit = { id: string; title: string; year: number; venueId: string; score: number };

export default function AgentExplorer() {
  const [query, setQuery] = useState("federated learning");
  const [venue, setVenue] = useState("infocom");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [summary, setSummary] = useState("");
  const [relationship, setRelationship] = useState("");
  const [api, setApi] = useState<PaperTrail | null>(null);

  function client() {
    if (api) return api;
    const result = new PaperTrail({ baseUrl: new URL(dataUrl("/"), window.location.origin).href });
    setApi(result);
    return result;
  }

  async function search(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setRelationship(""); setHits([]); setSummary("");
    try {
      const result = await client().search(query, { venue, limit: 5 });
      setHits(result.papers); setSummary(`${result.total} matches · showing up to 5 · ${result.snapshot.slice(0, 10)} snapshot`);
    } catch (err) { setError(err instanceof Error ? err.message : "Query failed"); }
    finally { setBusy(false); }
  }

  async function inspect(id: string) {
    setBusy(true); setError("");
    try {
      const sdk = client();
      const [paper, references, citedBy] = await Promise.all([sdk.paper(id), sdk.references(id, { limit: 5 }), sdk.citedBy(id, { limit: 5 })]);
      setRelationship(JSON.stringify({ paper, references, citedBy }, null, 2));
    } catch (err) { setError(err instanceof Error ? err.message : "Lookup failed"); }
    finally { setBusy(false); }
  }

  return <div className="agent-explorer"><form onSubmit={search}><label>Research question<input value={query} onChange={(event) => setQuery(event.target.value)} required maxLength={300} /></label><label>Venue<select value={venue} onChange={(event) => setVenue(event.target.value)}>{[["infocom", "IEEE INFOCOM"], ["mobicom", "ACM MobiCom"], ["mobisys", "ACM MobiSys"], ["sensys", "ACM SenSys"], ["nsdi", "USENIX NSDI"], ["sigcomm", "ACM SIGCOMM"], ["ubicomp", "UbiComp / IMWUT"], ["tit", "IEEE TIT"], ["jsac", "IEEE JSAC"]].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><button type="submit" disabled={busy}>{busy ? "Reading data…" : "Query papers →"}</button></form><p aria-live="polite">{summary || "Choose a venue and run a query. No API key needed."}</p>{error && <p role="alert" className="agent-error">{error}</p>}<ul className="agent-results">{hits.map((hit) => <li key={hit.id}><div><b>{hit.title}</b><small>{hit.year} · {hit.venueId} · {hit.id}</small></div><button type="button" disabled={busy} onClick={() => inspect(hit.id)}>Inspect citations ↗</button></li>)}</ul>{relationship && <details open><summary>Paper and recorded relationships · JSON</summary><pre><code>{relationship}</code></pre></details>}</div>;
}
