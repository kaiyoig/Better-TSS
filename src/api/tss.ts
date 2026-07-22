import { parseSched } from "./sched";
import type {
  Booking,
  CapacityColor,
  CourseDetail,
  CourseSummary,
  LiveStatus,
  Meeting,
  Section,
  Term,
} from "./types";

const SAP_CLIENT = "500";
const SERVICE_ROOT =
  "https://tss.ucsd.edu/sap/opu/odata4/sap/yucsd_con_module_sb/srvd/sap/yucsd_con_module_servicedef/0001/";

// The booking/enrollment side is a *separate* OData **v2** service ("My Modules"). Reads (live
// seats + registration window) need no CSRF; the booking writes (`ActionHdrSet`) do — a token
// fetched from *this* service root, distinct from the catalog's (see bookcourse.har).
const MODULES_V2_ROOT = "https://tss.ucsd.edu/sap/opu/odata/ITUS/PR_MY_MODULES_V2_SRV/";

// The OVP "booked modules" card service: one row per live enrollment. Read-only, no CSRF,
// and (as captured) queried with no parameters at all — it's scoped to the session's student.
const BOOKED_MODULES_ROOT = "https://tss.ucsd.edu/sap/opu/odata/ited/BC_OVP_BOOKED_MODULES_SRV/";

const ZERO_GUID = "00000000-0000-0000-0000-000000000000";

/**
 * Headers the Fiori UI sends on every XHR to the catalog service (tss.ucsd.edu.4.har). TSS began
 * 403-ing requests without the UI's shape when the registration window opened (2026-07-22), so we
 * mirror them. `sap-passport` is SAP's performance-tracing header — a constant captured value is
 * accepted; it only labels the traced component.
 */
const UI_XHR_HEADERS: Record<string, string> = {
  "X-Requested-With": "XMLHttpRequest",
  "x-xhr-logon": 'accept="iframe,strict-window,window"',
  "sap-passport":
    "2A54482A0300E600006F6D65722E7363686564756C652E736F632E7975637364736F6340302E302E3100005341505F4532455F54415F5573657220202020202020202020202020202020204D4F44554C453A3A4C696E654974656D2D696E6E65725461626C655F6974656D50726573735F313600056F6D65722E7363686564756C652E736F632E7975637364736F6340302E302E31333245344341383835324546343839433843423741444537413335383936343820202000079CE18FA9DDDA44EE862EEDC4619D49280000000000000000000000000000000000000000000000E22A54482A",
};

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

/** `fetch`-shaped function; lets the content script route requests through the page's JS world. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Thin client over the UCSD Schedule-of-Classes OData v4 service. All calls run against the
 * user's live TSS session (`credentials: "include"`); the extension never handles credentials.
 * See RECON.md for the endpoint map this is built from.
 */
interface CsrfProbe {
  token: string | null;
  sso: boolean;
  note: string;
}

type CsrfProbeSpec = [string, "HEAD" | "GET", Record<string, string>];

export class TssClient {
  private csrfToken: string | null = null;
  /** CSRF token for the v2 booking service — a separate security context from the catalog's. */
  private csrfTokenV2: string | null = null;
  /**
   * The student's own program identity (`ScObjid` + college group), learned opportunistically
   * from booked-modules rows and header reads. Used for the student-keyed `ModuleHeaderSet`
   * fallback when the program-agnostic key stops resolving (observed live: after repeated
   * drop→rebook cycles on one section the `ScObjid='00000000'` read starts 404ing).
   */
  private program: { scObjid: string; assignedCg: string; assignedCgTop: string } | null = null;

  private noteProgram(scObjid?: string, cg?: string, cgTop?: string): void {
    if (!scObjid || scObjid === "00000000") return;
    this.program = {
      scObjid,
      assignedCg: cg && cg !== "00000000" ? cg : (this.program?.assignedCg ?? ""),
      assignedCgTop: cgTop && cgTop !== "00000000" ? cgTop : (this.program?.assignedCgTop ?? ""),
    };
  }

  constructor(
    private readonly doFetch: FetchLike = (url, init) => fetch(url, init),
    /** Optional one-line description of the transport (e.g. bridge status) for error reports. */
    private readonly describeTransport?: () => Promise<string>,
  ) {}

