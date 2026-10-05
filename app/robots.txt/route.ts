export function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const base = process.env.GH_PAGES === "true" ? "https://jimmywuhkust.github.io/papertrail" : origin;
  return new Response(`User-agent: *\nAllow: /\nDisallow: /api/\nAllow: /papertrail/api/v1/\nAllow: /api/v1/\nSitemap: ${base}/sitemap.xml\n`, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}

