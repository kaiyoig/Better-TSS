import type { CourseSummary, LiveStatus, Meeting, Section } from "../api/types";
import { courseKey, isUnscheduled } from "../model/planOps";
import type { Plan } from "../model/plan";
import { plannedSectionId } from "../model/plan";
import { meetingsOverlap } from "../model/schedule";
import type { AppContext } from "./context";
import { clear, h } from "./dom";
import { errorMessage } from "./util";

// A calendar date (MM/DD/YYYY) marks a one-off event (exam), not a weekly meeting.
const DATED_RE = /\d{1,2}\/\d{1,2}\/\d{4}/;

/** Sentinel stored in the live-status cache when the booking service call failed for a section. */
const LIVE_ERROR = Symbol("live-error");
type LiveEntry = LiveStatus | typeof LIVE_ERROR;

/**
 * Format a registration-window boundary. OData v2 emits these as UTC-midnight date values, so we
 * render in UTC and only show a time when it isn't midnight (avoids a spurious timezone-shifted time).
 */
function fmtWindow(d: Date): string {
  const opts: Intl.DateTimeFormatOptions = { timeZone: "UTC", month: "short", day: "numeric" };
  if (d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0) {
    opts.hour = "numeric";
    opts.minute = "2-digit";
  }
  return d.toLocaleString(undefined, opts);
}