  /** One token-fetch attempt against `url` with the SAP `X-CSRF-Token: Fetch` handshake. */
  private async csrfProbe(
    url: string,
    method: "HEAD" | "GET",
    headers: Record<string, string>,
  ): Promise<CsrfProbe> {
    const res = await this.doFetch(url, {
      method,
      credentials: "include",
      headers: { "X-CSRF-Token": "Fetch", ...UI_XHR_HEADERS, ...headers },
    });
    const token = res.headers.get("x-csrf-token");
    const body = token ? "" : await safeText(res);
    const sso = !token && looksLikeSsoRedirect(res, body);
    const path = url.slice(url.lastIndexOf("/", url.indexOf("?"))).slice(0, 40);
    const snippet = token
      ? ""
      : ` «${body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)}»`;
    const note =
      `${method} …${path} → ${res.status} ${res.headers.get("content-type") ?? "?"}` +
      (sso ? " (SSO login redirect)" : token ? " (token OK)" : snippet);
    return { token, sso, note };
  }

  /**
   * The token endpoints the live UI is seen using (tss.ucsd.edu.4.har): HEAD on the service root
   * (its 403-recovery path, wildcard Accept), and a plain entity GET (its startup path, OData v4
   * headers). The root as a *GET* is access-restricted — do not "simplify" these probes to one
   * GET of the root. Headers mirror the UI's own requests: TSS started rejecting non-UI-shaped
   * requests around 2026-07-22 (when the registration window opened).
   */
  private v4CsrfProbes(): CsrfProbeSpec[] {
    return [
      [`${SERVICE_ROOT}?sap-client=${SAP_CLIENT}`, "HEAD", { Accept: "*/*" }],
      [
        `${SERVICE_ROOT}YUCSD_I_PERYRT_SOC?sap-client=${SAP_CLIENT}&$skip=0&$top=1`,
        "GET",
        {
          Accept: "application/json;odata.metadata=minimal;IEEE754Compatible=true",
          "Content-Type": "application/json;charset=UTF-8;IEEE754Compatible=true",
          "odata-version": "4.0",
          "odata-maxversion": "4.0",
        },
      ],
    ];
  }

  /** Probes for the v2 booking service. HEAD on the root is its standard v2 token endpoint. */
  private v2CsrfProbes(): CsrfProbeSpec[] {
    return [
      [`${MODULES_V2_ROOT}?sap-client=${SAP_CLIENT}`, "HEAD", { Accept: "*/*" }],
      [`${MODULES_V2_ROOT}?sap-client=${SAP_CLIENT}`, "GET", { Accept: "application/json" }],
    ];
  }

  /** Try each probe in order until one yields a token; collect notes for error reporting. */
  private async csrfAttempts(probes: CsrfProbeSpec[]): Promise<CsrfProbe[]> {
    const results: CsrfProbe[] = [];
    for (const [url, method, headers] of probes) {
      try {
        const p = await this.csrfProbe(url, method, headers);
        results.push(p);
        if (p.token) break;
      } catch (e) {
        results.push({ token: null, sso: false, note: `${method} failed: ${String(e)}` });
      }
    }
    return results;
  }

  /** Acquire a CSRF token via `probes`, transparently re-running SSO in an iframe if intercepted. */
  private async acquireCsrf(probes: CsrfProbeSpec[]): Promise<string> {
    let results = await this.csrfAttempts(probes);
    let hit = results.find((p) => p.token);

    // An SSO login-redirect page means the SAP backend session is gone even though the Fiori tab
    // looks logged in. A hidden same-origin iframe can run that redirect dance to completion
    // (the IdP session usually still lives), after which we retry once.
    if (!hit && results.some((p) => p.sso)) {
      if (await refreshSessionViaIframe(this.doFetch)) {
        results = await this.csrfAttempts(probes);
        hit = results.find((p) => p.token);
      }
    }

    if (!hit) {
      const transport = (await this.describeTransport?.().catch(() => null)) ?? "direct fetch";
      const detail = `${results.map((p) => p.note).join("; ")}; transport: ${transport}`;
      throw new TssError(
        results.some((p) => p.sso)
          ? `TSS sign-on session could not be refreshed automatically. Reload the TSS page (F5), ` +
            `then reopen the planner. [${detail}]`
          : `TSS did not return a CSRF token. Reload the TSS page (F5) and retry. [${detail}]`,
        detail,
      );
    }
    return hit.token as string;
  }

