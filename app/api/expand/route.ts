import {
  OPENALEX_SELECT,
  fetchJson,
  jsonResponse,
  normalizeOpenAlex,
  shortOpenAlexId,
} from "@/lib/paper-api";
import type { Paper } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { ids?: string[] };
    const ids = [...new Set((body.ids || []).map(shortOpenAlexId).filter((id) => /^W\d+$/i.test(id)))].slice(0, 40);
    if (!ids.length) return jsonResponse({ papers: [] }, 200, 0);
    const params = new URLSearchParams({
      filter: `openalex_id:${ids.join("|")}`,
      "per-page": "50",
      select: OPENALEX_SELECT,
    });
    const payload = await fetchJson<{ results?: Array<Parameters<typeof normalizeOpenAlex>[0]> }>(
      `https://api.openalex.org/works?${params}`,
    );
    const papers = (payload.results || []).map(normalizeOpenAlex).filter((paper): paper is Paper => Boolean(paper));
    return jsonResponse({ papers }, 200, 86_400);
  } catch {
    return jsonResponse({ error: "This graph layer is temporarily unavailable." }, 502, 0);
  }
}

