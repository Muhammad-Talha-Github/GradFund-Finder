export type SearchFilters = {
  degree: string;
  country: string;
  field: string;
  funding: string;
  deadline: string;
  sourceUrls: string[];
};

export type RawSearchResult = { title: string; url: string; content: string };

export type OpportunitySearchResult = {
  id: string;
  title: string;
  institution: string;
  country: string;
  degree: string;
  field: string;
  funding: string;
  deadline: string;
  deadlineDate: string;
  url: string;
  verified: false;
  isSearchResult: true;
  sourceDomain: string;
};

export interface WebSearchProvider {
  search(query: string, domains: string[], maxResults?: number): Promise<RawSearchResult[]>;
}
