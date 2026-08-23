import type { Paper } from "./types";

export type ExtractedDraft = {
  text: string;
  title: string;
  dois: string[];
  rfcs: string[];
  pages: number;
  referenceText: string;
};

export function detectDois(text: string): string[] {
  const matches = text.match(/10\.\d{4,9}\/[-._;()/:a-z0-9]+/gi) || [];
  return [...new Set(matches.map((doi) => doi.replace(/[\s)>\],.;]+$/g, "").toLowerCase()))];
}

export function detectRfcs(text: string): string[] {
  return [...new Set((text.match(/\bRFC\s*\d{3,5}\b/gi) || []).map((value) => value.replace(/\s+/g, "").toUpperCase()))];
}

function inferTitle(pages: string[]): string {
  const first = pages[0] || "";
  const candidates = first
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 18 && line.length <= 220)
    .filter((line) => !/^(abstract|arxiv|doi|proceedings|copyright|permission)/i.test(line));
  return candidates.sort((a, b) => b.length - a.length)[0] || "Untitled draft";
}

export async function extractPdf(
  file: File,
  onProgress?: (value: number, message: string) => void,
): Promise<ExtractedDraft> {
  if (file.size > 45 * 1024 * 1024) throw new Error("PDF_LIMIT");
  onProgress?.(5, "Opening PDF locally");
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pageLimit = Math.min(pdf.numPages, 100);
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    let line = "";
    const lines: string[] = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      line += `${item.str} `;
      if (item.hasEOL) {
        lines.push(line.trim());
        line = "";
      }
    }
    if (line.trim()) lines.push(line.trim());
    pages.push(lines.join("\n"));
    onProgress?.(8 + Math.round((pageNumber / pageLimit) * 38), `Reading page ${pageNumber} / ${pageLimit}`);
  }
  const fullText = pages.join("\n\n").replace(/[ \t]+/g, " ");
  const referenceIndex = fullText.search(/\n(?:references|bibliography|参考文献)\s*\n/i);
  const referenceText = referenceIndex >= 0 ? fullText.slice(referenceIndex) : fullText.slice(-25_000);
  onProgress?.(48, "References detected on your device");
  return {
    text: fullText.slice(0, 80_000),
    title: inferTitle(pages),
    dois: detectDois(referenceText),
    rfcs: detectRfcs(referenceText),
    pages: pdf.numPages,
    referenceText: referenceText.slice(0, 40_000),
  };
}

function bibKey(paper: Paper): string {
  const family = (paper.authors[0] || "paper").split(/\s+/).pop() || "paper";
  return `${family.replace(/[^a-z0-9]/gi, "")}${paper.year || "nd"}`;
}

export function paperToBibtex(paper: Paper): string {
  const type = /journal|transactions/i.test(paper.venue) ? "article" : "inproceedings";
  const venueField = type === "article" ? "journal" : "booktitle";
  return `@${type}{${bibKey(paper)},\n  title = {${paper.title}},\n  author = {${paper.authors.join(" and ")}},\n  ${venueField} = {${paper.venue}},\n  year = {${paper.year || ""}},${paper.doi ? `\n  doi = {${paper.doi}},` : ""}\n  url = {${paper.url}}\n}`;
}