  private async ensureCsrf(): Promise<string> {
    if (!this.csrfToken) this.csrfToken = await this.acquireCsrf(this.v4CsrfProbes());
    return this.csrfToken;
  }

  private async ensureCsrfV2(): Promise<string> {
    if (!this.csrfTokenV2) this.csrfTokenV2 = await this.acquireCsrf(this.v2CsrfProbes());
    return this.csrfTokenV2;
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

      const res = await this.doFetch(`${SERVICE_ROOT}$batch?sap-client=${SAP_CLIENT}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "X-CSRF-Token": token,
          "Content-Type": `multipart/mixed;boundary=${boundary}`,
          Accept: "multipart/mixed",
          ...UI_XHR_HEADERS,
        },
        body,
      });

      const text = await res.text();
      if (attempt === 0 && looksLikeSsoRedirect(res, text)) {
        // Session died mid-flight: the "response" is the SSO redirect page. Re-auth and retry.
        this.csrfToken = null;
        await refreshSessionViaIframe(this.doFetch);
        continue;
      }
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

  /** A credentialed JSON GET against the v2 booking service, with session-expiry detection. */
  private async v2Get<T>(url: string, what: string): Promise<T> {
    const res = await this.doFetch(url, {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
        dataserviceversion: "2.0",
        maxdataserviceversion: "2.0",
        ...UI_XHR_HEADERS,
      },
    });
    if (!res.ok) {
      const body = await safeText(res);
      // Keep the exact failing URL in the console — v2 key-resolution failures (404s) are
      // impossible to diagnose from the short user-facing message alone.
      console.warn(`[Better TSS] ${what} request failed (${res.status})`, url, body);
      throw new TssError(`${what} request failed (${res.status})`, `${url} → ${body}`, res.status);
    }
    if ((res.headers.get("content-type") ?? "").includes("text/html")) {
      throw new TssError("TSS session expired — reload the TSS page and retry.");
    }
    return (await res.json()) as T;
  }

  /**
   * The program-agnostic `ModuleHeaderSet` key for a section (`ScObjid='00000000'` + zeros guid).
   * Despite the zeros, the response is student-aware: it echoes back the real program (`ScObjid`),
   * college group, grading template, and — once enrolled — the real `ModregId` + "Booked" status.
   * The live UI sends the *unpadded* id forms (bookcourse.har); `padded` builds the canonical
   * zero-padded form the server's own `__metadata` echoes, used as a retry when unpadded 404s.
   */
  private moduleHeaderUrl(
    course: CourseRef,
    section: Pick<Section, "pkgObjid">,
    padded = false,
    scObjid = "00000000",
  ): string {
    const mod = padded ? pad(course.moduleID, 8) : trimZeros(course.moduleID);
    const pkg = padded ? pad(section.pkgObjid, 8) : trimZeros(section.pkgObjid);
    const ses = padded ? pad(course.period, 3) : trimZeros(course.period);
    const key =
      `SmObjid='${mod}',SmOtype='SM',ScObjid='${scObjid}',` +
      `ModregId=guid'${ZERO_GUID}',` +
      `EventPackageId='${pkg}',AcademicYear='${course.year}',` +
      `AcademicSession='${ses}'`;
    return `${MODULES_V2_ROOT}ModuleHeaderSet(${key})`;
  }

  /**
   * GET `ModuleHeaderSet(<key>)<nav>?…<query>`, walking through every key form the live UI is
   * seen using until one resolves: program-agnostic (`ScObjid='00000000'`) unpadded then padded
   * (SAP conversion exits resolve unpadded keys inconsistently), then the student-keyed form
   * when the program is known.
   *
   * IMPORTANT (learned live, tss.ucsd.edu.4.har): callers must pass an `$expand` in `query`.
   * The Fiori UI never issues a *bare* entity GET on this set, and once the student has a
   * cancelled registration row for a section the bare read starts 404ing
   * (`Resource not found for segment 'ModuleHeader'`) while the $expand form — a different
   * Gateway handler (GET_EXPANDED_ENTITY) — keeps returning 200 for the very same key.
   */
  private async readModuleEntity<T>(
    course: CourseRef,
    section: Pick<Section, "pkgObjid">,
    nav: string,
    query: string,
    what: string,
  ): Promise<T> {
    if (!section.pkgObjid) {
      throw new TssError("Section is missing its EventPackage ID — cannot query booking service.");
    }
    const keyUrls = [
      this.moduleHeaderUrl(course, section),
      this.moduleHeaderUrl(course, section, true),
    ];
    if (this.program) {
      keyUrls.push(
        this.moduleHeaderUrl(course, section, false, this.program.scObjid),
        this.moduleHeaderUrl(course, section, true, this.program.scObjid),
      );
    }
    let last404: TssError | null = null;
    for (const base of keyUrls) {
      try {
        return await this.v2Get<T>(`${base}${nav}?sap-client=${SAP_CLIENT}${query}`, what);
      } catch (err) {
        if (!(err instanceof TssError) || err.status !== 404) throw err;
        last404 = err;
      }
    }
    throw new TssError(
      `TSS's booking service has no record of this section (404). Registration may not be ` +
        `open for this term yet — check the section's live status in the sections browser.`,
      last404?.detail,
      404,
    );
  }

