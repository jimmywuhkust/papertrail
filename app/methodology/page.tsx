import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Methodology",
  description: "The transparent rules behind PaperTrail search, citation graphs, venue labels, and missing-reference recommendations.",
};

export default function MethodologyPage() {
  return (
    <main className="legal-page">
      <Link href="/">← PaperTrail · 文脉</Link>
      <span className="eyebrow">METHODOLOGY · 方法说明</span>
      <h1>Explain the ranking.<br />不把推荐藏进黑箱。</h1>
      <p>PaperTrail is a discovery aid, not an authority on what you must cite. Every suggestion should be checked against the original work.</p>
      <div className="legal-grid">
        <section><h2>1 · Reference detection</h2><p>The browser extracts PDF text, locates the bibliography, and detects DOI and RFC patterns. DOI records are resolved against public metadata. Entries without stable identifiers may remain unresolved.</p><h2>1 · 引用识别</h2><p>浏览器提取 PDF 文本、定位参考文献并识别 DOI/RFC 格式，再通过公开元数据解析。缺少稳定标识的条目可能无法自动解析。</p></section>
        <section><h2>2 · Recommendation score</h2><ul><li>58% title and research-topic overlap</li><li>20% publication recency</li><li>14% citation-impact signal</li><li>8% selective-venue signal</li></ul><p>The score is a ranking aid, not a probability that a citation is required.</p><h2>2 · 推荐分数</h2><p>由主题重叠、近期性、引用影响力与会场信号组成，不代表“必须引用”的概率。</p></section>
        <section><h2>3 · Relationship graph</h2><p>Solid lines represent references found in metadata. Dashed blue lines are provider-defined related works; purple dashed lines connect your draft to ranked suggestions. Public usage is bounded to three expansion layers and a curated visible-node cap so the graph stays readable.</p><h2>3 · 关系图</h2><p>实线表示元数据中的引用；蓝色虚线表示相关论文；紫色虚线连接推荐结果。公开版本最多扩展三层，并限制同时显示的节点，以保持可读性。</p></section>
        <section id="sources"><h2>4 · Sources</h2><ul><li>OpenAlex: work metadata, cited-by counts, topics, references, related works</li><li>Crossref: DOI registry metadata and publisher links</li><li>DBLP: curated computer-science venue records in the bundled venue radar</li><li>IETF Datatracker / RFC DOI records: standards metadata</li></ul><h2>4 · 数据源</h2><p>数据可能延迟、缺失或包含合并错误。页面会展示来源和 DOI，方便回到原始记录核查。</p></section>
        <section><h2>Limitations</h2><p>Title-based overlap can miss conceptual connections, citation counts favor older work, and venue labels are an imperfect proxy for quality. A missing result is not evidence that a paper does not exist. Always read the original paper before citing it.</p><h2>局限</h2><p>标题重叠可能遗漏概念关系，被引量偏向较早论文，会场也不能直接代表质量。没有搜索到不等于论文不存在；引用前必须阅读原文。</p></section>
        <section><h2>No mandatory LLM</h2><p>The public release runs without an AI-agent dependency. PDF parsing, identifier detection, graph expansion, and ranking use deterministic rules. This keeps the core service auditable and available without a model key.</p><h2>不强制依赖 LLM</h2><p>公开版本的核心解析、识别、图谱与排序均为确定性规则，不要求模型密钥，便于审查和稳定使用。</p></section>
      </div>
    </main>
  );
}
