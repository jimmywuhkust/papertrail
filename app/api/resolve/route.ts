import {
  OPENALEX_SELECT,
  cleanDoi,
  dedupePapers,
  fetchJson,
  jsonResponse,
  normalizeCrossref,
  normalizeOpenAlex,
} from "@/lib/paper-api";
import type { Paper } from "@/lib/types";

async function resolveOpenAlex(dois: string[]): Promise<Paper[]> {
  const papers: Paper[] = [];
  for (let index = 0; index < dois.length; index += 30) {
    const batch = dois.slice(index, index + 30);
    const params = new URLSearchParams({
      filter: `doi:${batch.join("|")}`,
      "per-page": "50",
      select: OPENALEX_SELECT,
    });
    const payload = await fetchJson<{ results?: Array<Parameters<typeof normalizeOpenAlex>[0]> }>(
      `https://api.openalex.org/works?${params}`,
    );
    papers.push(...(payload.results || []).map(normalizeOpenAlex).filter((paper): paper is Paper => Boolean(paper)));
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { dois?: string[] };
    const dois = [...new Set((body.dois || []).map(cleanDoi).filter(Boolean))].slice(0, 60);
    if (!dois.length) return jsonResponse({ papers: [], unresolved: [] }, 200, 0);
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
    return jsonResponse(
      { papers, unresolved: dois.filter((doi) => !nowFound.has(doi)) },
      200,
      86_400,
    );
  } catch {
    return jsonResponse({ error: "The DOI list could not be resolved." }, 400, 0);
  }
}

