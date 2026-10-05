export type SearchHit = { id: string; title: string; year: number; venueId: string; score: number };
export function normalize(identifier: string): string;
export class PaperTrail {
  constructor(options?: { baseUrl?: string; fetch?: typeof globalThis.fetch });
  manifest(): Promise<{ snapshot: string }>;
  paper(id: string): Promise<Record<string, unknown>>;
  search(q: string, options?: { venue?: string; fromYear?: number; toYear?: number; limit?: number; offset?: number }): Promise<{ papers: SearchHit[]; total: number; offset: number; snapshot: string }>;
  references(id: string, options?: { limit?: number; offset?: number }): Promise<{ edges: { id: string; provenance: number }[]; total: number; hasMore: boolean }>;
  citedBy(id: string, options?: { limit?: number; offset?: number }): Promise<{ edges: { id: string; provenance: number }[]; total: number; hasMore: boolean }>;
  related(id: string, options?: { method?: "text"; limit?: number }): Promise<{ papers: SearchHit[]; method: string }>;
}
