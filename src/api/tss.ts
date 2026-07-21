import { parseSched } from "./sched";
import type {
  CapacityColor,
  CourseDetail,
  CourseSummary,
  Meeting,
  Section,
  Term,
} from "./types";

const SAP_CLIENT = "500";
const SERVICE_ROOT =
  "https://tss.ucsd.edu/sap/opu/odata4/sap/yucsd_con_module_sb/srvd/sap/yucsd_con_module_servicedef/0001/";

const SEARCH_SELECT = [
  "AcademicLevel",
  "AcademicPeriod",
  "AcademicYear",
  "CourseAbbr",
  "CourseTitle",
  "CreditsDisplay",
  "DepartmentAbbr",
  "DepartmentText",
  "ModuleID",
  "incrementDisplay",
].join(",");

export interface SearchOptions {
  term: Term;
  query: string;
  skip?: number;
  top?: number;
}

export interface SearchResult {
  count: number;
  courses: CourseSummary[];
}

/**
 * Thin client over the UCSD Schedule-of-Classes OData v4 service. All calls run against the
 * user's live TSS session (`credentials: "include"`); the extension never handles credentials.
 * See RECON.md for the endpoint map this is built from.
 */
export class TssClient {
  private csrfToken: string | null = null;

  /** Fetch (and cache) a CSRF token via the SAP `HEAD ... X-CSRF-Token: Fetch` handshake. */
  private async fetchCsrf(): Promise<string> {
    const res = await fetch(`${SERVICE_ROOT}?sap-client=${SAP_CLIENT}`, {
      method: "HEAD",
      credentials: "include",
      headers: { "X-CSRF-Token": "Fetch" },
    });
    const token = res.headers.get("x-csrf-token");
    if (!token) {
      throw new TssError(
        "No CSRF token returned — session may be expired. Log in to TSS and retry.",
      );
    }
    this.csrfToken = token;
    return token;
  }

  private async ensureCsrf(): Promise<string> {
    return this.csrfToken ?? (await this.fetchCsrf());
  }

  /**
   * Run a single GET request wrapped in an OData `$batch` POST (the shape the Fiori UI uses).
   * Transparently re-fetches the CSRF token once on a `CSRF_Token_Missing` rejection.
   */
  private async batchGet<T>(relativeUrl: string): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.ensureCsrf();
      const boundary = `batch_tsshook_${attempt}`;
      const body =
        `--${boundary}\r\n` +
        `Content-Type:application/http\r\n` +
        `Content-Transfer-Encoding:binary\r\n\r\n` +
        `GET ${relativeUrl} HTTP/1.1\r\n` +
        `Accept:application/json;odata.metadata=minimal;IEEE754Compatible=true\r\n\r\n` +
        `\r\n--${boundary}--\r\n`;

      const res = await fetch(`${SERVICE_ROOT}$batch?sap-client=${SAP_CLIENT}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "X-CSRF-Token": token,
          "Content-Type": `multipart/mixed;boundary=${boundary}`,
          Accept: "multipart/mixed",
        },
        body,
      });

      const text = await res.text();
      if (isCsrfFailure(res.status, text) && attempt === 0) {
        this.csrfToken = null; // force re-fetch and retry once
        continue;
      }
      if (!res.ok) {
        throw new TssError(`TSS request failed (${res.status})`, text);
      }
      return extractBatchJson<T>(text);
    }
    throw new TssError("TSS request failed after CSRF retry.");
  }

  async searchCourses(opts: SearchOptions): Promise<SearchResult> {
    const { term, query, skip = 0, top = 30 } = opts;
    const filter = `AcYearText eq '${odataStr(term.yearText)}' and AcademicPeriodText eq '${odataStr(
      term.periodText,
    )}'`;
    const params = new URLSearchParams({
      "sap-client": SAP_CLIENT,
      $count: "true",
      $search: `"${query.replace(/"/g, "")}"`,
      $filter: filter,
      $select: SEARCH_SELECT,
      $skip: String(skip),
      $top: String(top),
    });
    const data = await this.batchGet<ODataCollection<RawModule>>(
      `YUCSD_CON_MODULE?${params.toString()}`,
    );
    return {
      count: Number(data["@odata.count"] ?? data.value.length),
      courses: data.value.map(mapCourse),
    };
  }

  async getSections(
    course: Pick<CourseSummary, "year" | "period" | "moduleID">,
  ): Promise<Section[]> {
    const key = `AcademicYear='${course.year}',AcademicPeriod='${course.period}',ModuleID='${course.moduleID}'`;
    const params = new URLSearchParams({
      "sap-client": SAP_CLIENT,
      $skip: "0",
      $top: "1000",
    });
    const data = await this.batchGet<ODataCollection<RawEvent>>(
      `YUCSD_CON_MODULE(${key})/_sections?${params.toString()}`,
    );
    return groupSections(data.value);
  }

  async getCourseDetail(course: CourseSummary): Promise<CourseDetail> {
    const sections = await this.getSections(course);
    return { ...course, sections };
  }
}