  private async readModuleHeader(
    course: CourseRef,
    section: Pick<Section, "pkgObjid">,
  ): Promise<RawModuleHeader> {
    const json = await this.readModuleEntity<{ d?: RawModuleHeader }>(
      course,
      section,
      "",
      // The UI's own pre-book read (a bare read would 404 post-cancel — see readModuleEntity).
      "&$expand=BookingCheckLog,CreditOptions",
      "Live status",
    );
    if (!json.d) throw new TssError("Live status response had no data.");
    this.noteProgram(json.d.ScObjid, json.d.AssignedCg, json.d.AssignedCgTop);
    return json.d;
  }

  /**
   * Live enrollment status for one section, from the v2 booking service. A plain credentialed GET
   * of the `ModuleHeaderSet` entity keyed by the section's EventPackage (a program-agnostic
   * `ScObjid='00000000'` + all-zeros `ModregId` gives the read-only view).
   */
  async getLiveStatus(
    course: CourseRef,
    section: Pick<Section, "pkgObjid">,
  ): Promise<LiveStatus> {
    return mapLiveStatus(await this.readModuleHeader(course, section));
  }

  /** The section's individual events (lecture/discussion/…) — booking payloads need their IDs. */
  private async readSectionEvents(
    course: CourseRef,
    section: Pick<Section, "pkgObjid">,
  ): Promise<RawBookingEvent[]> {
    let json: { d?: { results?: RawBookingEvent[] } };
    try {
      json = await this.readModuleEntity<{ d?: { results?: RawBookingEvent[] } }>(
        course,
        section,
        "/Event",
        // Mirror the UI's exact event read (see readModuleEntity on why $expand is load-bearing).
        "&$expand=BookingCheckLog,Request,EventSchedule,CreditOptions",
        "Section events",
      );
    } catch (err) {
      if (!(err instanceof TssError) || err.status !== 404) throw err;
      // Independent fallback path: the same events hang off EventPackageSet (whose key form —
      // padded AcademicSession, no ScObjid/ModregId — resolves separately from ModuleHeaderSet).
      const key =
        `EventPackageId='${trimZeros(section.pkgObjid)}',SmObjid='${trimZeros(course.moduleID)}',` +
        `AcademicYear='${course.year}',AcademicSession='${pad(course.period, 3)}'`;
      json = await this.v2Get<{ d?: { results?: RawBookingEvent[] } }>(
        `${MODULES_V2_ROOT}EventPackageSet(${key})/Events?sap-client=${SAP_CLIENT}`,
        "Section events (package)",
      );
    }
    const events = json.d?.results ?? [];
    if (events.length === 0) {
      throw new TssError("TSS returned no events for this section — cannot build booking request.");
    }
    return events;
  }

