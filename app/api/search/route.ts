import {
  OPENALEX_SELECT,
  dedupePapers,
  fetchJson,
  jsonResponse,
  normalizeCrossref,
  normalizeOpenAlex,
  rankPaper,
  tokenize,
} from "@/lib/paper-api";
import type { Paper } from "@/lib/types";

type SourceFilter = "all" | "acm" | "ietf";

async function searchOpenAlex(query: string, fromYear: number, rows: number) {
  const params = new URLSearchParams({
    search: query,
    "per-page": String(Math.min(50, rows)),
    select: OPENALEX_SELECT,
  });
  if (fromYear) params.set("filter", `from_publication_date:${fromYear}-01-01`);
  const payload = await fetchJson<{ results?: Array<Parameters<typeof normalizeOpenAlex>[0]> }>(
    `https://api.openalex.org/works?${params}`,
  );
  return (payload.results || []).map(normalizeOpenAlex).filter((paper): paper is Paper => Boolean(paper));
}

async function searchCrossref(query: string, fromYear: number, rows: number, source: SourceFilter) {
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
  return (payload.message?.items || []).map(normalizeCrossref).filter((paper): paper is Paper => Boolean(paper));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") || "").trim().slice(0, 300);
  const source = (["all", "acm", "ietf"].includes(url.searchParams.get("source") || "")
    ? url.searchParams.get("source")
    : "all") as SourceFilter;
  const fromYear = Math.max(0, Math.min(new Date().getFullYear(), Number(url.searchParams.get("fromYear")) || 0));
  const limit = Math.max(5, Math.min(40, Number(url.searchParams.get("limit")) || 24));
  if (query.length < 2) return jsonResponse({ error: "Enter at least two characters." }, 400, 0);

  try {
    const tasks: Array<Promise<Paper[]>> = [];
    if (source === "all") tasks.push(searchOpenAlex(query, fromYear, limit + 8));
    tasks.push(searchCrossref(query, fromYear, limit + 8, source));
    const settled = await Promise.allSettled(tasks);
    const papers = dedupePapers(
      settled.flatMap((item) => (item.status === "fulfilled" ? item.value : [])),
    )
      .filter((paper) => source !== "acm" || paper.doi?.startsWith("10.1145/"))
      .filter((paper) => source !== "ietf" || paper.doi?.startsWith("10.17487/"))
      .map((paper) => rankPaper(paper, tokenize(query)))
      .sort((a, b) => (b.score || 0) - (a.score || 0) || b.citationCount - a.citationCount)
      .slice(0, limit);
    if (!papers.length && settled.every((item) => item.status === "rejected")) {
      return jsonResponse({ error: "Research indexes are temporarily unavailable." }, 503, 0);
    }
    return jsonResponse({ papers, query, source, fromYear }, 200, 900);
  } catch {
    return jsonResponse({ error: "Search failed. Please try again shortly." }, 502, 0);
  }
}

