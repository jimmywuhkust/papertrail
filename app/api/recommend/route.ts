import { jsonResponse } from "@/lib/paper-api";
import { ServiceError, recommendPapers } from "@/lib/paper-service";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Parameters<typeof recommendPapers>[0];
    return jsonResponse(await recommendPapers(body), 200, 1_800);
  } catch (error) {
    if (error instanceof ServiceError) return jsonResponse({ error: error.message }, error.status, 0);
    return jsonResponse({ error: "Recommendations are temporarily unavailable." }, 502, 0);
  }
}
