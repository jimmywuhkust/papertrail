import {
  OPENALEX_SELECT,
  cleanDoi,
  dedupePapers,
  fetchJson,
  normalizeCrossref,
  normalizeOpenAlex,
  rankPaper,
  shortOpenAlexId,
  tokenize,
  topKeywords,
} from "./paper-api";
import type { Paper } from "./types";

export type SourceFilter = "all" | "acm" | "ietf";

export class ServiceError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

type OpenAlexResults = { results?: Array<Parameters<typeof normalizeOpenAlex>[0]> };

function normalizeResults(payload: OpenAlexResults): Paper[] {
  return (payload.results || [])
    .map(normalizeOpenAlex)
    .filter((paper): paper is Paper => Boolean(paper));
}

async function searchOpenAlex(query: string, fromYear: number, rows: number): Promise<Paper[]> {
  const params = new URLSearchParams({
    search: query,
    "per-page": String(Math.min(50, rows)),
    select: OPENALEX_SELECT,
  });
  if (fromYear) params.set("filter", `from_publication_date:${fromYear}-01-01`);
  return normalizeResults(await fetchJson<OpenAlexResults>(`https://api.openalex.org/works?${params}`));
}

async function searchCrossref(query: string, fromYear: number, rows: number, source: SourceFilter): Promise<Paper[]> {
  const filters = [];
  if (fromYear) filters.push(`from-pub-date:${fromYear}-01-01`);
  if (source === "acm") filters.push("prefix:10.1145");
  if (source === "ietf") filters.push("prefix:10.17487");
  const params = new URLSearchParams({
    "query.bibliographic": query,
    rows: String(Math.min(50, rows)),
    select: "DOI,title,author,published,issued,container-title,is-referenced-by-count,URL,type,subject",
  });
  if (filters.length) params.set("filter", filters.join(","));
  const payload = await fetchJson<{
    message?: { items?: Array<Parameters<typeof normalizeCrossref>[0]> };
  }>(`https://api.crossref.org/works?${params}`);
  return (payload.message?.items || [])
    .map(normalizeCrossref)
    .filter((paper): paper is Paper => Boolean(paper));
}

function filterBySource(papers: Paper[], source: SourceFilter): Paper[] {
  return papers
    .filter((paper) => source !== "acm" || paper.doi?.startsWith("10.1145/"))
    .filter((paper) => source !== "ietf" || paper.doi?.startsWith("10.17487/"));
}

export async function searchPapers(input: {
  query: string;
  fromYear?: number;
  source?: SourceFilter;
  limit?: number;
}): Promise<{ papers: Paper[]; query: string; source: SourceFilter; fromYear: number }> {
  const query = input.query.trim().slice(0, 300);
  const source = input.source || "all";
  const fromYear = Math.max(0, Math.min(new Date().getFullYear(), Number(input.fromYear) || 0));
  const limit = Math.max(5, Math.min(40, Number(input.limit) || 24));
  if (query.length < 2) throw new ServiceError("Enter at least two characters.", 400);

  const tasks: Array<Promise<Paper[]>> = [];
  if (source === "all") tasks.push(searchOpenAlex(query, fromYear, limit + 8));
  tasks.push(searchCrossref(query, fromYear, limit + 8, source));
  const settled = await Promise.allSettled(tasks);
  const papers = filterBySource(
    dedupePapers(settled.flatMap((item) => (item.status === "fulfilled" ? item.value : []))),
    source,
  )
    .map((paper) => rankPaper(paper, tokenize(query)))
    .sort((a, b) => (b.score || 0) - (a.score || 0) || b.citationCount - a.citationCount)
    .slice(0, limit);
  if (!papers.length && settled.every((item) => item.status === "rejected")) {
    throw new ServiceError("Research indexes are temporarily unavailable.", 503);
  }
  return { papers, query, source, fromYear };
}

