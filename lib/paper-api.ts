import type { Paper } from "./types";

type OpenAlexWork = {
  id?: string;
  doi?: string;
  display_name?: string;
  publication_year?: number;
  cited_by_count?: number;
  authorships?: Array<{ author?: { display_name?: string } }>;
  primary_location?: {
    landing_page_url?: string;
    source?: { display_name?: string };
  };
  best_oa_location?: { landing_page_url?: string };
  topics?: Array<{ display_name?: string }>;
  referenced_works?: string[];
  related_works?: string[];
  type?: string;
};

type CrossrefWork = {
  DOI?: string;
  title?: string[];
  author?: Array<{ given?: string; family?: string }>;
  published?: { "date-parts"?: number[][] };
  issued?: { "date-parts"?: number[][] };
  "container-title"?: string[];
  "is-referenced-by-count"?: number;
  URL?: string;
  type?: string;
  subject?: string[];
};

const TOP_VENUE_PATTERNS = [
  /mobicom|mobile computing and networking/i,
  /mobisys|mobile systems, applications/i,
  /sensys|embedded networked sensor systems/i,
  /sigcomm|nsdi|sosp|osdi|usenix|infocom|ubicomp|imwut|ipsn/i,
  /transactions on mobile computing|transactions on networking/i,
  /chi conference|computer vision and pattern recognition|neurips|icml/i,
];

const STOP_WORDS = new Set(
  `a an and are as at be been by can could did do does for from had has have how in into is it its may might more most not of on or our paper propose proposed provides show shows than that the their these this through to toward towards using via was we were what when where which while with without you your
  一个 一种 以及 其中 关于 可以 可能 基于 如何 对于 我们 方法 系统 通过 进行 这个 这些 研究 论文 提出 使用 实现 结果`.split(/\s+/),
);

export const OPENALEX_SELECT = [
  "id",
  "doi",
  "display_name",
  "publication_year",
  "cited_by_count",
  "authorships",
  "primary_location",
  "best_oa_location",
  "topics",
  "referenced_works",
  "related_works",
  "type",
].join(",");

export function cleanDoi(value?: string | null): string {
  return (value || "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/[\s)>\],.;]+$/g, "")
    .trim()
    .toLowerCase();
}

export function shortOpenAlexId(value?: string | null): string {
  return (value || "").split("/").pop() || "";
}

export function tokenize(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/10\.\d{4,9}\/[-._;()/:a-z0-9]+/gi, " ");
  const english = normalized.match(/[a-z][a-z0-9+-]{2,}/g) || [];
  const chinese = normalized.match(/[\u3400-\u9fff]{2,6}/g) || [];
  return [...english, ...chinese].filter((token) => !STOP_WORDS.has(token));
}

export function topKeywords(text: string, limit = 10): string[] {
  const counts = new Map<string, number>();
  for (const token of tokenize(text)) counts.set(token, (counts.get(token) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, limit)
    .map(([token]) => token);
}

export function isTopVenue(venue: string): boolean {
  return TOP_VENUE_PATTERNS.some((pattern) => pattern.test(venue || ""));
}

export function normalizeOpenAlex(work: OpenAlexWork): Paper | null {
  const openAlexId = shortOpenAlexId(work.id);
  const title = (work.display_name || "").trim();
  if (!openAlexId || !title) return null;
  const doi = cleanDoi(work.doi);
  const venue = work.primary_location?.source?.display_name || "Unlisted venue";
  return {
    id: `oa:${openAlexId}`,
    openAlexId,
    title,
    authors: (work.authorships || [])
      .map((item) => item.author?.display_name || "")
      .filter(Boolean)
      .slice(0, 12),
    year: work.publication_year,
    venue,
    doi: doi || undefined,
    url:
      (doi && `https://doi.org/${doi}`) ||
      work.best_oa_location?.landing_page_url ||
      work.primary_location?.landing_page_url ||
      work.id ||
      "",
    citationCount: work.cited_by_count || 0,
    topics: (work.topics || []).map((topic) => topic.display_name || "").filter(Boolean).slice(0, 5),
    referenceIds: (work.referenced_works || []).map(shortOpenAlexId).filter(Boolean),
    relatedIds: (work.related_works || []).map(shortOpenAlexId).filter(Boolean),
    source: "OpenAlex",
    kind: work.type,
    isTopVenue: isTopVenue(venue),
  };
}

export function normalizeCrossref(work: CrossrefWork): Paper | null {
  const doi = cleanDoi(work.DOI);
  const title = (work.title?.[0] || "").trim();
  if (!title) return null;
  const venue = work["container-title"]?.[0] || "Unlisted venue";
  const dateParts = work.published?.["date-parts"] || work.issued?.["date-parts"];
  return {
    id: doi ? `doi:${doi}` : `crossref:${encodeURIComponent(title.toLowerCase())}`,
    title,
    authors: (work.author || [])
      .map((author) => [author.given, author.family].filter(Boolean).join(" "))
      .filter(Boolean)
      .slice(0, 12),
    year: dateParts?.[0]?.[0],
    venue,
    doi: doi || undefined,
    url: (doi && `https://doi.org/${doi}`) || work.URL || "",
    citationCount: work["is-referenced-by-count"] || 0,
    topics: (work.subject || []).slice(0, 5),
    referenceIds: [],
    relatedIds: [],
    source: "Crossref",
    kind: work.type,
    isTopVenue: isTopVenue(venue),
  };
}

export function dedupePapers(papers: Paper[]): Paper[] {
  const map = new Map<string, Paper>();
  for (const paper of papers) {
    const key = paper.doi ? `doi:${cleanDoi(paper.doi)}` : paper.id;
    const previous = map.get(key);
    if (!previous || (paper.source === "OpenAlex" && previous.source !== "OpenAlex")) map.set(key, paper);
  }
  return [...map.values()];
}

export function rankPaper(paper: Paper, queryTokens: string[], currentYear = new Date().getFullYear()): Paper {
  const paperTokens = new Set(tokenize(`${paper.title} ${paper.topics.join(" ")} ${paper.venue}`));
  const overlapTerms = [...new Set(queryTokens)].filter((token) => paperTokens.has(token));
  const overlap = Math.min(1, overlapTerms.length / Math.max(4, Math.min(10, new Set(queryTokens).size)));
  const age = paper.year ? Math.max(0, currentYear - paper.year) : 12;
  const recency = Math.max(0, 1 - age / 12);
  const impact = Math.min(1, Math.log1p(paper.citationCount) / Math.log(1001));
  const venue = paper.isTopVenue ? 1 : 0;
  const score = Math.round(100 * (overlap * 0.58 + recency * 0.2 + impact * 0.14 + venue * 0.08));
  const reasons = [
    overlapTerms.length ? `${overlapTerms.slice(0, 4).join(" · ")} term overlap` : "semantic title match",
    paper.year && paper.year >= currentYear - 3 ? "recent work" : "field foundation",
    paper.isTopVenue ? "selective venue" : paper.citationCount >= 50 ? "strong citation signal" : "topic coverage",
  ];
  return { ...paper, score, reasons };
}

export function jsonResponse(payload: unknown, status = 200, cacheSeconds = 300): Response {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": `public, max-age=0, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 2}`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "User-Agent": "PaperTrail/2.0 (public research discovery service)",
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(18_000),
  });
  if (!response.ok) throw new Error(`Upstream returned ${response.status}`);
  return (await response.json()) as T;
}

