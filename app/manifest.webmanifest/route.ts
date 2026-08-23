export function GET() {
  return Response.json({ name: "PaperTrail · 文脉", short_name: "PaperTrail", description: "Citation graphs and missing-reference discovery", start_url: "/", display: "standalone", background_color: "#f3f0e8", theme_color: "#d85f45", icons: [{ src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }, { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }] }, { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=86400" } });
}
