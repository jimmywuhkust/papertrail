"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GraphView } from "./GraphView";
import { detectDois, detectRfcs, extractPdf, paperToBibtex, type ExtractedDraft } from "@/lib/client-analysis";
import { clientAnalyze, clientCitedBy, clientExpand, clientSearch, dataUrl } from "@/lib/client-gateway";
import type { DailyEpisode, DailyEpisodesIndex, GraphData, GraphEdge, GraphNode, Paper, VenueLibraryIndex, VenueLibraryPaper, VenueLibraryShardPayload } from "@/lib/types";

type Lang = "zh" | "en";
type Mode = "analyze" | "discover" | "venues" | "daily";
type AnalysisTab = "map" | "cited" | "missing" | "coverage";

const CURRENT_YEAR = new Date().getFullYear();

const VENUE_COLORS: Record<string, string> = {
  "nature-communications": "#927348",
  nsdi: "#3f82c4",
  sigcomm: "#8c66b9",
  mobicom: "#5d5fef",
  mobisys: "#d85f45",
  sensys: "#249279",
  infocom: "#5a9ab1",
  ubicomp: "#b45f9a",
  tit: "#7771ad",
  jsac: "#c47f3f",
};

const DEFAULT_VENUES = new Set(["nsdi", "sigcomm", "mobicom", "mobisys", "sensys", "infocom", "ubicomp"]);

const copy = {
  zh: {
    navAnalyze: "分析草稿",
    navDiscover: "论文搜索",
    navVenues: "会场趋势",
    heroKicker: "CITATION INTELLIGENCE · 无需 AI AGENT",
    heroTitleA: "从你的草稿，",
    heroTitleB: "找到真正缺少的那篇引用。",
    heroBody: "本地读取 PDF，识别你正在引用的工作，再用透明的相关性、年份、影响力与会场规则推荐可能漏掉的论文。",
    upload: "放入论文 PDF",
    uploadHint: "PDF 在浏览器内解析 · 最大 45 MB · 不上传原文件",
    choose: "选择 PDF",
    titleLabel: "论文标题（可选）",
    titlePlaceholder: "粘贴论文标题",
    abstractLabel: "或粘贴标题、摘要、Related Work",
    abstractPlaceholder: "没有 PDF？粘贴你的研究问题、摘要或 Related Work…",
    depth: "关系层数",
    source: "检索范围",
    recent: "推荐年份",
    analyze: "检查引用缺口",
    demo: "打开七层示例",
    private: "隐私优先",
    privateBody: "原 PDF 不离开设备。检索服务只接收提取后的关键词和 DOI。",
    map: "关系图",
    cited: "已引用",
    missing: "建议补充",
    coverage: "覆盖面",
    citedPapers: "已解析引用",
    missingPapers: "高相关但尚未引用",
    searchTitle: "搜索整个研究语境",
    searchBody: "搜索 ACM、IETF 与跨学科论文；按年份、会场和影响力理解每一项结果。",
    searchPlaceholder: "例如：WiFi sensing phase calibration / RFC 9000 / federated learning",
    search: "搜索论文",
    venuesTitle: "十年论文与会场雷达",
    venuesBody: "九个会议与期刊 · 83,869 篇论文 · 4,173,415 条 DOI 引用边，按会场与年份即时加载。",
    papers: "篇论文",
    mainPapers: "已选集合",
    internalCites: "DOI 引用边",
    openDoi: "打开 DOI",
    copyBib: "复制 BibTeX",
    save: "收藏",
    saved: "已收藏",
    noResults: "没有结果。试试更具体的技术名词、协议或系统名称。",
    browseTitle: "浏览这个会场·年份的全部论文",
    filterPlaceholder: "按标题、作者或 DOI 筛选…",
    allTypes: "全部类型",
    sortCitations: "按被引量",
    sortTitle: "按标题 A–Z",
    showMore: "显示更多",
    relations: "论文关系",
    citedByInSlice: "被本列表中的论文引用",
    refsInSlice: "引用了本列表中的论文",
    relationsNote: "仅统计当前加载的会场·年份切片内的关系",
    loadRelations: "从 OpenAlex 加载完整引用关系",
    refsOpenAlex: "它引用的论文",
    citingOpenAlex: "引用它的论文",
    navDaily: "每日速读",
    dailyTitle: "每天三分钟，一篇顶会论文",
    dailyBody: "每天自动挑选一篇高被引顶会论文（2021 年至今），生成口播稿并渲染成竖屏速读视频。",
    scriptLabel: "口播稿",
    videoPending: "视频渲染中，先看口播稿",
    methodology: "方法说明",
    privacy: "隐私",
    sources: "数据源",
  },
  en: {
    navAnalyze: "Analyze draft",
    navDiscover: "Paper search",
    navVenues: "Venue radar",
    heroKicker: "CITATION INTELLIGENCE · NO AI AGENT REQUIRED",
    heroTitleA: "Start with your draft.",
    heroTitleB: "Find the citation you are actually missing.",
    heroBody: "Read a PDF locally, identify what you already cite, then surface likely omissions with transparent relevance, recency, impact, and venue signals.",
    upload: "Drop your paper PDF",
    uploadHint: "Parsed in your browser · 45 MB max · original file never uploaded",
    choose: "Choose PDF",
    titleLabel: "Paper title (optional)",
    titlePlaceholder: "Paste your working title",
    abstractLabel: "Or paste a title, abstract, or Related Work",
    abstractPlaceholder: "No PDF? Paste your research question, abstract, or Related Work…",
    depth: "Graph depth",
    source: "Search scope",
    recent: "Recommendation years",
    analyze: "Check citation gaps",
    demo: "Open seven-layer demo",
    private: "Privacy first",
    privateBody: "Your PDF stays on this device. Search providers receive only extracted keywords and DOI identifiers.",
    map: "Relationship map",
    cited: "Already cited",
    missing: "Suggested additions",
    coverage: "Coverage",
    citedPapers: "Resolved references",
    missingPapers: "Highly related, not in your bibliography",
    searchTitle: "Search the research context",
    searchBody: "Search ACM, IETF, and cross-disciplinary literature; understand every result by year, venue, and impact.",
    searchPlaceholder: "e.g. WiFi sensing phase calibration / RFC 9000 / federated learning",
    search: "Search papers",
    venuesTitle: "A decade of papers and venues",
    venuesBody: "Nine conference and journal collections · 83,869 papers · 4,173,415 DOI citation edges, loaded lazily by venue and year.",
    papers: "papers",
    mainPapers: "selected collections",
    internalCites: "DOI citation edges",
    openDoi: "Open DOI",
    copyBib: "Copy BibTeX",
    save: "Save",
    saved: "Saved",
    noResults: "No results. Try a more specific technique, protocol, or system name.",
    browseTitle: "Browse every paper in this venue-year",
    filterPlaceholder: "Filter by title, author, or DOI…",
    allTypes: "All types",
    sortCitations: "By citations",
    sortTitle: "By title A–Z",
    showMore: "Show more",
    relations: "Paper relationships",
    citedByInSlice: "Cited by papers in this list",
    refsInSlice: "Cites papers in this list",
    relationsNote: "Only edges inside the loaded venue-year slice are counted",
    loadRelations: "Load full citations from OpenAlex",
    refsOpenAlex: "References",
    citingOpenAlex: "Cited by",
    navDaily: "Daily read",
    dailyTitle: "One top-conference paper in three minutes, daily",
    dailyBody: "Every day we pick one highly-cited top-conference paper (2021+), write a narration script, and render a short vertical speed-read video.",
    scriptLabel: "Narration script",
    videoPending: "Video is being rendered — read the script",
    methodology: "Methodology",
    privacy: "Privacy",
    sources: "Sources",
  },
} as const;

