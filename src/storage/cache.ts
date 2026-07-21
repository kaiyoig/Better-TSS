import type {
  SearchOptions,
  SearchResult,
  TssClient,
} from "../api/tss";
import type { CourseSummary, Section } from "../api/types";

const SEARCH_TTL_MS = 30 * 60 * 1000; // 30 minutes
const SECTIONS_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface Entry<T> {
  value: T;
  storedAt: number;
}

/**
 * In-memory TTL cache wrapping {@link TssClient}. Repeated searches and section
 * fetches are served from memory until their TTL lapses. Section entries expire
 * faster (seat counts drift) and can be force-refreshed with
 * {@link CachedTss.refreshSections}.
 */
export class CachedTss {
  private searchCache = new Map<string, Entry<SearchResult>>();
  private sectionsCache = new Map<string, Entry<Section[]>>();

  constructor(private readonly client: TssClient) {}

  async searchCourses(opts: SearchOptions): Promise<SearchResult> {
    const key = searchKey(opts);
    const hit = this.searchCache.get(key);
    if (hit && !isStale(hit, SEARCH_TTL_MS)) {
      return hit.value;
    }
    const value = await this.client.searchCourses(opts);
    this.searchCache.set(key, { value, storedAt: Date.now() });
    return value;
  }

  async getSections(
    course: Pick<CourseSummary, "year" | "period" | "moduleID">,
  ): Promise<Section[]> {
    const key = sectionsKey(course);
    const hit = this.sectionsCache.get(key);
    if (hit && !isStale(hit, SECTIONS_TTL_MS)) {
      return hit.value;
    }
    return this.fetchSections(course, key);
  }

  /** Bypass the cache and overwrite it with a fresh section fetch. */
  async refreshSections(
    course: Pick<CourseSummary, "year" | "period" | "moduleID">,
  ): Promise<Section[]> {
    return this.fetchSections(course, sectionsKey(course));
  }

  private async fetchSections(
    course: Pick<CourseSummary, "year" | "period" | "moduleID">,
    key: string,
  ): Promise<Section[]> {
    const value = await this.client.getSections(course);
    this.sectionsCache.set(key, { value, storedAt: Date.now() });
    return value;
  }
}

function isStale(entry: Entry<unknown>, ttlMs: number): boolean {
  return Date.now() - entry.storedAt > ttlMs;
}

function searchKey(opts: SearchOptions): string {
  const { term, query, skip = 0, top = 30 } = opts;
  return JSON.stringify([
    term.year,
    term.period,
    term.yearText,
    term.periodText,
    query,
    skip,
    top,
  ]);
}

function sectionsKey(
  course: Pick<CourseSummary, "year" | "period" | "moduleID">,
): string {
  return `${course.year}-${course.period}-${course.moduleID}`;
}
