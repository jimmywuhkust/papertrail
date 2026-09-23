import { jsonResponse } from "@/lib/paper-api";
import { expandWorks } from "@/lib/paper-service";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { ids?: string[] };
    return jsonResponse(await expandWorks(body.ids || []), 200, 86_400);
  } catch {
    return jsonResponse({ error: "This graph layer is temporarily unavailable." }, 502, 0);
  }
}