  /**
   * One `ActionHdrSet` POST — the booking write op (bookcourse.har). Book is `CheckRegistration`
   * followed by `SaveChanges`; Drop is a single `CancelBooking`. Plain JSON (not an OData
   * changeset), v2 CSRF token required, HTTP 201 on acceptance; rejection comes back in-band as
   * `MessageType`/`Message` on the entity.
   */
  private async postBookingAction(
    action: "CheckRegistration" | "SaveChanges" | "CancelBooking",
    course: CourseRef,
    section: Pick<Section, "pkgObjid">,
    hdr: RawModuleHeader,
    events: RawBookingEvent[],
  ): Promise<RawActionResult> {
    const session = pad(course.period, 3);
    const moduleId = pad(course.moduleID, 8);
    // The captured UI sends AssignedCgTop = the real top group when known, else mirrors AssignedCg
    // (the pre-booking header read reports AssignedCgTop as all zeros).
    const cgTop =
      hdr.AssignedCgTop && hdr.AssignedCgTop !== "00000000" ? hdr.AssignedCgTop : hdr.AssignedCg;
    const body = {
      ModuleId: moduleId,
      ActionName: action,
      ProgramId: hdr.ScObjid,
      Items: events.map((ev) => ({
        EventId: ev.EventId,
        ModuleId: moduleId,
        AcademicYear: course.year,
        AcademicSession: session,
        EventPackId: section.pkgObjid,
      })),
      AssignedCg: hdr.AssignedCg,
      AssignedCgTop: cgTop,
      TemplateId: hdr.TemplateId,
      EventPackId: section.pkgObjid,
      ModregId: ZERO_GUID,
      AcademicYear: course.year,
      AcademicSession: session,
      Credits: hdr.Credits,
      CreditUnit: hdr.CreditUnit,
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.ensureCsrfV2();
      const res = await this.doFetch(`${MODULES_V2_ROOT}ActionHdrSet?sap-client=${SAP_CLIENT}`, {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-CSRF-Token": token,
          dataserviceversion: "2.0",
          maxdataserviceversion: "2.0",
          ...UI_XHR_HEADERS,
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (attempt === 0 && (isCsrfFailure(res.status, text) || looksLikeSsoRedirect(res, text))) {
        this.csrfTokenV2 = null;
        if (looksLikeSsoRedirect(res, text)) await refreshSessionViaIframe(this.doFetch);
        continue;
      }
      if (!res.ok) {
        console.warn(`[Better TSS] ${actionLabel(action)} POST failed (${res.status})`, text.slice(0, 400));
        throw new TssError(
          `TSS rejected the ${actionLabel(action)} request (${res.status}).`,
          text.slice(0, 400),
          res.status,
        );
      }
      const parsed = JSON.parse(text) as { d?: RawActionResult };
      if (!parsed.d) throw new TssError(`Empty response to ${actionLabel(action)}.`, text.slice(0, 400));
      // The server signals business-rule failures (prereqs, holds, time conflicts…) in-band.
      if (parsed.d.MessageType === "E" || parsed.d.MessageType === "A") {
        throw new TssError(
          parsed.d.Message || `TSS refused the ${actionLabel(action)} (no reason given).`,
        );
      }
      return parsed.d;
    }
    throw new TssError(`${actionLabel(action)} failed after CSRF retry.`);
  }

  /**
   * Book a section: registration check, then save. Returns the new booking guid. This performs a
   * REAL enrollment against the student's record — callers must confirm with the user first.
   */
  async bookSection(course: CourseRef, section: Pick<Section, "pkgObjid">): Promise<string> {
    const hdr = await this.readModuleHeader(course, section);
    if (isBookedHeader(hdr)) {
      throw new TssError("You are already enrolled in this section.");
    }
    const events = await this.readSectionEvents(course, section);
    await this.postBookingAction("CheckRegistration", course, section, hdr, events);
    const saved = await this.postBookingAction("SaveChanges", course, section, hdr, events);
    if (!saved.ModregId || saved.ModregId === ZERO_GUID) {
      throw new TssError(
        "TSS accepted the request but returned no booking ID — check My Modules before retrying.",
        saved.Message,
      );
    }
    return saved.ModregId;
  }

  /**
   * Drop (cancel) an enrollment in `section`. A single `CancelBooking` action — the capture shows
   * it sent with the zeros guid, same body as Book. REAL deregistration; confirm with the user.
   */
  async dropSection(course: CourseRef, section: Pick<Section, "pkgObjid">): Promise<void> {
    const hdr = await this.readModuleHeader(course, section);
    const events = await this.readSectionEvents(course, section);
    await this.postBookingAction("CancelBooking", course, section, hdr, events);
  }

  /** All live enrollments for the signed-in student (the OVP "booked modules" card's data). */
  async listBookings(): Promise<Booking[]> {
    const json = await this.v2Get<{ d?: { results?: RawBookedModule[] } }>(
      `${BOOKED_MODULES_ROOT}ModuleSet`,
      "Booked modules",
    );
    const rows = json.d?.results ?? [];
    // Every row names the student's own program + college group — remember them for the
    // student-keyed ModuleHeaderSet fallback.
    for (const r of rows) this.noteProgram(r.ScObjid, r.AssignedCg, r.AssignedCgTop);
    return rows.map(mapBooking);
  }

  /**
   * Find which catalog section a booking refers to. The booked-modules row only carries the
   * module, so we sweep the course's sections and probe each one's live status until the header
   * echoes this booking's guid (or reports "booked" when the guid is absent).
   */
  async locateBookedSection(
    booking: Booking,
  ): Promise<{ course: CourseRef; section: Section }> {
    const course: CourseRef = {
      year: booking.year,
      period: booking.period,
      moduleID: booking.moduleID,
    };
    const sections = await this.getSections(course);
    const candidates = sections.filter((s) => s.pkgObjid);
    const probes = await Promise.allSettled(
      candidates.map((s) => this.readModuleHeader(course, s)),
    );
    let bookedFallback: Section | null = null;
    for (let i = 0; i < candidates.length; i++) {
      const p = probes[i];
      if (p.status !== "fulfilled") continue;
      if (p.value.ModregId === booking.modregId) return { course, section: candidates[i] };
      if (bookedFallback === null && isBookedHeader(p.value)) bookedFallback = candidates[i];
    }
    if (bookedFallback) return { course, section: bookedFallback };
    throw new TssError(
      `Could not match the ${booking.abbr} booking to a section — drop it from TSS's My Modules page.`,
    );
  }
}

/** A course key as the booking service needs it: term + module. */
type CourseRef = Pick<CourseSummary, "year" | "period" | "moduleID">;

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
      pkgObjid: head.EventPkgObjid ?? "",
      limit: toInt(head.EventPkgLimit),
      seatsAvailable: toInt(head.EventPkgSeatsAvailable),
      waitlist: toInt(head.EventPkgNumOnWaitl),
      capacity: capacityColor(head.EventPkgSemanticColorCapacity),
      meetings,
    });
  }
  return sections;
}