function format(value: number) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function sourceLabel(source: string) {
  if (source === "acm") return "ACM";
  if (source === "ietf") return "IETF / RFC";
  return "All research";
}

function yearRangeLabel(fromYear: number) {
  return `${fromYear}–${CURRENT_YEAR}`;
}

function Metric({ value, label }: { value: string | number; label: string }) {
  return <div className="metric"><strong>{value}</strong><span>{label}</span></div>;
}

function PaperCard({
  paper,
  lang,
  saved,
  onSave,
  onSelect,
}: {
  paper: Paper;
  lang: Lang;
  saved: boolean;
  onSave: (paper: Paper) => void;
  onSelect: (paper: Paper) => void;
}) {
  const t = copy[lang];
  const copyCitation = async () => {
    await navigator.clipboard.writeText(paperToBibtex(paper));
  };
  return (
    <article className="paper-card">
      <button className="paper-card-main" type="button" onClick={() => onSelect(paper)}>
        <div className="paper-meta-row">
          <span className={paper.isTopVenue ? "venue-badge top" : "venue-badge"}>{paper.venue || "Unlisted"}</span>
          <span>{paper.year || "—"}</span>
          <span>{format(paper.citationCount)} cites</span>
          {paper.score !== undefined && <span className="score-pill">{paper.score}% match</span>}
        </div>
        <h3>{paper.title}</h3>
        <p className="authors">{paper.authors.slice(0, 5).join(", ") || "Authors unavailable"}</p>
        {paper.reasons?.length ? <div className="reason-row">{paper.reasons.map((reason) => <span key={reason}>{reason}</span>)}</div> : null}
      </button>
      <div className="paper-actions">
        <a href={paper.url} target="_blank" rel="noreferrer">{t.openDoi}</a>
        <button type="button" onClick={copyCitation}>{t.copyBib}</button>
        <button type="button" className={saved ? "saved" : ""} onClick={() => onSave(paper)}>{saved ? t.saved : t.save}</button>
      </div>
    </article>
  );
}

