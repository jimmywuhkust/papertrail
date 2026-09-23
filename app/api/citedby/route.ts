import { jsonResponse } from "@/lib/paper-api";
import { fetchCitingWorks } from "@/lib/paper-service";

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const result = await fetchCitingWorks(url.searchParams.get("id") || "", Number(url.searchParams.get("limit")) || 12);
    return jsonResponse(result, 200, 86_400);
  } catch {
    return jsonResponse({ error: "Citation lookup is temporarily unavailable." }, 502, 0);
  }
}
