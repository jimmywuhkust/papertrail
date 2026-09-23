import { headers } from "next/headers";

export async function requestOrigin(): Promise<string> {
  // Static export (GitHub Pages) has no request scope; use the public origin.
  if (process.env.GH_PAGES === "true") return "https://jimmywuhkust.github.io/papertrail";
  const store = await headers();
  const host = store.get("x-forwarded-host") || store.get("host") || "localhost:3000";
  const protocol = store.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}
