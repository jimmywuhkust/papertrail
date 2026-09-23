import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { requestOrigin } from "@/lib/request-origin";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const origin = await requestOrigin();
  const title = "PaperTrail · Citation Graphs & Missing Reference Discovery";
  const description = "Upload a research draft, map its citations, search ACM and IETF literature, and find highly relevant papers missing from your bibliography — with explainable, privacy-first ranking.";
  return {
    metadataBase: new URL(origin),
    title: { default: title, template: "%s · PaperTrail" },
    description,
    applicationName: "PaperTrail",
    keywords: ["citation graph", "paper search", "missing citations", "research literature", "ACM papers", "IETF RFC", "mobile computing", "文献图谱", "论文搜索", "引用推荐"],
    authors: [{ name: "PaperTrail" }],
    creator: "PaperTrail",
    publisher: "PaperTrail",
    alternates: { canonical: origin, languages: { "en": origin, "zh-Hans": origin } },
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
    openGraph: {
      type: "website",
      url: origin,
      siteName: "PaperTrail · 文脉",
      title,
      description,
      locale: "en_US",
      alternateLocale: ["zh_CN"],
      images: [{ url: `${origin}/og.png`, width: 1200, height: 630, alt: "PaperTrail citation intelligence" }],
    },
    twitter: { card: "summary_large_image", title, description, images: [`${origin}/og.png`] },
    icons: { icon: `${origin}/icon.png`, apple: `${origin}/apple-touch-icon.png` },
    manifest: `${origin}/manifest.webmanifest`,
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const origin = await requestOrigin();
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "PaperTrail",
    alternateName: "文脉",
    url: origin,
    applicationCategory: "EducationalApplication",
    operatingSystem: "Web",
    isAccessibleForFree: true,
    inLanguage: ["en", "zh-Hans"],
    description: "Privacy-first citation mapping, scholarly search, venue trends, and explainable missing-reference recommendations.",
    featureList: ["Local PDF parsing", "Citation graph", "Missing citation recommendations", "ACM and IETF search", "Venue trend analysis"],
  };
  return (
    <html lang="zh-Hans">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      </body>
    </html>
  );
}
