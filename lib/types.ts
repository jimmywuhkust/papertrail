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