// ---- mapping helpers ----

function mapCourse(r: RawModule): CourseSummary {
  return {
    year: r.AcademicYear,
    period: r.AcademicPeriod,
    moduleID: r.ModuleID,
    dept: r.DepartmentAbbr,
    abbr: r.CourseAbbr,
    title: r.CourseTitle,
    units: r.CreditsDisplay,
    level: r.AcademicLevel,
  };
}

/** Group raw events into sections keyed by EventPkg (the enrollable unit). */
function groupSections(events: RawEvent[]): Section[] {
  const byPkg = new Map<string, RawEvent[]>();
  for (const ev of events) {
    const key = ev.EventPkgOtjid || ev.EventPkgText;
    const list = byPkg.get(key);
    if (list) list.push(ev);
    else byPkg.set(key, [ev]);
  }

  const sections: Section[] = [];
  for (const group of byPkg.values()) {
    const head = group[0];
    const meetings: Meeting[] = group.flatMap((ev) =>
      parseSched(ev.Sched ?? "", {
        method: ev.TeachingMethod,
        methodText: ev.TeachingMethod_Text,
        instructor: ev.InstructorName || null,
        instructorEmail: cleanEmail(ev.InstructorEmail),
      }),
    );
    sections.push({
      eventPkgText: head.EventPkgText,
      limit: toInt(head.EventPkgLimit),
      seatsAvailable: toInt(head.EventPkgSeatsAvailable),
      waitlist: toInt(head.EventPkgNumOnWaitl),
      capacity: capacityColor(head.EventPkgSemanticColorCapacity),
      meetings,
    });
  }
  return sections;
}

function capacityColor(code: number | string | undefined): CapacityColor {
  switch (Number(code)) {
    case 3:
      return "green";
    case 2:
      return "yellow";
    case 1:
      return "red";
    default:
      return "unknown";
  }
}

function cleanEmail(v: string | undefined): string | null {
  if (!v) return null;
  return v.replace(/^mailto:\s*/i, "").trim() || null;
}

function toInt(v: string | number | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function odataStr(v: string): string {
  return v.replace(/'/g, "''");
}

// ---- $batch response parsing ----

function isCsrfFailure(status: number, text: string): boolean {
  return status === 403 || /CSRF_Token_Missing|CSRF token is invalid/i.test(text);
}

/**
 * A single-part `$batch` response embeds one HTTP response whose body is the JSON payload.
 * Pull out the last `{...}` JSON object in the multipart text.
 */
function extractBatchJson<T>(text: string): T {
  const trimmed = text.trim();
  // Fast path: the whole body is already JSON (some error responses are).
  if (trimmed.startsWith("{")) return JSON.parse(trimmed) as T;

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new TssError("Could not parse $batch response.", text.slice(0, 400));
  }
  const json = text.slice(start, end + 1);
  const parsed = JSON.parse(json) as T & { error?: unknown };
  if (parsed.error) {
    throw new TssError("TSS returned an OData error.", JSON.stringify(parsed.error));
  }
  return parsed;
}

export class TssError extends Error {
  constructor(
    message: string,
    public detail?: string,
  ) {
    super(message);
    this.name = "TssError";
  }
}

// ---- raw OData shapes ----

interface ODataCollection<T> {
  "@odata.count"?: string;
  value: T[];
}

interface RawModule {
  AcademicYear: string;
  AcademicPeriod: string;
  ModuleID: string;
  AcademicLevel: string;
  DepartmentAbbr: string;
  DepartmentText: string;
  CourseAbbr: string;
  CourseTitle: string;
  CreditsDisplay: string;
  incrementDisplay: string;
}

interface RawEvent {
  TeachingMethod: string;
  TeachingMethod_Text: string;
  InstructorName: string;
  InstructorEmail: string;
  Sched: string;
  EventPkgOtjid: string;
  EventPkgText: string;
  EventPkgLimit: string;
  EventPkgSeatsAvailable: string;
  EventPkgNumOnWaitl: number;
  EventPkgSemanticColorCapacity: number;
}