export async function recommendPapers(body: {
  title?: string;
  text?: string;
  citedDois?: string[];
  fromYear?: number;
  source?: SourceFilter;
  limit?: number;
}): Promise<{ papers: Paper[]; keywords: string[]; method: string }> {
  const text = `${body.title || ""} ${body.text || ""}`.trim().slice(0, 50_000);
  if (text.length < 20) {
    throw new ServiceError("Add a title or abstract before finding citation gaps.", 400);
  }
  const keywords = topKeywords(text, 12);
  const query = keywords.slice(0, 9).join(" ");
  const fromYear = Math.max(
    0,
    Math.min(new Date().getFullYear(), Number(body.fromYear) || new Date().getFullYear() - 7),
  );
  const limit = Math.max(5, Math.min(30, Number(body.limit) || 16));
  const params = new URLSearchParams({
    search: query,
    "per-page": "50",
    select: OPENALEX_SELECT,
    filter: `from_publication_date:${fromYear}-01-01`,
  });
  const payload = await fetchJson<OpenAlexResults>(`https://api.openalex.org/works?${params}`);
  const cited = new Set((body.citedDois || []).map(cleanDoi));
  const queryTokens = tokenize(text).slice(0, 1200);
  const source = body.source || "all";
  const papers = filterBySource(
    normalizeResults(payload).filter((paper) => !paper.doi || !cited.has(cleanDoi(paper.doi))),
    source,
  )
    .map((paper) => rankPaper(paper, queryTokens))
    .filter((paper) => (paper.score || 0) >= 18)
    .sort((a, b) => (b.score || 0) - (a.score || 0) || b.citationCount - a.citationCount)
    .slice(0, limit);
  return { papers, keywords, method: "transparent-v1" };
}

async function resolveOpenAlex(dois: string[]): Promise<Paper[]> {
  const papers: Paper[] = [];
  for (let index = 0; index < dois.length; index += 30) {
    const batch = dois.slice(index, index + 30);
    const params = new URLSearchParams({
      filter: `doi:${batch.join("|")}`,
      "per-page": "50",
      select: OPENALEX_SELECT,
    });
    papers.push(...normalizeResults(await fetchJson<OpenAlexResults>(`https://api.openalex.org/works?${params}`)));
  }
  return papers;
}

async function resolveCrossref(doi: string): Promise<Paper | null> {
  try {
    const payload = await fetchJson<{ message?: Parameters<typeof normalizeCrossref>[0] }>(
      `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
    );
    return payload.message ? normalizeCrossref(payload.message) : null;
  } catch {
    return null;
  }
}

export async function resolveDois(input: string[]): Promise<{ papers: Paper[]; unresolved: string[] }> {
  const dois = [...new Set(input.map(cleanDoi).filter(Boolean))].slice(0, 60);
  if (!dois.length) return { papers: [], unresolved: [] };
  let papers: Paper[] = [];
  try {
    papers = await resolveOpenAlex(dois);
  } catch {
    // Crossref below still resolves a useful bounded subset.
  }
  const found = new Set(papers.map((paper) => cleanDoi(paper.doi)));
  const unresolved = dois.filter((doi) => !found.has(doi));
  const fallback = await Promise.all(unresolved.slice(0, 12).map(resolveCrossref));
  papers = dedupePapers([...papers, ...fallback.filter((paper): paper is Paper => Boolean(paper))]);
  const nowFound = new Set(papers.map((paper) => cleanDoi(paper.doi)));
  return { papers, unresolved: dois.filter((doi) => !nowFound.has(doi)) };
}

export async function expandWorks(input: string[]): Promise<{ papers: Paper[] }> {
  const ids = [...new Set(input.map(shortOpenAlexId).filter((id) => /^W\d+$/i.test(id)))].slice(0, 40);
  if (!ids.length) return { papers: [] };
  const params = new URLSearchParams({
    filter: `openalex_id:${ids.join("|")}`,
    "per-page": "50",
    select: OPENALEX_SELECT,
  });
  const papers = normalizeResults(await fetchJson<OpenAlexResults>(`https://api.openalex.org/works?${params}`));
  return { papers };
}

export async function fetchCitingWorks(openAlexId: string, limit = 12): Promise<{ papers: Paper[] }> {
  const id = shortOpenAlexId(openAlexId);
  if (!/^W\d+$/i.test(id)) return { papers: [] };
  const params = new URLSearchParams({
    filter: `cites:${id}`,
    "per-page": String(Math.max(1, Math.min(50, limit))),
    select: OPENALEX_SELECT,
    sort: "cited_by_count:desc",
  });
  const papers = normalizeResults(await fetchJson<OpenAlexResults>(`https://api.openalex.org/works?${params}`));
  return { papers };
}
