#!/usr/bin/env node
/**
 * Daily paper speed-read generator.
 *
 * Picks one highly-cited paper per day from the top-conference collections
 * (last 5 years), fetches its abstract from OpenAlex, and writes a ~3 minute
 * Chinese narration script. When an OpenAI-compatible LLM endpoint is
 * configured (LLM_API_KEY, LLM_BASE_URL, LLM_MODEL) the script is written by
 * the model (one small chat call, ~2-3k tokens); otherwise a metadata
 * template is used at zero token cost.
 *
 * Usage:
 *   node scripts/build-daily-speedread.mjs              # generate today's episode
 *   node scripts/build-daily-speedread.mjs --write-txt  # (re)write TTS .txt/.meta files only
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const LIBRARY = "public/data/venue-library";
const DAILY_DIR = "public/data/daily";
const EPISODES_PATH = `${DAILY_DIR}/episodes.json`;
const CONFERENCE_VENUES = ["mobicom", "mobisys", "sensys", "nsdi", "sigcomm", "infocom", "ubicomp"];
const MIN_YEAR = 2021;
const USER_AGENT = "PaperTrail-daily-speedread (mailto:papertrail@localhost)";
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

async function fetchAbstract(paper) {
  if (!paper.doi) return "";
  try {
    const response = await fetch(
      `https://api.openalex.org/works/doi:${encodeURIComponent(paper.doi)}?select=abstract_inverted_index`,
      { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15_000) },
    );
    if (!response.ok) return "";
    const payload = await response.json();
    const index = payload.abstract_inverted_index;
    if (!index) return "";
    const words = [];
    for (const [word, positions] of Object.entries(index)) {
      for (const position of positions) words[position] = word;
    }
    return words.join(" ");
  } catch {
    return "";
  }
}

const LLM_PROMPT = (paper, abstract, date) => `你是一档"每天三分钟论文速读"短视频节目的主播。请根据下面的论文信息,写一份中文口播稿。

要求:
- 以"各位观众"开头,语气像在跟观众聊天,口语化,避免书面腔
- 总长度 700~850 字(大约 3 分钟语速)
- 结构:开场介绍今天的主角(会场、年份、标题)→ 这篇论文要解决什么问题 → 核心思路是什么 → 关键技术点(挑 2~3 个,用比喻讲清楚)→ 最关键的实验数字 → 为什么这项工作重要 → 一句收尾(引导感兴趣的观众去读原文,说明天见)
- 不要输出任何列表、标题、markdown 标记,直接输出 6~8 个自然段,段与段之间空一行
- 论文标题保持英文原样,作者读前两位加"等"

论文信息:
- 标题: ${paper.title}
- 作者: ${paper.authors.join(", ")}
- 发表: ${paper.venueName} ${paper.year}
- 被引: ${paper.citationCount ?? 0} 次
- 主题: ${(paper.topics || []).join("; ")}
- 摘要: ${abstract || "(摘要不可用)"}
- 今天日期: ${date}`;

async function generateWithLlm(paper, abstract, date) {
  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.LLM_MODEL || "gpt-4o-mini";
  if (!apiKey) return null;
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: LLM_PROMPT(paper, abstract, date) }],
      temperature: 0.7,
      max_tokens: 2000,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`LLM endpoint returned ${response.status}`);
  const payload = await response.json();
  const text = payload.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("LLM returned an empty script");
  return text.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
}

function generateWithTemplate(paper, abstract, date) {
  const [, month, day] = date.split("-");
  const authors = paper.authors.slice(0, 2).join("、");
  const firstSentence = abstract.split(/(?<=\.)\s/)[0] || "";
  const topics = (paper.topics || []).slice(0, 3).join("、");
  return [
    `各位观众,大家好,今天是${Number(month)}月${Number(day)}日。每天三分钟,带你速读一篇顶级会议论文。今天的主角,是发表在 ${paper.venueName} ${paper.year} 上的论文:《${paper.title}》。`,
    `这篇论文由 ${authors} 等作者完成,目前已经被引用 ${paper.citationCount ?? 0} 次,研究方向涉及${topics || "计算机网络与系统"}。`,
    firstSentence ? `用论文自己的话来说:${firstSentence}` : "这项工作针对的是该方向上一个长期存在的工程难题。",
    `如果你想快速抓住重点,可以记住这几个关键词:${topics || paper.title.split(" ").slice(0, 4).join(" ")}。`,
    `好了,今天的速读就到这里。稿件由模板自动生成——配置 LLM_API_KEY 之后,每天的内容会由大模型重新撰写,讲解会生动得多。`,
    `感兴趣的话,欢迎打开 DOI 阅读原文,链接就在视频下方。我们明天见。`,
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

  const abstract = await fetchAbstract(paper);
  let script = null;
  let scriptSource = "template";
  try {
    script = await generateWithLlm(paper, abstract, date);
    if (script) scriptSource = "llm";
  } catch (error) {
    console.warn(`LLM generation failed, falling back to template: ${error.message}`);
  }
  if (!script) script = generateWithTemplate(paper, abstract, date);

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
    scriptSource,
    script,
    video: `daily/${date}.mp4`,
  };
  episodes.unshift(episode);
  await writeFile(EPISODES_PATH, `${JSON.stringify({ generatedAt: new Date().toISOString(), episodes }, null, 2)}\n`);
  await writeEpisodeAssets(episode);
  console.log(`Episode ${date}: ${paper.venueName} ${paper.year} — ${paper.title} (${scriptSource})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
