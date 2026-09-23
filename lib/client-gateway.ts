import {
  expandWorks,
  recommendPapers,
  resolveDois,
  searchPapers,
  type SourceFilter,
} from "./paper-service";
import type { Paper } from "./types";

// vite.config.ts replaces these process.env references with string literals
// in every build. On the static GitHub Pages build there are no API routes,
// so the browser calls OpenAlex/Crossref directly (both allow CORS); on the
// Cloudflare build these are ""/false and requests go through /api/*.
const STATIC_EXPORT = process.env.NEXT_PUBLIC_STATIC_EXPORT === "true";
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

export function dataUrl(path: string): string {
  return `${BASE_PATH}${path}`;
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${BASE_PATH}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function clientSearch(input: {
  query: string;
  source: SourceFilter;
  fromYear: number;
  limit: number;
}): Promise<Paper[]> {
  if (STATIC_EXPORT) return (await searchPapers(input)).papers;
  const params = new URLSearchParams({
    q: input.query,
    source: input.source,
    fromYear: String(input.fromYear),
    limit: String(input.limit),
  });
  const response = await fetch(`${BASE_PATH}/api/search?${params}`);
  const payload = (await response.json()) as { papers?: Paper[]; error?: string };
  if (!response.ok) throw new Error(payload.error || "Search failed");
  return payload.papers || [];
}

export async function clientAnalyze(input: {
  title: string;
  text: string;
  dois: string[];
  fromYear: number;
  source: SourceFilter;
}): Promise<{ resolved: Paper[]; unresolved: string[]; suggestions: Paper[]; keywords: string[] }> {
  if (STATIC_EXPORT) {
    const [resolved, recommendation] = await Promise.all([
      resolveDois(input.dois),
      recommendPapers({
        title: input.title,
        text: input.text,
        citedDois: input.dois,
        fromYear: input.fromYear,
        source: input.source,
        limit: 20,
      }),
    ]);
    return {
      resolved: resolved.papers,
      unresolved: resolved.unresolved,
      suggestions: recommendation.papers,
      keywords: recommendation.keywords,
    };
  }
  const [resolvedResponse, recommendationResponse] = await Promise.all([
    postJson("/api/resolve", { dois: input.dois }),
    postJson("/api/recommend", {
      title: input.title,
      text: input.text,
      citedDois: input.dois,
      fromYear: input.fromYear,
      source: input.source,
      limit: 20,
    }),
  ]);
  const resolvedPayload = (await resolvedResponse.json()) as {
    papers?: Paper[];
    unresolved?: string[];
  };
  const recommendationPayload = (await recommendationResponse.json()) as {
    papers?: Paper[];
    keywords?: string[];
    error?: string;
  };
  if (!recommendationResponse.ok) throw new Error(recommendationPayload.error || "Recommendation failed");
  return {
    resolved: resolvedPayload.papers || [],
    unresolved: resolvedPayload.unresolved || [],
    suggestions: recommendationPayload.papers || [],
    keywords: recommendationPayload.keywords || [],
  };
}

export async function clientExpand(ids: string[]): Promise<Paper[]> {
  if (STATIC_EXPORT) {
    try {
      return (await expandWorks(ids)).papers;
    } catch {
      return [];
    }
  }
  const response = await postJson("/api/expand", { ids });
  if (!response.ok) return [];
  return ((await response.json()) as { papers: Paper[] }).papers;
}