function mapLiveStatus(d: RawModuleHeader): LiveStatus {
  return {
    openSeats: toInt(d.OpenSeats),
    openSeatsWaitlist: toInt(d.OpenSeatsWaitlist),
    statusText: d.SmStatusText ?? "",
    waitlistBooking: d.WaitlistBooking === true,
    onWishList: d.OnWishList === true,
    registrationBegin: parseSapDate(d.RegistrationBeginDate),
    registrationEnd: parseSapDate(d.RegistrationEndDate),
    booked: isBookedHeader(d),
    modregId: d.ModregId && d.ModregId !== ZERO_GUID ? d.ModregId : null,
  };
}

/** Enrolled = the header carries a real booking guid (SmStatus "01"/"Booked" accompanies it). */
function isBookedHeader(d: RawModuleHeader): boolean {
  return (d.ModregId != null && d.ModregId !== ZERO_GUID) || d.SmStatus === "01";
}

function mapBooking(r: RawBookedModule): Booking {
  return {
    modregId: r.ModregId,
    moduleID: trimZeros(r.SmObjid),
    year: r.AcademicYear,
    period: trimZeros(r.AcademicSession),
    abbr: r.SmShort,
    title: r.SmStext,
    units: r.Credits,
    termText: [r.AcademicSessionText, r.AcademicYearText].filter(Boolean).join(" "),
    conditional: r.ConditionalBooking === true,
  };
}

function actionLabel(action: string): string {
  return action === "CancelBooking" ? "drop" : "booking";
}

/** SAP zero-pads numeric IDs per context ("8366" ↔ "00008366", "2" ↔ "002"). */
function pad(v: string, len: number): string {
  return v.padStart(len, "0");
}

function trimZeros(v: string): string {
  return v.replace(/^0+(?=.)/, "");
}

/** OData v2 serializes dates as `/Date(<epoch-ms>)/`. Returns null for missing/unparseable input. */
function parseSapDate(v: string | undefined): Date | null {
  const m = /\/Date\((\d+)\)\//.exec(v ?? "");
  return m ? new Date(Number(m[1])) : null;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 400);
  } catch {
    return "";
  }
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

// ---- session / SSO handling ----

