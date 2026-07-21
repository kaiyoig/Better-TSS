import type { CourseSummary, Meeting, Section } from "../api/types";
import { courseKey } from "../model/planOps";
import type { Plan } from "../model/plan";
import { plannedSectionId } from "../model/plan";
import { meetingsOverlap } from "../model/schedule";
import type { AppContext } from "./context";
import { clear, h } from "./dom";
import { errorMessage } from "./util";

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

  function load(next: CourseSummary): void {
    course = next;
    sections = null;
    error = null;
    loading = true;
    render();
    const target = next;
    ctx.client
      .getSections(next)
      .then((secs) => {
        if (course !== target) return; // a different course was selected meanwhile
        sections = secs;
        loading = false;
        render();
      })
      .catch((err: unknown) => {
        if (course !== target) return;
        loading = false;
        error = errorMessage(err);
        render();
      });
  }

  function meetingLine(m: Meeting): HTMLElement {
    const bits: Array<Node | string> = [
      h("span", { class: "tsh-m-method", text: m.methodText || m.method }),
    ];
    if (m.isFinal) {
      bits.push(" ", h("span", { class: "tsh-m-final", text: "· Final exam" }));
      bits.push(" · " + m.raw);
    } else {
      const when = [m.days.join(""), [m.start, m.end].filter(Boolean).join("–")]
        .filter(Boolean)
        .join(" ");
      const extra = [when, m.mode, m.location, m.instructor].filter(Boolean).join(" · ");
      if (extra) bits.push(" · " + extra);
    }
    return h("div", { class: "tsh-m" }, bits);
  }

  function sectionCard(c: CourseSummary, sec: Section, plan: Plan | null): HTMLElement {
    const id = plannedSectionId(c, sec);
    const already = (plan?.sections ?? []).some((s) => s.id === id);

    // Which specific parts of other planned courses does this section clash with? Report the
    // exact part, e.g. "CSE-103 Discussion" — comparing meeting-by-meeting, skipping this course.
    const key = courseKey(c);
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
      class: "tsh-btn tsh-add",
      text: already ? "Added" : "Add to plan",
      disabled: !plan || already,
      title: plan ? undefined : "Create or select a plan first",
      onClick: () => {
        const planId = ctx.getActivePlanId();
        if (planId) void ctx.store.addSection(planId, c, sec);
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
    if (conflictParts.length > 0) {
      children.push(
        h("div", {
          class: "tsh-sec-conflict",
          text: `⚠ Time conflict with ${conflictParts.join(", ")}`,
        }),
      );
    }
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
