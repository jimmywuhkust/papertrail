export type Counts = { upstreamCitationCount: number | null; incomingCorpusCitationCount: number; recordedReferenceCount: number };
export type Edge = { source: string; target: string; kind: "cites"; sources: string[]; checkedAt: string | null };
export type Authorship = { authorId: string; name: string; position: number; status: "upstream_identifier" | "name_only"; source: string; sourceUrl: string; checkedAt: string | null };
export type Provenance = { source: string | null; sourceUrl: string | null; retrievedAt: string | null; sourceUpdatedAt?: string | null; basis?: string };
export type MatchEvidence = { method: "weighted_token_overlap" | "author_association" | "coupling" | "cocitation"; score?: number; scoreDirection?: "higher_is_better"; matchedFields?: string[]; matchedTerms?: string[]; match?: string; authorId?: string; associationStatus?: string; sourceUrl?: string; checkedAt?: string | null; relationType?: "inferred_similarity"; sharedCount?: number; sharedIdentifiers?: string[]; evidenceTruncated?: boolean; seedAvailableCount?: number; candidateAvailableCount?: number; normalizedScore?: number | null; normalization?: string };
export type Paper = { id: string; title?: string | null; authors?: string[]; year?: number; venueId?: string; venueName?: string; doi?: string | null; sourceUrl?: string; url?: string | null; metadataSources?: string[]; topics?: string[]; counts?: Counts; resolutionState?: "resolved" | "external_reference" | "not_in_snapshot"; input?: string; normalizedIdentifier?: string; canonicalIdentifier?: string | null; relationship?: Edge; relationshipStatus?: { references: "available" | "unknown" | "unavailable"; cited_by: "available"; referenceSources: string[]; completeness: "not_asserted"; checkedAt: string | null }; matchEvidence?: MatchEvidence; authorships?: Authorship[]; fieldProvenance?: Record<string, Provenance>; fieldConflicts?: null };
export type Author = { id: string; name: string; nameVariants: string[]; identityStatus: "upstream_identifier" | "name_only_group"; associationStatus: "upstream_identifier" | "name_only"; paperCount: number; sources: string[]; affiliations: { name: string; sourceUrl: string; aliases?: string[]; checkedAt?: string }[]; identifiers: Record<string, string>; researchAreas?: string[]; matchEvidence: { nameMatch: "exact_name" | "all_tokens"; matchedVariants: string[]; affiliationSources: string[] } };
export type Envelope<T> = { schemaVersion: 2; snapshotId: string; operation: string; items: T[]; coverage: Record<string, unknown>; warnings: string[]; pagination?: { returned: number; total: number; offset: number; nextCursor: string | null; hasMore: boolean }; counts?: Counts; relationshipStatus?: string };
export type PageOptions = { limit?: number; offset?: number; cursor?: string | null };
export type Filters = { venue?: string | null; fromYear?: number | null; toYear?: number | null };
export class PaperTrailError extends Error { error: { code: string; message: string; retryable: boolean } }
export function normalized(identifier: string): string;
export const VERSION: string;
export function key(value: string): string;
export function tokens(value: string): string[];
export class PaperTrail {
  constructor(options?: { baseUrl?: string; snapshot?: string; fetch?: typeof globalThis.fetch });
  manifest(): Promise<{ snapshotId: string; snapshot: string; venues: { id: string; name: string }[]; capabilities: Record<string, unknown> }>;
  paper(id: string, options?: { fields?: string[] }): Promise<Envelope<Paper>>;
  papers(ids: string[], options?: { fields?: string[] }): Promise<Envelope<Paper>>;
  search(q: string, options?: PageOptions & Filters & { fields?: ("title" | "topics" | "authors")[]; match?: "all_tokens" | "any_tokens" | "exact_name" | "exact_phrase"; select?: string[] }): Promise<Envelope<Paper>>;
  authors(name: string, options?: PageOptions & { affiliation?: string | null; match?: "exact_name" | "all_tokens" }): Promise<Envelope<Author>>;
  authorPapers(authorId: string, options?: PageOptions & Filters & { fields?: string[] }): Promise<Envelope<Paper>>;
  references(id: string, options?: PageOptions & { expand?: boolean; fields?: string[] }): Promise<Envelope<Paper>>;
  citedBy(id: string, options?: PageOptions & { expand?: boolean; fields?: string[] }): Promise<Envelope<Paper>>;
  related(id: string, options?: { method?: "text"; limit?: number; fields?: string[] }): Promise<Envelope<Paper>>;
  status(): Promise<Envelope<Record<string, unknown>>>;
  graph(): never;
}
