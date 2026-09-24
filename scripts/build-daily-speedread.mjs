#!/usr/bin/env node
/**
 * Daily paper speed-read generator.
 *
 * Picks one highly-cited paper per day from the top-conference collections
 * (2021+), downloads its open-access PDF when one exists, and writes a
 * ~3 minute Chinese narration script as a list of segments, each mapped to
 * the PDF page it talks about — the video shows that page while the segment
 * is narrated.
 *
 * With an OpenAI-compatible LLM endpoint configured (LLM_API_KEY, and
 * optionally LLM_BASE_URL / LLM_MODEL), the model reads the per-page PDF text
 * and returns the segmented script as JSON in one chat call (~6-10k tokens).
 * Without it, a zero-cost template is used.
 *
 * Usage:
 *   node scripts/build-daily-speedread.mjs              # generate today's episode
 *   node scripts/build-daily-speedread.mjs --write-txt  # (re)write TTS assets only
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const LIBRARY = "public/data/venue-library";
const DAILY_DIR = "public/data/daily";
const EPISODES_PATH = `${DAILY_DIR}/episodes.json`;
const CONFERENCE_VENUES = ["mobicom", "mobisys", "sensys", "nsdi", "sigcomm", "infocom", "ubicomp"];
const MIN_YEAR = 2021;
const USER_AGENT = "PaperTrail-daily-speedread (mailto:papertrail@localhost)";
const MAX_PDF_BYTES = 60 * 1024 * 1024;
const FLAG_WRITE_TXT = process.argv.includes("--write-txt");

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(await readFile(path, "utf8"));
}

async function loadCandidates() {
  const index = await loadJson(`${LIBRARY}/index.json`);
  const wanted = index.shards.filter(
    (shard) => CONFERENCE_VENUES.includes(shard.venueId) && shard.year >= MIN_YEAR,
  );
  const papers = [];
  for (const shard of wanted) {
    const payload = await loadJson(`${LIBRARY}/${shard.url}`);
    papers.push(...payload.records);
  }
  return papers.filter((paper) => paper.type === "Main paper" || paper.citationCount > 0);
}

function pickPaper(candidates, episodes) {
  const used = new Set(episodes.map((episode) => episode.id));
  const previousVenue = episodes[0]?.venueId;
  const fresh = candidates
    .filter((paper) => !used.has(paper.id))
    .sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0));
  return fresh.find((paper) => paper.venueId !== previousVenue) || fresh[0] || null;
}

async function fetchWork(paper) {
  if (!paper.doi) return { abstract: "", pdfUrl: null };
  try {
    const response = await fetch(
      `https://api.openalex.org/works/doi:${encodeURIComponent(paper.doi)}?select=abstract_inverted_index,best_oa_location,open_access`,
      { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15_000) },
    );
    if (!response.ok) return { abstract: "", pdfUrl: null };
    const payload = await response.json();
    let abstract = "";
    const index = payload.abstract_inverted_index;
    if (index) {
      const words = [];
      for (const [word, positions] of Object.entries(index)) {
        for (const position of positions) words[position] = word;
      }
      abstract = words.join(" ");
    }
    const pdfUrl = payload.best_oa_location?.pdf_url || null;
    return { abstract, pdfUrl };
  } catch {
    return { abstract: "", pdfUrl: null };
  }
}

function hasPdftotext() {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function downloadPdf(url, dest) {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(60_000),
    redirect: "follow",
  });
  if (!response.ok) return false;
  const length = Number(response.headers.get("content-length")) || 0;
  if (length > MAX_PDF_BYTES) return false;
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_PDF_BYTES || !buffer.subarray(0, 5).toString("latin1").startsWith("%PDF")) return false;
  await writeFile(dest, buffer);
  return true;
}

function extractPdfPages(pdfPath) {
  const output = execFileSync("pdftotext", ["-layout", pdfPath, "-"], {
    maxBuffer: 32 * 1024 * 1024,
  }).toString("utf8");
  return output.split("\f").map((text) => text.trim()).filter((text, index, all) => text || index < all.length - 1);
}

const LLM_PROMPT = (paper, abstract, pages, date) => `你是一档"每天三分钟论文速读"短视频的主播。视频会一边播放论文 PDF 的页面,一边播放你的中文口播。请根据论文信息和逐页文本,写一份分段口播稿。

要求:
- 输出严格的 JSON,格式: {"segments": [{"text": "口播段落", "page": 页码整数}, ...]},不要输出任何其他内容
- 6~9 个 segment,全部 text 加起来 650~800 字(约 3 分钟语速)
- 第一个 segment 直接报名字,一句话带过,不要寒暄和节目介绍,例如:"各位观众,今天给大家带来的是 ${paper.venueName} ${paper.year} 的论文《${paper.title}》,再补一句它做了什么。"
- 之后按论文结构讲:要解决什么问题 → 核心思路 → 2~3 个关键技术(用比喻讲清楚)→ 实验怎么做的、最关键的数字 → 为什么重要 → 一句收尾(引导读原文,说明天见)
- 每个 segment 的 page 必须是你这段正在讲的内容所在的 PDF 页码(1 起);讲到某张图或某个表格时,page 必须是那张图所在的页——观众会看到那一页
- 语气口语化,像跟朋友聊天;不要列表、标题、markdown;论文标题保持英文
- 实验数字优先讲图表里的结果

论文信息:
- 标题: ${paper.title}
- 作者: ${paper.authors.join(", ")}
- 发表: ${paper.venueName} ${paper.year}
- 被引: ${paper.citationCount ?? 0} 次
- 摘要: ${abstract || "(不可用)"}
- 今天日期: ${date}

逐页文本(共 ${pages.length} 页):
${pages.map((text, index) => `===== 第 ${index + 1} 页 =====\n${text.slice(0, 2200)}`).join("\n")}`.slice(0, 90_000);

async function generateWithLlm(paper, abstract, pages, date) {
  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.LLM_MODEL || "gpt-4o-mini";
  if (!apiKey) return null;
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: LLM_PROMPT(paper, abstract, pages, date) }],
      temperature: 0.6,
      max_tokens: 2500,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`LLM endpoint returned ${response.status}`);
  const payload = await response.json();
  const text = payload.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("LLM returned an empty script");
  const parsed = JSON.parse(text.replace(/^```(?:json)?|```$/g, "").trim());
  if (!Array.isArray(parsed.segments)) throw new Error("LLM returned no segments");
  const segments = parsed.segments
    .map((segment) => ({
      text: String(segment.text || "").trim(),
      page: Number.isInteger(segment.page) && pages.length ? Math.max(1, Math.min(pages.length, segment.page)) : null,
    }))
    .filter((segment) => segment.text.length > 0);
  if (segments.length < 3) throw new Error("LLM returned too few segments");
  return segments;
}

function generateWithTemplate(paper, abstract, date, pageCount) {
  const [, month, day] = date.split("-");
  const authors = paper.authors.slice(0, 2).join("、");
  const firstSentence = abstract.split(/(?<=\.)\s/)[0] || "";
  const topics = (paper.topics || []).slice(0, 3).join("、");
  const page = (n) => (pageCount ? Math.max(1, Math.min(pageCount, n)) : null);
  return [
    { text: `各位观众,今天给大家带来的是 ${paper.venueName} ${paper.year} 的论文《${paper.title}》。`, page: page(1) },
    { text: `这篇论文由 ${authors} 等作者完成,目前已经被引用 ${paper.citationCount ?? 0} 次,研究方向涉及${topics || "计算机网络与系统"}。`, page: page(1) },
    { text: firstSentence ? `用论文自己的话来说:${firstSentence}` : "这项工作针对的是该方向上一个长期存在的工程难题。", page: page(1) },
    { text: `如果你想快速抓住重点,可以记住这几个关键词:${topics || paper.title.split(" ").slice(0, 4).join(" ")}。`, page: page(2) },
    { text: `好了,今天的速读就到这里。本期稿件由模板自动生成——配置 LLM_API_KEY 之后,每天的内容会由大模型逐页撰写,讲解会细致得多。`, page: page(pageCount || 1) },
    { text: `感兴趣的话,欢迎打开 DOI 阅读原文,链接就在视频下方。我们明天见。`, page: page(pageCount || 1) },
  ];
}

async function writeEpisodeAssets(episode) {
  const text = episode.script.join("\n\n");
  await writeFile(`${DAILY_DIR}/${episode.date}.txt`, `${text}\n`);
  await writeFile(
    `${DAILY_DIR}/${episode.date}.meta.txt`,
    [episode.title, `${episode.venueName} · ${episode.year}`, episode.date].join("\n"),
  );
  await writeFile(
    `${DAILY_DIR}/${episode.date}.segments.json`,
    `${JSON.stringify({ pdfUrl: episode.pdfUrl || null, pageCount: episode.pageCount || 0, segments: episode.segments || episode.script.map((line) => ({ text: line, page: null })) }, null, 2)}\n`,
  );
  await writeFile(
    `${DAILY_DIR}/${episode.date}.md`,
    [`# ${episode.title}`, "", `**${episode.venueName} ${episode.year}** · ${episode.authors.join(", ")}`, "", ...episode.script, "", `DOI: ${episode.doi || "n/a"} · ${episode.url}`, ""].join("\n"),
  );
}

async function main() {
  await mkdir(DAILY_DIR, { recursive: true });
  await mkdir("public/daily", { recursive: true });
  const store = await loadJson(EPISODES_PATH, { episodes: [] });
  const episodes = store.episodes || [];

  if (FLAG_WRITE_TXT) {
    for (const episode of episodes) await writeEpisodeAssets(episode);
    console.log(`Wrote TTS assets for ${episodes.length} episode(s).`);
    return;
  }

  const date = process.env.EPISODE_DATE || today();
  if (episodes.some((episode) => episode.date === date)) {
    console.log(`Episode for ${date} already exists; nothing to do.`);
    return;
  }

  const candidates = await loadCandidates();
  const paper = pickPaper(candidates, episodes);
  if (!paper) throw new Error("No unused candidate paper found");

  const { abstract, pdfUrl } = await fetchWork(paper);
  let pages = [];
  if (pdfUrl && hasPdftotext()) {
    const pdfPath = path.join(tmpdir(), `papertrail-${date}.pdf`);
    if (await downloadPdf(pdfUrl, pdfPath)) {
      try {
        pages = extractPdfPages(pdfPath);
        console.log(`PDF: ${pages.length} pages extracted from ${pdfUrl}`);
      } catch (error) {
        console.warn(`pdftotext failed: ${error.message}`);
      }
    } else {
      console.warn(`PDF download skipped/failed: ${pdfUrl}`);
    }
  }

  let segments = null;
  let scriptSource = "template";
  try {
    segments = await generateWithLlm(paper, abstract, pages, date);
    if (segments) scriptSource = "llm";
  } catch (error) {
    console.warn(`LLM generation failed, falling back to template: ${error.message}`);
  }
  if (!segments) segments = generateWithTemplate(paper, abstract, date, pages.length);

  const episode = {
    date,
    id: paper.id,
    title: paper.title,
    authors: paper.authors,
    venueId: paper.venueId,
    venueName: paper.venueName,
    year: paper.year,
    doi: paper.doi || null,
    url: paper.url,
    citationCount: paper.citationCount ?? 0,
    topics: paper.topics || [],
    pdfUrl: pages.length ? pdfUrl : null,
    pageCount: pages.length,
    scriptSource,
    script: segments.map((segment) => segment.text),
    segments,
    video: `daily/${date}.mp4`,
  };
  episodes.unshift(episode);
  await writeFile(EPISODES_PATH, `${JSON.stringify({ generatedAt: new Date().toISOString(), episodes }, null, 2)}\n`);
  await writeEpisodeAssets(episode);
  console.log(`Episode ${date}: ${paper.venueName} ${paper.year} — ${paper.title} (${scriptSource}, ${pages.length} pages)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
