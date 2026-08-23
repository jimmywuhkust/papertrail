export function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const today = new Date().toISOString().slice(0, 10);
  const paths = ["", "/methodology", "/privacy"];
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<url><loc>${origin}${path}</loc><lastmod>${today}</lastmod><changefreq>${path ? "monthly" : "weekly"}</changefreq><priority>${path ? "0.7" : "1.0"}</priority></url>`).join("")}</urlset>`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}

