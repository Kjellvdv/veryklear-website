export const RANGES = [7, 30, 90, 365] as const;

/** The pages a visitor lands on when they act. */
export const TARGET_PATHS = ["/strategiesessie", "/contact"] as const;

/** What Very Klear sells, as pages. A session that opens one of these looked at the offer. */
export const SERVICE_PATHS = [
  "/diensten",
  "/positionering",
  "/marketing-strategie",
  "/ai",
  "/fractioneel",
] as const;

export const TABS = [
  { id: "overview", label: "Overview" },
  { id: "sources", label: "Sources" },
  { id: "pages", label: "Pages" },
  { id: "journeys", label: "Journeys" },
  { id: "audience", label: "Audience" },
  { id: "quality", label: "Data quality" },
] as const;

export type TabId = (typeof TABS)[number]["id"];

export interface Counts {
  visitors: number;
  views: number;
}

export interface Report {
  days: number;
  from: string;
  to: string;
  totals: Counts & { sessions: number };
  /** The same measures for the equal-length window just before this one. */
  previous: (Counts & { sessions: number }) | null;
  daily: { day: string; views: number; visitors: number }[];
  /** Page views per hour of the day, Belgian time, index 0 to 23. */
  hours: number[];
  /** Page views per weekday, Belgian time, Monday first. */
  weekdays: number[];
  pages: { path: string; visitors: number; views: number; entries: number; exits: number }[];
  /** Visits to the contact and booking pages, by the page of ours they came from. */
  routes: { target: string; source: string; visitors: number; views: number }[];
  referrers: { source: string; visitors: number; views: number }[];
  campaigns: {
    source: string;
    medium: string;
    campaign: string;
    visitors: number;
    views: number;
  }[];
  /** Sessions by where they started, and how many of them reached contact or booking. */
  sources: {
    source: string;
    kind: "campaign" | "referrer" | "direct";
    sessions: number;
    reached: number;
  }[];
  /** What sessions did. Not nested: one session can count under several. */
  behaviour: {
    sessions: number;
    multiPage: number;
    service: number;
    article: number;
    reached: number;
  };
  devices: { device: string; visitors: number; views: number }[];
  languages: { lang: string; visitors: number; views: number }[];
  flows: Flows;
  /** Automated page requests the filter left out, by reason, summed over the window. */
  filtered: { reason: string; requests: number }[];
  filteredDaily: { day: string; reasons: Record<string, number> }[];
  /** Left-out requests as a share of every page request that reached a real page. */
  automated: { requests: number; share: number };
}

export interface Flows {
  sessions: number;
  /** Sessions in which the visitor saw one page only (reloads included). */
  singlePage: number;
  pagesPerSession: number;
  entries: { path: string; sessions: number }[];
  exits: { path: string; sessions: number }[];
  /** Page to the page opened next, across all multi-page sessions. */
  steps: { from: string; to: string; sessions: number }[];
  /** The first five pages of multi-page sessions. `more` is true when the session went on. */
  paths: { pages: string[]; more: boolean; sessions: number }[];
  /** The most recent sessions, one by one, each with what the visitor arrived with. */
  recent: SessionRow[];
}

/**
 * One session. Source, language and device are those of its first page: that is
 * the visit that arrived from somewhere, the later pages only moved around.
 */
export interface SessionRow {
  /** Epoch ms of the first page, UTC. */
  start: number;
  /** Seconds from the first page to the last. How long the last page was read is not known. */
  seconds: number;
  /** Pages opened, reloads left out. */
  pageCount: number;
  /** The first eight pages with the seconds since the session began. */
  pages: { path: string; at: number }[];
  more: boolean;
  /** The referring site of the first page, "(own site)" or "(direct)". */
  from: string;
  /** utm_source / utm_medium / utm_campaign of the first page, empty parts left out. */
  campaign: string;
  lang: string;
  device: string;
}
