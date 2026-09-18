export type PaperSource = "OpenAlex" | "Crossref" | "IETF" | "Local";

export type Paper = {
  id: string;
  openAlexId?: string;
  title: string;
  authors: string[];
  year?: number;
  venue: string;
  doi?: string;
  url: string;
  citationCount: number;
  topics: string[];
  referenceIds: string[];
  relatedIds: string[];
  source: PaperSource;
  kind?: string;
  isTopVenue?: boolean;
  score?: number;
  reasons?: string[];
};

export type GraphNode = Paper & {
  depth: number;
  relation: "draft" | "cited" | "suggested" | "expanded";
};

export type GraphEdge = {
  source: string;
  target: string;
  kind: "cites" | "suggested" | "related";
};

export type GraphData = {
  root: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type VenuePaper = {
  id: string;
  title: string;
  authors: string[];
  venue: "MobiCom" | "MobiSys" | "SenSys";
  year: number;
  track: string;
  doi?: string;
  ee?: string;
  url?: string;
  topics: string[];
  primaryTopic: string;
  citationCount: number;
};

export type VenueDataset = {
  options: { venues: string[]; years: number; startYear: number; endYear: number };
  papers: VenuePaper[];
  topicCatalog: Array<{ id: string; name: string; cn: string; color: string }>;
  relationships: { citationEdges: Array<{ source: string; target: string }> };
  stats: Record<string, unknown>;
};

export type VenueLibraryPaper = {
  id: string;
  title: string;
  authors: string[];
  year: number;
  venueId: string;
  venueName: string;
  series: string | null;
  type: string | null;
  doi: string | null;
  url: string;
  sourceId: string;
  sourceUrl: string;
  citationCount: number | null;
  openAlexId: string | null;
  topics: string[];
  referenceIds: string[];
  metadataSources: string[];
  sourceUpdatedAt: string | null;
};

export type VenueLibraryShard = {
  url: string;
  venueId: string;
  year: number;
  part: number;
  parts: number;
  records: number;
  bytes: number;
};

export type VenueLibraryIndex = {
  schemaVersion: number;
  generatedAt: string;
  range: { startYear: number; endYear: number };
  venues: Array<{
    id: string;
    name: string;
    aliases: string[];
    kind: "conference" | "journal";
    years: Record<string, number>;
    records: number;
  }>;
  shards: VenueLibraryShard[];
  referenceShards: Array<VenueLibraryShard & { edges: number; source: string }>;
  stats: {
    totalRecords: number;
    totalShards: number;
    totalBytes: number;
    byVenue: Record<string, number>;
    byYear: Record<string, number>;
    referenceCoverage: {
      crossrefSourcePapersWithReferences: number;
      crossrefDoiReferenceEdges: number;
      crossrefReferenceBytes: number;
    };
  };
};

export type VenueLibraryShardPayload = {
  venueId: string;
  venueName: string;
  year: number;
  part: number;
  parts: number;
  count: number;
  records: VenueLibraryPaper[];
};