export default function PaperTrailApp() {
  const [lang, setLang] = useState<Lang>("zh");
  const [mode, setMode] = useState<Mode>("analyze");
  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>("map");
  const [file, setFile] = useState<File | null>(null);
  const [draft, setDraft] = useState<ExtractedDraft | null>(null);
  const [manualTitle, setManualTitle] = useState("");
  const [manualText, setManualText] = useState("");
  const [depth, setDepth] = useState(2);
  const [source, setSource] = useState<"all" | "acm" | "ietf">("all");
  const [fromYear, setFromYear] = useState(CURRENT_YEAR - 7);
  const [progress, setProgress] = useState({ value: 0, message: "" });
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [citedPapers, setCitedPapers] = useState<Paper[]>([]);
  const [suggestedPapers, setSuggestedPapers] = useState<Paper[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [unresolved, setUnresolved] = useState<string[]>([]);
  const [selectedPaper, setSelectedPaper] = useState<Paper | null>(null);
  const [savedPapers, setSavedPapers] = useState<Paper[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Paper[]>([]);
  const [searchSource, setSearchSource] = useState<"all" | "acm" | "ietf">("all");
  const [searchFromYear, setSearchFromYear] = useState(CURRENT_YEAR - 5);
  const [venueIndex, setVenueIndex] = useState<VenueLibraryIndex | null>(null);
  const [venueLoading, setVenueLoading] = useState(false);
  const [venueYears, setVenueYears] = useState<5 | 10>(10);
  const [venuePicks, setVenuePicks] = useState(() => new Set(DEFAULT_VENUES));
  const [venueFocus, setVenueFocus] = useState("mobicom");
  const [venueFocusYear, setVenueFocusYear] = useState(2025);
  const [venuePapers, setVenuePapers] = useState<VenueLibraryPaper[]>([]);
  const [venueSliceLoading, setVenueSliceLoading] = useState(false);
  const [venueTopic, setVenueTopic] = useState("");
  const [venueQuery, setVenueQuery] = useState("");
  const [venueType, setVenueType] = useState("");
  const [venueSort, setVenueSort] = useState<"citations" | "title">("citations");
  const [venueLimit, setVenueLimit] = useState(60);
  const [relationCache, setRelationCache] = useState<Record<string, { refs: Paper[]; citing: Paper[] }>>({});
  const [relationsLoadingFor, setRelationsLoadingFor] = useState("");
  const [dailyEpisodes, setDailyEpisodes] = useState<DailyEpisode[] | null>(null);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [dailyFocus, setDailyFocus] = useState(0);
  const [brokenVideos, setBrokenVideos] = useState<Record<string, boolean>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const t = copy[lang];

  /* Local storage is an external browser store; hydrate it once after mount. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const storedLang = localStorage.getItem("papertrail-language") as Lang | null;
    const storedPapers = localStorage.getItem("papertrail-shortlist");
    if (storedLang === "zh" || storedLang === "en") setLang(storedLang);
    if (storedPapers) {
      try { setSavedPapers(JSON.parse(storedPapers) as Paper[]); } catch { /* Ignore invalid local preference. */ }
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    localStorage.setItem("papertrail-language", lang);
    document.documentElement.lang = lang === "zh" ? "zh-Hans" : "en";
  }, [lang]);

  const selectMode = (nextMode: Mode) => {
    setMode(nextMode);
    if (nextMode === "venues" && !venueIndex && !venueLoading) {
      setVenueLoading(true);
      fetch(dataUrl("/data/venue-library/index.json"))
        .then((response) => {
          if (!response.ok) throw new Error("Venue index unavailable");
          return response.json() as Promise<VenueLibraryIndex>;
        })
        .then(setVenueIndex)
        .catch(() => setError("The venue index could not be loaded."))
        .finally(() => setVenueLoading(false));
    }
    if (nextMode === "daily" && !dailyEpisodes && !dailyLoading) {
      setDailyLoading(true);
      fetch(dataUrl("/data/daily/episodes.json"))
        .then((response) => {
          if (!response.ok) throw new Error("Daily episodes unavailable");
          return response.json() as Promise<DailyEpisodesIndex>;
        })
        .then((payload) => setDailyEpisodes(payload.episodes || []))
        .catch(() => setDailyEpisodes([]))
        .finally(() => setDailyLoading(false));
    }
  };

  /* This effect hydrates only the selected venue/year shard, never the 195 MB archive. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (mode !== "venues" || !venueIndex) return;
    const controller = new AbortController();
    const shards = venueIndex.shards.filter((shard) => shard.venueId === venueFocus && shard.year === venueFocusYear);
    setVenueSliceLoading(true);
    Promise.all(shards.map(async (shard) => {
      const response = await fetch(dataUrl(`/data/venue-library/${shard.url}`), { signal: controller.signal });
      if (!response.ok) throw new Error(`Venue shard unavailable: ${shard.url}`);
      return response.json() as Promise<VenueLibraryShardPayload>;
    }))
      .then((payloads) => setVenuePapers(payloads.flatMap((payload) => payload.records)))
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError("无法加载这一年份的论文分片 / This venue-year shard could not be loaded.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setVenueSliceLoading(false);
      });
    return () => controller.abort();
  }, [mode, venueFocus, venueFocusYear, venueIndex]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const savedIds = useMemo(() => new Set(savedPapers.map((paper) => paper.doi || paper.id)), [savedPapers]);

  const savePaper = (paper: Paper) => {
    setSavedPapers((previous) => {
      const key = paper.doi || paper.id;
      const next = previous.some((item) => (item.doi || item.id) === key)
        ? previous.filter((item) => (item.doi || item.id) !== key)
        : [paper, ...previous].slice(0, 100);
      localStorage.setItem("papertrail-shortlist", JSON.stringify(next));
      return next;
    });
  };

  const handleFile = async (nextFile: File | null) => {
    if (!nextFile) return;
    setFile(nextFile);
    setDraft(null);
    setError("");
    setProgress({ value: 2, message: lang === "zh" ? "正在设备上读取 PDF…" : "Reading PDF on this device…" });
    try {
      const extracted = await extractPdf(nextFile, (value, message) => setProgress({ value, message }));
      setDraft(extracted);
      if (!manualTitle) setManualTitle(extracted.title);
      setProgress({ value: 52, message: lang === "zh" ? `识别到 ${extracted.dois.length + extracted.rfcs.length} 个文献标识` : `${extracted.dois.length + extracted.rfcs.length} reference identifiers found` });
    } catch (cause) {
      setProgress({ value: 0, message: "" });
      setError(cause instanceof Error && cause.message === "PDF_LIMIT" ? "PDF must be smaller than 45 MB." : "This PDF could not be parsed. You can paste its abstract instead.");
    }
  };

  const expandGraph = async (initial: GraphNode[], requestedDepth: number) => {
    const nodes = [...initial];
    const edges: GraphEdge[] = [];
    const knownOpenAlex = new Set(nodes.map((node) => node.openAlexId).filter(Boolean));
    let frontier = nodes.filter((node) => node.relation === "cited" && node.openAlexId).slice(0, 16);
    for (let layer = 2; layer <= requestedDepth && frontier.length; layer += 1) {
      const candidateIds = [...new Set(frontier.flatMap((paper) => [...paper.referenceIds, ...paper.relatedIds.slice(0, 2)]))]
        .filter((id) => !knownOpenAlex.has(id))
        .slice(0, 28);
      if (!candidateIds.length) break;
      setProgress({ value: 72 + layer * 6, message: lang === "zh" ? `扩展第 ${layer} 层关系…` : `Expanding graph layer ${layer}…` });
      const additions = (await clientExpand(candidateIds)).map((paper) => ({ ...paper, depth: layer, relation: "expanded" as const }));
      for (const paper of additions) if (paper.openAlexId) knownOpenAlex.add(paper.openAlexId);
      for (const sourcePaper of frontier) {
        for (const target of additions) {
          if (target.openAlexId && sourcePaper.referenceIds.includes(target.openAlexId)) edges.push({ source: sourcePaper.id, target: target.id, kind: "cites" });
          else if (target.openAlexId && sourcePaper.relatedIds.includes(target.openAlexId)) edges.push({ source: sourcePaper.id, target: target.id, kind: "related" });
        }
      }
      nodes.push(...additions);
      frontier = additions.slice(0, 18);
    }
    return { nodes, edges };
  };

  const analyzeDraft = async () => {
    const text = (draft?.text || manualText).trim();
    const title = (manualTitle || draft?.title || "Untitled draft").trim();
    if (text.length < 20 && !draft?.dois.length) {
      setError(lang === "zh" ? "请先放入 PDF，或粘贴至少一段摘要。" : "Add a PDF or paste at least one abstract paragraph.");
      return;
    }
    setAnalyzing(true);
    setError("");
    setGraph(null);
    setProgress({ value: 55, message: lang === "zh" ? "正在解析 DOI 与 RFC…" : "Resolving DOI and RFC records…" });
    try {
      const manualDois = detectDois(manualText);
      const manualRfcs = detectRfcs(manualText);
      const rfcDois = [...(draft?.rfcs || []), ...manualRfcs].map((rfc) => `10.17487/${rfc}`.toLowerCase());
      const dois = [...new Set([...(draft?.dois || []), ...manualDois, ...rfcDois])];
      const { resolved, unresolved: unresolvedDois, suggestions, keywords: foundKeywords } = await clientAnalyze({ title, text, dois, fromYear, source });
      setCitedPapers(resolved);
      setSuggestedPapers(suggestions);
      setKeywords(foundKeywords);
      setUnresolved(unresolvedDois);

      const root: GraphNode = {
        id: "draft:current",
        title,
        authors: [],
        venue: "Your draft",
        url: "",
        citationCount: 0,
        topics: foundKeywords,
        referenceIds: [],
        relatedIds: [],
        source: "Local",
        depth: 0,
        relation: "draft",
      };
      const citedNodes: GraphNode[] = resolved.map((paper) => ({ ...paper, depth: 1, relation: "cited" }));
      const expanded = await expandGraph([root, ...citedNodes], depth);
      const byId = new Map(expanded.nodes.map((node) => [node.id, node]));
      const suggestionNodes: GraphNode[] = suggestions
        .filter((paper) => !byId.has(paper.id))
        .slice(0, 16)
        .map((paper) => ({ ...paper, depth: 1, relation: "suggested" }));
      const rootEdges: GraphEdge[] = citedNodes.map((paper) => ({ source: root.id, target: paper.id, kind: "cites" }));
      const suggestionEdges: GraphEdge[] = suggestionNodes.map((paper) => ({ source: root.id, target: paper.id, kind: "suggested" }));
      setGraph({ root: root.id, nodes: [...expanded.nodes, ...suggestionNodes], edges: [...rootEdges, ...expanded.edges, ...suggestionEdges] });
      setAnalysisTab("map");
      setProgress({ value: 100, message: lang === "zh" ? "引用审查完成" : "Citation review complete" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Analysis failed. Please try again.");
      setProgress({ value: 0, message: "" });
    } finally {
      setAnalyzing(false);
    }
  };

  const loadDemo = async () => {
    setAnalyzing(true);
    setError("");
    setProgress({ value: 30, message: lang === "zh" ? "加载七层公开示例…" : "Loading the public seven-layer demo…" });
    try {
      const response = await fetch(dataUrl("/data/demo-paper-graph.json"));
      const payload = (await response.json()) as {
        root: string;
        nodes: Array<Paper & { depth?: number; venueShort?: string; fields?: string[] }>;
        edges: Array<{ source: string; target: string }>;
      };
      const nodes: GraphNode[] = payload.nodes.map((node) => ({
        ...node,
        venue: node.venueShort || node.venue,
        topics: node.topics || node.fields || [],
        referenceIds: node.referenceIds || [],
        relatedIds: node.relatedIds || [],
        source: node.source || "OpenAlex",
        depth: node.depth || 0,
        relation: node.id === payload.root ? "draft" : (node.depth || 0) === 1 ? "cited" : "expanded",
      }));
      setGraph({ root: payload.root, nodes, edges: payload.edges.map((edge) => ({ ...edge, kind: "cites" })) });
      setCitedPapers(nodes.filter((node) => node.depth === 1));
      setSuggestedPapers([]);
      setKeywords(["WiFi", "localization", "drone", "sensing"]);
      setManualTitle(nodes.find((node) => node.id === payload.root)?.title || "Wi2SAR");
      setProgress({ value: 100, message: lang === "zh" ? "示例已就绪" : "Demo ready" });
    } catch {
      setError("The demo graph is unavailable.");
    } finally {
      setAnalyzing(false);
    }
  };

  const runSearch = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (searchQuery.trim().length < 2) return;
    setSearching(true);
    setError("");
    try {
      setSearchResults(await clientSearch({ query: searchQuery.trim(), source: searchSource, fromYear: searchFromYear, limit: 30 }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const venueFiltered = useMemo(() => {
    return venuePapers.filter((paper) => !venueTopic || paper.topics.includes(venueTopic));
  }, [venuePapers, venueTopic]);

  const venueTypeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const paper of venuePapers) if (paper.type) counts.set(paper.type, (counts.get(paper.type) || 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [venuePapers]);

  const venueSearched = useMemo(() => {
    const query = venueQuery.trim().toLowerCase();
    const filtered = venueFiltered.filter((paper) => {
      if (venueType && (paper.type || "") !== venueType) return false;
      if (!query) return true;
      const haystack = `${paper.title} ${paper.authors.join(" ")} ${paper.doi || ""} ${paper.series || ""}`.toLowerCase();
      return haystack.includes(query);
    });
    return [...filtered].sort((a, b) =>
      venueSort === "title" ? a.title.localeCompare(b.title) : (b.citationCount || 0) - (a.citationCount || 0),
    );
  }, [venueFiltered, venueQuery, venueType, venueSort]);

  const venueVisible = useMemo(() => venueSearched.slice(0, venueLimit), [venueSearched, venueLimit]);

  const openLibraryPaper = (paper: VenueLibraryPaper) =>
    setSelectedPaper({
      id: paper.id,
      openAlexId: paper.openAlexId || undefined,
      title: paper.title,
      authors: paper.authors,
      year: paper.year,
      venue: paper.series ? `${paper.venueName} · ${paper.series}` : paper.venueName,
      doi: paper.doi || undefined,
      url: paper.url,
      citationCount: paper.citationCount || 0,
      topics: paper.topics,
      referenceIds: paper.referenceIds,
      relatedIds: [],
      source: "Local",
      kind: paper.type || undefined,
    });

  /* In-slice citation edges: which loaded papers this one cites / is cited by. */
  const selectedRelations = useMemo(() => {
    if (!selectedPaper?.openAlexId || !venuePapers.length) return null;
    const refs = venuePapers.filter((paper) => paper.openAlexId && selectedPaper.referenceIds.includes(paper.openAlexId));
    const citedBy = venuePapers.filter((paper) => paper.openAlexId && selectedPaper.openAlexId && paper.referenceIds.includes(selectedPaper.openAlexId));
    if (!refs.length && !citedBy.length) return null;
    return { refs, citedBy };
  }, [selectedPaper, venuePapers]);

  const loadRelations = async (paper: Paper) => {
    if (!paper.openAlexId || relationsLoadingFor) return;
    setRelationsLoadingFor(paper.id);
    try {
      const [refs, citing] = await Promise.all([
        paper.referenceIds.length ? clientExpand(paper.referenceIds.slice(0, 40)) : Promise.resolve([]),
        clientCitedBy(paper.openAlexId, 12),
      ]);
      setRelationCache((previous) => ({ ...previous, [paper.id]: { refs, citing } }));
    } finally {
      setRelationsLoadingFor("");
    }
  };

  const selectedVenues = useMemo(
    () => venueIndex?.venues.filter((venue) => venuePicks.has(venue.id)) || [],
    [venueIndex, venuePicks],
  );

  const annualVenueCounts = useMemo(() => {
    const start = venueYears === 10 ? 2016 : 2021;
    return Array.from({ length: 2025 - start + 1 }, (_, index) => {
      const year = start + index;
      const counts = Object.fromEntries(selectedVenues.map((venue) => [venue.id, venue.years[String(year)] || 0])) as Record<string, number>;
      return { year, counts, total: Object.values(counts).reduce((sum, value) => sum + value, 0) };
    });
  }, [selectedVenues, venueYears]);

  const venueTopicCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const paper of venuePapers) for (const topic of paper.topics) counts.set(topic, (counts.get(topic) || 0) + 1);
    const palette = ["#df665b", "#665ee8", "#3f82c4", "#2d9a87", "#b45f9a", "#de8b42", "#568a71", "#5a9ab1", "#7a9b4d"];
    return [...counts].map(([name, count], index) => ({ id: name, name, cn: name, color: palette[index % palette.length], count })).sort((a, b) => b.count - a.count);
  }, [venuePapers]);

  const selectedPaperCount = useMemo(
    () => annualVenueCounts.reduce((sum, row) => sum + row.total, 0),
    [annualVenueCounts],
  );

  const maxAnnual = Math.max(1, ...annualVenueCounts.map((item) => item.total));
  const maxTopic = Math.max(1, ...venueTopicCounts.map((item) => item.count));

  return (
    <div className="site-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="PaperTrail home"><span className="brand-mark">文</span><span><b>文脉</b><small>PAPERTRAIL</small></span></a>
        <nav aria-label="Primary navigation">
          <button type="button" className={mode === "analyze" ? "active" : ""} onClick={() => selectMode("analyze")}>{t.navAnalyze}</button>
          <button type="button" className={mode === "discover" ? "active" : ""} onClick={() => selectMode("discover")}>{t.navDiscover}</button>
          <button type="button" className={mode === "venues" ? "active" : ""} onClick={() => selectMode("venues")}>{t.navVenues}</button>
          <button type="button" className={mode === "daily" ? "active" : ""} onClick={() => selectMode("daily")}>{t.navDaily}</button>
        </nav>
        <div className="top-actions">
          {savedPapers.length > 0 && <span className="saved-count">{savedPapers.length} saved</span>}
          <button className="lang-switch" type="button" onClick={() => setLang(lang === "zh" ? "en" : "zh")}>{lang === "zh" ? "EN" : "中"}</button>
        </div>
      </header>

      <main id="top">
        {mode === "analyze" && (
          <>
            <section className="hero analyze-hero">
              <div className="hero-copy">
                <span className="eyebrow">{t.heroKicker}</span>
                <h1>{t.heroTitleA}<br /><em>{t.heroTitleB}</em></h1>
                <p>{t.heroBody}</p>
                <div className="hero-trust"><span>OpenAlex</span><span>Crossref</span><span>DBLP</span><span>IETF Datatracker</span></div>
              </div>
              <div className="draft-workbench">
                <input ref={fileInput} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => handleFile(event.target.files?.[0] || null)} />
                <button className={`dropzone ${file ? "has-file" : ""}`} type="button" onClick={() => fileInput.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); handleFile(event.dataTransfer.files?.[0] || null); }}>
                  <span className="upload-glyph">↑</span>
                  <strong>{file ? file.name : t.upload}</strong>
                  <small>{file ? `${draft?.pages || "…"} pages · ${draft?.dois.length || 0} DOI` : t.uploadHint}</small>
                  <i>{t.choose}</i>
                </button>
                <label className="field-label">{t.titleLabel}<input value={manualTitle} onChange={(event) => setManualTitle(event.target.value)} placeholder={t.titlePlaceholder} /></label>
                <label className="field-label">{t.abstractLabel}<textarea value={manualText} onChange={(event) => setManualText(event.target.value)} placeholder={t.abstractPlaceholder} rows={4} /></label>
                <div className="analysis-options">
                  <label>{t.depth}<select value={depth} onChange={(event) => setDepth(Number(event.target.value))}><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label>
                  <label>{t.source}<select value={source} onChange={(event) => setSource(event.target.value as "all" | "acm" | "ietf")}><option value="all">All / 全部</option><option value="acm">ACM</option><option value="ietf">IETF / RFC</option></select></label>
                  <label>{t.recent}<select value={fromYear} onChange={(event) => setFromYear(Number(event.target.value))}><option value={CURRENT_YEAR - 3}>{yearRangeLabel(CURRENT_YEAR - 3)}</option><option value={CURRENT_YEAR - 7}>{yearRangeLabel(CURRENT_YEAR - 7)}</option><option value={CURRENT_YEAR - 12}>{yearRangeLabel(CURRENT_YEAR - 12)}</option></select></label>
                </div>
                <div className="workbench-actions">
                  <button className="primary-button" type="button" onClick={analyzeDraft} disabled={analyzing || (!draft && manualText.trim().length < 20)}>{analyzing ? (lang === "zh" ? "正在分析…" : "Analyzing…") : t.analyze}</button>
                  <button className="text-button" type="button" onClick={loadDemo} disabled={analyzing}>{t.demo}</button>
                </div>
                {(progress.value > 0 || analyzing) && <div className="progress" role="status"><div><span>{progress.message}</span><b>{progress.value}%</b></div><i style={{ width: `${progress.value}%` }} /></div>}
                {error && <div className="error-banner" role="alert">{error}</div>}
                <div className="privacy-note"><b>{t.private}</b><span>{t.privateBody}</span></div>
              </div>
            </section>

            {graph && (
              <section className="analysis-results" aria-live="polite">
                <div className="result-summary">
                  <div><span className="eyebrow">CITATION REVIEW</span><h2>{manualTitle || "Your draft"}</h2></div>
                  <div className="metrics-row"><Metric value={citedPapers.length} label={t.citedPapers} /><Metric value={suggestedPapers.length} label={t.missingPapers} /><Metric value={graph.nodes.length} label="graph nodes" /><Metric value={unresolved.length} label="unresolved DOI" /></div>
                </div>
                <div className="result-tabs" role="tablist">
                  {(["map", "cited", "missing", "coverage"] as AnalysisTab[]).map((tab) => <button key={tab} type="button" role="tab" aria-selected={analysisTab === tab} className={analysisTab === tab ? "active" : ""} onClick={() => setAnalysisTab(tab)}>{tab === "map" ? t.map : tab === "cited" ? `${t.cited} ${citedPapers.length}` : tab === "missing" ? `${t.missing} ${suggestedPapers.length}` : t.coverage}</button>)}
                </div>
                {analysisTab === "map" && <GraphView key={graph.root} graph={graph} onSelect={setSelectedPaper} />}
                {analysisTab === "cited" && <div className="paper-grid">{citedPapers.map((paper) => <PaperCard key={paper.id} paper={paper} lang={lang} saved={savedIds.has(paper.doi || paper.id)} onSave={savePaper} onSelect={setSelectedPaper} />)}{!citedPapers.length && <div className="empty-state">No DOI or RFC reference could be resolved. Paste the bibliography text to improve matching.</div>}</div>}
                {analysisTab === "missing" && <div className="paper-grid">{suggestedPapers.map((paper) => <PaperCard key={paper.id} paper={paper} lang={lang} saved={savedIds.has(paper.doi || paper.id)} onSave={savePaper} onSelect={setSelectedPaper} />)}</div>}
                {analysisTab === "coverage" && <div className="coverage-panel"><div className="topic-cloud">{keywords.map((keyword, index) => <span key={keyword} style={{ fontSize: `${1 + Math.max(0, 8 - index) * 0.07}rem` }}>{keyword}</span>)}</div><div className="coverage-explain"><h3>{lang === "zh" ? "如何读这个结果" : "How to read this result"}</h3><p>{lang === "zh" ? "建议不是“必须引用”的裁决。系统用标题与主题重叠、近期性、引用影响力和顶会信号排序；请打开 DOI 阅读原文并自行判断论证是否真正相关。" : "Suggestions are not mandatory citations. Ranking combines title/topic overlap, recency, citation impact, and selective-venue signals. Open the DOI and verify the claim against the original paper."}</p><dl><div><dt>58%</dt><dd>topic overlap</dd></div><div><dt>20%</dt><dd>recency</dd></div><div><dt>14%</dt><dd>impact</dd></div><div><dt>8%</dt><dd>venue signal</dd></div></dl></div></div>}
              </section>
            )}
          </>
        )}

        {mode === "discover" && (
          <section className="discover-page">
            <div className="section-heading"><span className="eyebrow">GLOBAL PAPER SEARCH</span><h1>{t.searchTitle}</h1><p>{t.searchBody}</p></div>
            <form className="search-console" onSubmit={runSearch}>
              <input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={t.searchPlaceholder} aria-label={t.searchPlaceholder} />
              <select value={searchSource} onChange={(event) => setSearchSource(event.target.value as "all" | "acm" | "ietf")} aria-label="Source"><option value="all">All research</option><option value="acm">ACM only</option><option value="ietf">IETF / RFC only</option></select>
              <select value={searchFromYear} onChange={(event) => setSearchFromYear(Number(event.target.value))} aria-label="From year"><option value={CURRENT_YEAR - 2}>Last 3 years</option><option value={CURRENT_YEAR - 5}>Last 6 years</option><option value={CURRENT_YEAR - 10}>Last 11 years</option><option value="0">Any year</option></select>
              <button type="submit" disabled={searching || searchQuery.trim().length < 2}>{searching ? "…" : t.search}</button>
            </form>
            <div className="search-context"><span>{sourceLabel(searchSource)}</span><span>{searchFromYear ? yearRangeLabel(searchFromYear) : "All years"}</span><span>OpenAlex + Crossref</span></div>
            {searching && <div className="skeleton-list" aria-label="Loading search results">{Array.from({ length: 5 }, (_, index) => <i key={index} />)}</div>}
            {!searching && searchResults.length > 0 && <div className="paper-grid search-results">{searchResults.map((paper) => <PaperCard key={paper.id} paper={paper} lang={lang} saved={savedIds.has(paper.doi || paper.id)} onSave={savePaper} onSelect={setSelectedPaper} />)}</div>}
            {!searching && searchQuery && !searchResults.length && <div className="empty-state">{t.noResults}</div>}
          </section>
        )}

        {mode === "venues" && (
          <section className="venues-page">
            <div className="section-heading"><span className="eyebrow">VENUE RADAR · 2016—2025</span><h1>{t.venuesTitle}</h1><p>{venueIndex ? (lang === "zh" ? `${venueIndex.venues.length} 个会议与期刊 · ${format(venueIndex.stats.totalRecords)} 篇论文 · ${format(venueIndex.stats.referenceCoverage.crossrefDoiReferenceEdges)} 条 DOI 引用边，按会场与年份即时加载。` : `${venueIndex.venues.length} conference and journal collections · ${format(venueIndex.stats.totalRecords)} papers · ${format(venueIndex.stats.referenceCoverage.crossrefDoiReferenceEdges)} DOI citation edges, loaded lazily by venue and year.`) : t.venuesBody}</p></div>
            <div className="venue-controls">
              <div className="segmented"><button type="button" className={venueYears === 5 ? "active" : ""} onClick={() => setVenueYears(5)}>5 years</button><button type="button" className={venueYears === 10 ? "active" : ""} onClick={() => setVenueYears(10)}>10 years</button></div>
              <div className="venue-picks">{venueIndex?.venues.map((venue) => <label key={venue.id}><input type="checkbox" checked={venuePicks.has(venue.id)} onChange={() => setVenuePicks((previous) => { const next = new Set(previous); if (next.has(venue.id)) next.delete(venue.id); else next.add(venue.id); return next; })} /><span style={{ color: VENUE_COLORS[venue.id], background: `${VENUE_COLORS[venue.id]}12` }}>{venue.name.replace(/^ACM |^IEEE |^USENIX /, "")}</span></label>)}</div>
            </div>
            <div className="venue-controls venue-slice-controls">
              <span className="eyebrow">{lang === "zh" ? "按需浏览论文" : "LAZY PAPER BROWSER"}</span>
              <select value={venueFocus} onChange={(event) => { setVenueFocus(event.target.value); setVenueTopic(""); setVenueQuery(""); setVenueType(""); setVenueLimit(60); }} aria-label="Paper collection">{venueIndex?.venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}</select>
              <select value={venueFocusYear} onChange={(event) => { setVenueFocusYear(Number(event.target.value)); setVenueTopic(""); setVenueQuery(""); setVenueType(""); setVenueLimit(60); }} aria-label="Publication year">{Array.from({ length: 10 }, (_, index) => 2025 - index).map((year) => <option key={year} value={year}>{year}</option>)}</select>
              <select value={venueTopic} onChange={(event) => { setVenueTopic(event.target.value); setVenueLimit(60); }}><option value="">All aspects</option>{venueTopicCounts.slice(0, 50).map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select>
            </div>
            {venueLoading && <div className="venue-loading"><i /><i /><i /></div>}
            {venueIndex && (
              <>
                <div className="venue-metrics"><Metric value={format(selectedPaperCount)} label={t.papers} /><Metric value={selectedVenues.length} label={t.mainPapers} /><Metric value={format(venueIndex.stats.referenceCoverage.crossrefDoiReferenceEdges)} label={t.internalCites} /></div>
                <div className="venue-dashboard">
                  <article className="dashboard-card volume-card"><div className="card-heading"><span>01 · VOLUME</span><h2>{lang === "zh" ? "每年发表了多少？" : "How much did each venue publish?"}</h2></div><div className="annual-chart">{annualVenueCounts.map((item) => <div className="year-column" key={item.year}><div className="stack" style={{ height: `${Math.max(4, item.total / maxAnnual * 100)}%` }}>{selectedVenues.map((venue) => { const count = item.counts[venue.id] || 0; return count && item.total ? <i key={venue.id} style={{ height: `${count / item.total * 100}%`, background: VENUE_COLORS[venue.id] }} title={`${venue.name}: ${count}`} /> : null; })}</div><b>{format(item.total)}</b><span>{item.year}</span></div>)}</div></article>
                  <article className="dashboard-card topics-card"><div className="card-heading"><span>02 · ASPECTS · {venueFocusYear}</span><h2>{lang === "zh" ? "这一切片在研究什么？" : "What is this venue-year about?"}</h2></div>{venueSliceLoading ? <div className="venue-loading"><i /><i /><i /></div> : <div className="topic-bars">{venueTopicCounts.slice(0, 9).map((topic) => <button type="button" key={topic.id} onClick={() => setVenueTopic(venueTopic === topic.id ? "" : topic.id)} className={venueTopic === topic.id ? "active" : ""}><span>{topic.name}</span><i style={{ width: `${topic.count / maxTopic * 100}%`, background: topic.color }} /><b>{topic.count}</b></button>)}</div>}</article>
                  <article className="dashboard-card impact-card"><div className="card-heading"><span>03 · IMPACT · {format(venuePapers.length)} PAPERS LOADED</span><h2>{lang === "zh" ? "这一会场年份中被引最多" : "Most cited in this venue-year"}</h2></div><div className="ranked-papers">{[...venueFiltered].sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0)).slice(0, 8).map((paper, index) => <button type="button" key={paper.id} onClick={() => openLibraryPaper(paper)}><em>{String(index + 1).padStart(2, "0")}</em><span><b>{paper.title}</b><small>{paper.venueName} · {paper.year}</small></span><strong>{format(paper.citationCount || 0)}</strong></button>)}</div></article>
                </div>
                <article className="dashboard-card browser-card">
                  <div className="card-heading"><span>04 · BROWSER · {venueIndex.venues.find((venue) => venue.id === venueFocus)?.name} {venueFocusYear}</span><h2>{t.browseTitle}</h2></div>
                  <div className="browser-controls">
                    <input type="search" value={venueQuery} onChange={(event) => { setVenueQuery(event.target.value); setVenueLimit(60); }} placeholder={t.filterPlaceholder} aria-label={t.filterPlaceholder} />
                    <select value={venueType} onChange={(event) => { setVenueType(event.target.value); setVenueLimit(60); }} aria-label="Type"><option value="">{t.allTypes}</option>{venueTypeCounts.map(([type, count]) => <option key={type} value={type}>{type} · {count}</option>)}</select>
                    <select value={venueSort} onChange={(event) => setVenueSort(event.target.value as "citations" | "title")} aria-label="Sort"><option value="citations">{t.sortCitations}</option><option value="title">{t.sortTitle}</option></select>
                  </div>
                  {venueSliceLoading ? <div className="venue-loading"><i /></div> : (
                    <>
                      <div className="browser-count">{format(venueSearched.length)} / {format(venuePapers.length)} {t.papers}</div>
                      <div className="paper-list">
                        {venueVisible.map((paper, index) => (
                          <button type="button" key={paper.id} onClick={() => openLibraryPaper(paper)}>
                            <em>{String(index + 1).padStart(2, "0")}</em>
                            <span><b>{paper.title}</b><small>{paper.authors.slice(0, 4).join(", ")}{paper.authors.length > 4 ? " et al." : ""}</small></span>
                            <i className="paper-list-side"><strong>{format(paper.citationCount || 0)}</strong>{paper.type && <u>{paper.type}</u>}</i>
                          </button>
                        ))}
                        {!venueVisible.length && <div className="empty-state">{t.noResults}</div>}
                      </div>
                      {venueSearched.length > venueLimit && <button type="button" className="show-more" onClick={() => setVenueLimit(venueLimit + 200)}>{t.showMore} · {format(venueSearched.length - venueLimit)}</button>}
                    </>
                  )}
                </article>
              </>
            )}
          </section>
        )}
        {mode === "daily" && (
          <section className="daily-page">
            <div className="section-heading"><span className="eyebrow">DAILY SPEED-READ</span><h1>{t.dailyTitle}</h1><p>{t.dailyBody}</p></div>
            {dailyLoading && <div className="venue-loading"><i /><i /></div>}
            {!dailyLoading && dailyEpisodes && !dailyEpisodes.length && <div className="empty-state">{t.noResults}</div>}
            {dailyEpisodes && dailyEpisodes.length > 0 && dailyEpisodes[dailyFocus] && (
              <div className="daily-layout">
                <div className="episode-list">
                  {dailyEpisodes.map((episode, index) => (
                    <button type="button" key={episode.date} className={index === dailyFocus ? "active" : ""} onClick={() => setDailyFocus(index)}>
                      <em>{episode.date}</em>
                      <span><b>{episode.title}</b><small>{episode.venueName} · {episode.year} · {format(episode.citationCount)} cites</small></span>
                    </button>
                  ))}
                </div>
                <article className="episode-view">
                  <h2>{dailyEpisodes[dailyFocus].title}</h2>
                  <p className="episode-meta">{dailyEpisodes[dailyFocus].venueName} {dailyEpisodes[dailyFocus].year} · {dailyEpisodes[dailyFocus].authors.slice(0, 3).join(", ")}{dailyEpisodes[dailyFocus].authors.length > 3 ? " et al." : ""} · {dailyEpisodes[dailyFocus].date}</p>
                  {!brokenVideos[dailyEpisodes[dailyFocus].date] ? (
                    <video key={dailyEpisodes[dailyFocus].date} className="episode-video" controls preload="metadata" src={dataUrl(`/${dailyEpisodes[dailyFocus].video}`)} onError={() => setBrokenVideos((previous) => ({ ...previous, [dailyEpisodes[dailyFocus].date]: true }))}>
                      <track kind="captions" src={dataUrl(`/daily/${dailyEpisodes[dailyFocus].date}.vtt`)} srcLang="zh" label="中文字幕" default />
                    </video>
                  ) : (
                    <div className="episode-pending">{t.videoPending}</div>
                  )}
                  <h3>{t.scriptLabel}</h3>
                  <div className="episode-script">{dailyEpisodes[dailyFocus].script.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
                  <a className="text-button" href={dailyEpisodes[dailyFocus].url} target="_blank" rel="noreferrer">{t.openDoi}</a>
                </article>
              </div>
            )}
          </section>
        )}
      </main>

      <footer>
        <div className="brand footer-brand"><span className="brand-mark">文</span><span><b>文脉</b><small>PAPERTRAIL</small></span></div>
        <p>{lang === "zh" ? "公开、可解释、隐私优先的论文关系与引用发现工具。" : "Open, explainable, privacy-first paper relationships and citation discovery."}</p>
        <nav><a href={dataUrl("/methodology")}>{t.methodology}</a><a href={dataUrl("/privacy")}>{t.privacy}</a><a href={dataUrl("/methodology#sources")}>{t.sources}</a></nav>
      </footer>

      {selectedPaper && (
        <aside className="paper-drawer" aria-label="Paper details">
          <button className="drawer-close" type="button" onClick={() => setSelectedPaper(null)} aria-label="Close">×</button>
          <span className="eyebrow">{selectedPaper.source} · {selectedPaper.year || "YEAR UNKNOWN"}</span>
          <h2>{selectedPaper.title}</h2>
          <p className="drawer-authors">{selectedPaper.authors.join(", ") || "Authors unavailable"}</p>
          <div className="drawer-venue"><span className={selectedPaper.isTopVenue ? "venue-badge top" : "venue-badge"}>{selectedPaper.venue}</span><b>{format(selectedPaper.citationCount)} citations</b></div>
          {selectedPaper.topics.length > 0 && <div className="drawer-topics">{selectedPaper.topics.map((topic) => <span key={topic}>{topic}</span>)}</div>}
          {selectedPaper.reasons?.length ? <section><h3>Why it surfaced</h3><ul>{selectedPaper.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></section> : null}
          {(selectedRelations || selectedPaper.openAlexId) && (
            <section>
              <h3>{t.relations}</h3>
              {selectedRelations && (
                <>
                  <p className="relations-note">{t.relationsNote}</p>
                  {selectedRelations.citedBy.length > 0 && (
                    <>
                      <h4>{t.citedByInSlice} · {selectedRelations.citedBy.length}</h4>
                      <ul className="relation-list">{selectedRelations.citedBy.slice(0, 12).map((paper) => <li key={paper.id}><button type="button" onClick={() => openLibraryPaper(paper)}><b>{paper.title}</b><small>{paper.authors.slice(0, 3).join(", ")} · {format(paper.citationCount || 0)} cites</small></button></li>)}</ul>
                    </>
                  )}
                  {selectedRelations.refs.length > 0 && (
                    <>
                      <h4>{t.refsInSlice} · {selectedRelations.refs.length}</h4>
                      <ul className="relation-list">{selectedRelations.refs.slice(0, 12).map((paper) => <li key={paper.id}><button type="button" onClick={() => openLibraryPaper(paper)}><b>{paper.title}</b><small>{paper.authors.slice(0, 3).join(", ")} · {format(paper.citationCount || 0)} cites</small></button></li>)}</ul>
                    </>
                  )}
                </>
              )}
              {selectedPaper.openAlexId && (
                relationCache[selectedPaper.id] ? (
                  <>
                    <h4>{t.refsOpenAlex} · {relationCache[selectedPaper.id].refs.length}</h4>
                    <ul className="relation-list">{relationCache[selectedPaper.id].refs.slice(0, 12).map((paper) => <li key={paper.id}><button type="button" onClick={() => setSelectedPaper(paper)}><b>{paper.title}</b><small>{paper.venue} · {paper.year} · {format(paper.citationCount)} cites</small></button></li>)}</ul>
                    <h4>{t.citingOpenAlex} · {relationCache[selectedPaper.id].citing.length}</h4>
                    <ul className="relation-list">{relationCache[selectedPaper.id].citing.map((paper) => <li key={paper.id}><button type="button" onClick={() => setSelectedPaper(paper)}><b>{paper.title}</b><small>{paper.venue} · {paper.year} · {format(paper.citationCount)} cites</small></button></li>)}</ul>
                  </>
                ) : (
                  <button type="button" className="show-more" onClick={() => loadRelations(selectedPaper)} disabled={relationsLoadingFor === selectedPaper.id}>{relationsLoadingFor === selectedPaper.id ? "…" : t.loadRelations}</button>
                )
              )}
              {selectedPaper.referenceIds.length > 0 && <p className="relations-note">{selectedPaper.referenceIds.length} references indexed via OpenAlex</p>}
            </section>
          )}
          <div className="drawer-actions"><a className="primary-button" href={selectedPaper.url} target="_blank" rel="noreferrer">{t.openDoi}</a><button type="button" onClick={() => navigator.clipboard.writeText(paperToBibtex(selectedPaper))}>{t.copyBib}</button><button type="button" onClick={() => savePaper(selectedPaper)}>{savedIds.has(selectedPaper.doi || selectedPaper.id) ? t.saved : t.save}</button></div>
          {selectedPaper.doi && <code>doi:{selectedPaper.doi}</code>}
        </aside>
      )}
    </div>
  );
}
