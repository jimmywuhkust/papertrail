import { jsonResponse } from "@/lib/paper-api";
import { ServiceError, searchPapers, type SourceFilter } from "@/lib/paper-service";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sourceParam = url.searchParams.get("source") || "";
  try {
    const result = await searchPapers({
      query: url.searchParams.get("q") || "",
      fromYear: Number(url.searchParams.get("fromYear")) || 0,
      source: (["all", "acm", "ietf"].includes(sourceParam) ? sourceParam : "all") as SourceFilter,
      limit: Number(url.searchParams.get("limit")) || 24,
    });
    return jsonResponse(result, 200, 900);
  } catch (error) {
    if (error instanceof ServiceError) return jsonResponse({ error: error.message }, error.status, 0);
    return jsonResponse({ error: "Search failed. Please try again shortly." }, 502, 0);
  }
}
