import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy",
  description: "How PaperTrail handles PDFs, extracted text, DOI identifiers, saved papers, and third-party research metadata.",
};

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <Link href="/">← PaperTrail · 文脉</Link>
      <span className="eyebrow">PRIVACY · 隐私说明</span>
      <h1>Your draft stays yours.<br />你的草稿仍然属于你。</h1>
      <p>PaperTrail is designed to reveal literature relationships without turning a private draft into a stored upload.</p>
      <div className="legal-grid">
        <section><h2>PDF handling</h2><p>Your PDF is parsed inside your browser. The original PDF file is not sent to PaperTrail’s server or retained by PaperTrail.</p><h2>PDF 处理</h2><p>PDF 在浏览器内解析，原始文件不会发送到 PaperTrail 服务器，也不会由 PaperTrail 保存。</p></section>
        <section><h2>Research lookups</h2><p>To resolve references and find related work, the site sends bounded extracted text, search keywords, DOI identifiers, and requested OpenAlex IDs to its own lookup endpoints. Those endpoints query public scholarly metadata services.</p><h2>论文检索</h2><p>为解析引用和查找相关论文，网站会发送有限长度的提取文本、关键词、DOI 和所请求的 OpenAlex 标识，并查询公开学术元数据服务。</p></section>
        <section><h2>Storage</h2><p>No account is required. Your shortlist and language preference are stored only in this browser. PaperTrail does not create a server-side profile of your reading history.</p><h2>存储</h2><p>无需账号。收藏列表和语言偏好只保存在当前浏览器；PaperTrail 不会在服务器端建立你的阅读历史档案。</p></section>
        <section><h2>Third parties & logs</h2><p>Metadata requests may reach OpenAlex, Crossref, DBLP, IETF Datatracker, and DOI publishers. Those services and the hosting infrastructure may keep ordinary security and access logs under their own policies. Do not paste confidential material if sharing extracted text with these services would be inappropriate.</p><h2>第三方与日志</h2><p>元数据请求可能访问 OpenAlex、Crossref、DBLP、IETF Datatracker 和 DOI 出版页面；这些服务及托管基础设施可能按各自政策保留常规安全与访问日志。若提取文本不应发送给这些服务，请勿粘贴机密内容。</p></section>
      </div>
    </main>
  );
}
