export function GET() {
  return Response.json({ ok: true, service: "PaperTrail", mode: "public-rule-based" });
}

