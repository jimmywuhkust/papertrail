import {
  OPENALEX_SELECT,
  cleanDoi,
  fetchJson,
  jsonResponse,
  normalizeOpenAlex,
  rankPaper,
  tokenize,
  topKeywords,
} from "@/lib/paper-api";
import type { Paper } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      title?: string;
      text?: string;
      citedDois?: string[];
      fromYear?: number;
      source?: "all" | "acm" | "ietf";
      limit?: number;
    };
    const text = `${body.title || ""} ${body.text || ""}`.trim().slice(0, 50_000);
    if (text.length < 20) return jsonResponse({ error: "Add a title or abstract before finding citation gaps." }, 400, 0);
    const keywords = topKeywords(text, 12);
    const query = keywords.slice(0, 9).join(" ");
    const fromYear = Math.max(0, Math.min(new Date().getFullYear(), Number(body.fromYear) || new Date().getFullYear() - 7));
    const limit = Math.max(5, Math.min(30, Number(body.limit) || 16));
    const params = new URLSearchParams({
      search: query,
      "per-page": "50",
      select: OPENALEX_SELECT,
      filter: `from_publication_date:${fromYear}-01-01`,
    });
    const payload = await fetchJson<{ results?: Array<Parameters<typeof normalizeOpenAlex>[0]> }>(
      `https://api.openalex.org/works?${params}`,
    );
    const cited = new Set((body.citedDois || []).map(cleanDoi));
    const queryTokens = tokenize(text).slice(0, 1200);
    const source = body.source || "all";
    const papers = (payload.results || [])
      .map(normalizeOpenAlex)
      .filter((paper): paper is Paper => Boolean(paper))
      .filter((paper) => !paper.doi || !cited.has(cleanDoi(paper.doi)))
      .filter((paper) => source !== "acm" || paper.doi?.startsWith("10.1145/"))
      .filter((paper) => source !== "ietf" || paper.doi?.startsWith("10.17487/"))
      .map((paper) => rankPaper(paper, queryTokens))
      .filter((paper) => (paper.score || 0) >= 18)
      .sort((a, b) => (b.score || 0) - (a.score || 0) || b.citationCount - a.citationCount)
      .slice(0, limit);
    return jsonResponse({ papers, keywords, method: "transparent-v1" }, 200, 1_800);
  } catch {
    return jsonResponse({ error: "Recommendations are temporarily unavailable." }, 502, 0);
  }
}