/** Section browser for a chosen course: seats, capacity, meetings, and an Add-to-plan action. */
export function createSections(ctx: AppContext): {
  el: HTMLElement;
  load: (course: CourseSummary) => void;
} {
  const el = h("section", { class: "tsh-section" }, [
    h("div", { class: "tsh-label", text: "Sections" }),
  ]);
  const body = h("div", { class: "tsh-sections" });
  el.append(body);

  let course: CourseSummary | null = null;
  let sections: Section[] | null = null;
  let loading = false;
  let error: string | null = null;
  // Live enrollment status per section, keyed by pkgObjid. Undefined = still loading; the LIVE_ERROR
  // sentinel = the booking-service call failed (we fall back silently to the catalog snapshot).
  const live = new Map<string, LiveEntry>();

  function load(next: CourseSummary): void {
    course = next;
    sections = null;
    error = null;
    loading = true;
    live.clear();
    render();
    const target = next;
    ctx.client
      .getSections(next)
      .then((secs) => {
        if (course !== target) return; // a different course was selected meanwhile
        sections = secs;
        loading = false;
        render();
        loadLive(target, secs);
      })
      .catch((err: unknown) => {
        if (course !== target) return;
        loading = false;
        error = errorMessage(err);
        render();
      });
  }

  // Progressive enhancement: sections render immediately from the catalog, then each section's live
  // status streams in from the booking service and patches its card. Failures fall back silently.
  function loadLive(target: CourseSummary, secs: Section[]): void {
    for (const sec of secs) {
      if (!sec.pkgObjid) continue;
      ctx.client
        .getLiveStatus(target, sec)
        .then((st) => {
          if (course !== target) return;
          live.set(sec.pkgObjid, st);
          render();
        })
        .catch(() => {
          if (course !== target) return;
          live.set(sec.pkgObjid, LIVE_ERROR);
          render();
        });
    }
  }

  // The live line: real-time open seats/waitlist plus the enrollment window the catalog can't show.
  function liveLine(sec: Section): HTMLElement | null {
    if (!sec.pkgObjid) return null;
    const entry = live.get(sec.pkgObjid);
    if (entry === undefined) {
      return h("div", { class: "tsh-live tsh-live-pending", text: "Checking live status…" });
    }
    if (entry === LIVE_ERROR) return null; // catalog seats already shown above

    const st = entry;
    const now = new Date();
    let windowText: string;
    let windowClass: string;
    if (st.registrationBegin && now < st.registrationBegin) {
      windowText = `Enrollment opens ${fmtWindow(st.registrationBegin)}`;
      windowClass = "tsh-live-soon";
    } else if (st.registrationEnd && now > st.registrationEnd) {
      windowText = "Enrollment closed";
      windowClass = "tsh-live-closed";
    } else {
      windowText = st.registrationEnd
        ? `Enrollment open · closes ${fmtWindow(st.registrationEnd)}`
        : "Enrollment open";
      windowClass = "tsh-live-open";
    }

    const seatText =
      `${st.openSeats} open` +
      (st.openSeatsWaitlist > 0 ? ` · WL ${st.openSeatsWaitlist} open` : "");
    const bits: HTMLElement[] = [
      h("span", { class: "tsh-live-seats", text: seatText }),
      h("span", { class: `tsh-live-window ${windowClass}`, text: windowText }),
    ];
    if (st.onWishList) bits.push(h("span", { class: "tsh-live-wish", text: "On TSS wishlist" }));
    return h("div", { class: "tsh-live" }, bits);
  }

  function meetingLine(m: Meeting): HTMLElement {
    // One-off dated events (final exams, midterms, …) aren't weekly meetings — their raw line is
    // self-describing ("Midterm Examination 10/20/2026 6:00 PM - 7:50 PM …"), so show it verbatim.
    if (m.isFinal || (m.days.length === 0 && DATED_RE.test(m.raw))) {
      return h("div", { class: "tsh-m tsh-m-exam", text: m.raw });
    }
    const bits: Array<Node | string> = [
      h("span", { class: "tsh-m-method", text: m.methodText || m.method }),
    ];
    const timeStr = [m.start, m.end].filter(Boolean).join("–");
    if (!timeStr && isUnscheduled(m)) {
      // No set time yet (e.g. an unscheduled lab). Say so explicitly, like TSS does.
      bits.push(" · ");
      bits.push(
        h("span", {
          class: "tsh-m-tba",
          text: m.days.length ? `${m.days.join("")} · Time TBA` : "Time TBA",
        }),
      );
      const rest = [m.mode, m.location, m.instructor].filter(Boolean).join(" · ");
      if (rest) bits.push(" · " + rest);
    } else {
      const when = [m.days.join(""), timeStr].filter(Boolean).join(" ");
      const extra = [when, m.mode, m.location, m.instructor].filter(Boolean).join(" · ");
      if (extra) bits.push(" · " + extra);
    }
    return h("div", { class: "tsh-m" }, bits);
  }

  function sectionCard(c: CourseSummary, sec: Section, plan: Plan | null): HTMLElement {
    const id = plannedSectionId(c, sec);
    const planned = plan?.sections ?? [];
    const already = planned.some((s) => s.id === id);
    const key = courseKey(c);
    // Only one section of a course may be planned at a time. If a *different* section of this same
    // course is already in the plan, block adding this one (drop the other first to switch).
    const otherOfCourse = already ? undefined : planned.find((s) => courseKey(s.course) === key);

    // Which specific parts of other planned courses does this section clash with? Report the
    // exact part, e.g. "CSE-103 Discussion" — comparing meeting-by-meeting, skipping this course.
    const conflictParts: string[] = [];
    const seen = new Set<string>();
    for (const ps of plan?.sections ?? []) {
      if (courseKey(ps.course) === key) continue;
      for (const pm of ps.section.meetings) {
        if (!sec.meetings.some((sm) => meetingsOverlap(sm, pm))) continue;
        const label = `${ps.course.abbr} ${pm.methodText || pm.method}`;
        if (!seen.has(label)) {
          seen.add(label);
          conflictParts.push(label);
        }
      }
    }

    const addBtn = h("button", {
      class: `tsh-btn ${otherOfCourse ? "tsh-switch" : "tsh-add"}`,
      text: already ? "Added" : otherOfCourse ? "Switch to this" : "Add to plan",
      disabled: !plan || already,
      title: !plan
        ? "Create or select a plan first"
        : otherOfCourse
          ? `Replace ${otherOfCourse.section.eventPkgText} with this section`
          : undefined,
      onClick: () => {
        const planId = ctx.getActivePlanId();
        if (!planId) return;
        if (otherOfCourse) {
          // Switch sections: drop the currently-planned one, then add this. Sequential so the
          // one-section-per-course guard in addSection sees the course already cleared.
          void (async () => {
            await ctx.store.removeSection(planId, otherOfCourse.id);
            await ctx.store.addSection(planId, c, sec);
          })();
        } else {
          void ctx.store.addSection(planId, c, sec);
        }
      },
    });

    const top: Array<Node | string> = [
      h("span", { class: `tsh-dot tsh-dot-${sec.capacity}`, title: `capacity: ${sec.capacity}` }),
      h("span", { class: "tsh-sec-name", text: sec.eventPkgText }),
      h("span", { class: "tsh-seats", text: `${sec.seatsAvailable}/${sec.limit} seats` }),
    ];
    if (sec.waitlist > 0) {
      top.push(h("span", { class: "tsh-wl", text: `WL ${sec.waitlist}` }));
    }
    top.push(addBtn);

    const children: HTMLElement[] = [h("div", { class: "tsh-sec-top" }, top)];
    if (otherOfCourse) {
      children.push(
        h("div", {
          class: "tsh-sec-note",
          text: `${otherOfCourse.section.eventPkgText} is currently planned for this course.`,
        }),
      );
    }
    if (conflictParts.length > 0) {
      children.push(
        h("div", {
          class: "tsh-sec-conflict",
          text: `⚠ Time conflict with ${conflictParts.join(", ")}`,
        }),
      );
    }
    const liveEl = liveLine(sec);
    if (liveEl) children.push(liveEl);
    children.push(h("div", { class: "tsh-meetings" }, sec.meetings.map(meetingLine)));

    const cls = `tsh-sec${already ? " tsh-sec-added" : ""}${
      conflictParts.length > 0 ? " tsh-sec-conflicted" : ""
    }`;
    return h("div", { class: cls }, children);
  }

  function render(): void {
    clear(body);
    if (!course) {
      body.append(h("div", { class: "tsh-empty", text: "Pick a course above to see its sections." }));
      return;
    }
    body.append(
      h("div", { class: "tsh-sec-head" }, [
        h("span", { class: "tsh-course-abbr", text: course.abbr }),
        h("span", { class: "tsh-course-title-sm", text: course.title }),
      ]),
    );
    if (loading) {
      body.append(h("div", { class: "tsh-status", text: "Loading sections…" }));
      return;
    }
    if (error) {
      body.append(h("div", { class: "tsh-error", text: error }));
      return;
    }
    if (!sections || sections.length === 0) {
      body.append(h("div", { class: "tsh-empty", text: "No sections found." }));
      return;
    }
    const plan = ctx.getActivePlan();
    for (const sec of sections) body.append(sectionCard(course, sec, plan));
  }

  // Re-render on plan changes so "Add"/"Added" state and active-plan availability stay in sync.
  ctx.subscribe((reason) => {
    if (reason === "plans") render();
  });

  render();
  return { el, load };
}
