import { jsonResponse } from "@/lib/paper-api";
import { resolveDois } from "@/lib/paper-service";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { dois?: string[] };
    return jsonResponse(await resolveDois(body.dois || []), 200, 86_400);
  } catch {
    return jsonResponse({ error: "The DOI list could not be resolved." }, 400, 0);
  }
}