/**
 * When the SAP backend session is gone, requests get a `200 text/html` SAML redirect page
 * (an auto-submitting form to the campus IdP) instead of an OData response. Requires actual
 * SAML markers when a body is present — TSS also serves *other* HTML error pages (e.g. the
 * access-denied page on a GET of the v4 service root) that must not be mistaken for SSO.
 */
function looksLikeSsoRedirect(res: Response, body: string): boolean {
  const html = (res.headers.get("content-type") ?? "").includes("text/html");
  if (/SAMLRequest|\/idp\/profile\/SAML|saml2/i.test(body.slice(0, 4000))) return true;
  return html && body.length === 0; // HEAD responses carry no body to inspect
}

/**
 * Re-run single sign-on in a hidden same-origin iframe. Loading the service root as a *document*
 * lets the SAML redirect dance execute (auto-submit to the IdP, assertion POST back, SAP session
 * cookies set) — the "iframe" mode of SAP's XHR-Logon protocol. Resolves true once a follow-up
 * token probe succeeds, false on timeout (~15s) or if no DOM is available.
 */
async function refreshSessionViaIframe(doFetch: FetchLike): Promise<boolean> {
  if (typeof document === "undefined" || !document.body) return false;

  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.src = `${SERVICE_ROOT}?sap-client=${SAP_CLIENT}`;
  document.body.appendChild(iframe);

  const probe = async (): Promise<boolean> => {
    try {
      const res = await doFetch(`${SERVICE_ROOT}?sap-client=${SAP_CLIENT}`, {
        method: "HEAD",
        credentials: "include",
        headers: { "X-CSRF-Token": "Fetch", Accept: "*/*", ...UI_XHR_HEADERS },
      });
      return res.headers.get("x-csrf-token") !== null;
    } catch {
      return false;
    }
  };

  try {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1_000));
      if (await probe()) return true;
    }
    return false;
  } finally {
    iframe.remove();
  }
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
    /** HTTP status when the failure was an HTTP-level rejection (e.g. 404 key resolution). */
    public status?: number,
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
  EventPkgObjid: string;
  EventPkgText: string;
  EventPkgLimit: string;
  EventPkgSeatsAvailable: string;
  EventPkgNumOnWaitl: number;
  EventPkgSemanticColorCapacity: number;
}

/**
 * Subset of the v2 `ModuleHeader` entity we read (see RECON.md). Beyond live status, the
 * program-agnostic read also reports the student's own program/college-group/template — the
 * exact fields the `ActionHdrSet` booking payload requires.
 */
interface RawModuleHeader {
  OpenSeats?: number | string;
  OpenSeatsWaitlist?: number | string;
  SmStatus?: string; // "00" not booked · "01" booked
  SmStatusText?: string;
  WaitlistBooking?: boolean;
  OnWishList?: boolean;
  RegistrationBeginDate?: string;
  RegistrationEndDate?: string;
  ModregId?: string; // real guid once booked, zeros otherwise
  ScObjid?: string; // the student's program ID ("ProgramId" in booking payloads)
  AssignedCg?: string;
  AssignedCgTop?: string;
  TemplateId?: string; // grading template, e.g. "0001" = Letter Grade
  Credits?: string;
  CreditUnit?: string;
}

/** One event row from `ModuleHeaderSet(...)/Event` — we only consume the ID for booking Items. */
interface RawBookingEvent {
  EventId: string; // zero-padded, e.g. "00001988"
  Method?: string;
  MethodText?: string;
}

/** The `ActionHdrSet` POST response entity (same shape echoed for all three actions). */
interface RawActionResult {
  ActionName?: string;
  ModregId?: string; // the real booking guid after SaveChanges
  MessageType?: string; // "" ok · "E"/"A" refusal · "W" warning
  Message?: string;
}

/** One row of `BC_OVP_BOOKED_MODULES_SRV/ModuleSet` — a live enrollment. */
interface RawBookedModule {
  ModregId: string;
  SmObjid: string;
  SmShort: string;
  SmStext: string;
  Credits: string;
  CreditUnit?: string;
  AcademicYear: string;
  AcademicSession: string;
  AcademicYearText?: string;
  AcademicSessionText?: string;
  ScObjid?: string;
  AssignedCg?: string;
  AssignedCgTop?: string;
  ConditionalBooking?: boolean;
}
