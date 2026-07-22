import type { Meeting } from "../api/types";
import type { PlannedSection } from "../model/plan";
import { plannedSectionId } from "../model/plan";
import type { Day } from "../model/schedule";
import { DAY_ORDER, meetingBlocks, sectionBlocks, totalUnits } from "../model/schedule";
import {
  courseKey,
  datedExams,
  dropCourse,
  examConflicts,
  groupByCourse,
  isUnscheduled,
} from "../model/planOps";
import { createBookingRunner } from "./bookingOps";
import { conflictListEl } from "./conflicts";
import type { AppContext, ResolvedBooking } from "./context";
import { clear, h } from "./dom";
import { confirmDrop } from "./util";

/** A weekly meeting occurrence placed on the grid, with lane info for side-by-side overlaps. */
interface EvBlock {
  day: Day;
  start: number;
  end: number;
  ps: PlannedSection;
  m: Meeting;
  conflicted: boolean;
  lane: number;
  lanes: number;
  /** The student is enrolled in this section in TSS (its Drop is a real TSS drop). */
  booked: boolean;
}

/**
 * Assign each block a lane index + total lane count within its overlap cluster, so overlapping
 * blocks render side by side (like Google Calendar) instead of stacking on top of each other.
 */
function assignLanes(blocks: EvBlock[]): void {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || a.end - b.end);
  let cluster: EvBlock[] = [];
  let clusterEnd = -1;
  const flush = (): void => {
    const laneEnds: number[] = [];
    for (const b of cluster) {
      let lane = -1;
      for (let k = 0; k < laneEnds.length; k++) {
        if (laneEnds[k] <= b.start) {
          lane = k;
          break;
        }
      }
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(b.end);
      } else {
        laneEnds[lane] = b.end;
      }
      b.lane = lane;
    }
    for (const b of cluster) b.lanes = laneEnds.length;
    cluster = [];
  };
  for (const b of sorted) {
    if (cluster.length > 0 && b.start >= clusterEnd) {
      flush();
      clusterEnd = -1;
    }
    cluster.push(b);
    clusterEnd = Math.max(clusterEnd, b.end);
  }
  if (cluster.length > 0) flush();
}

const START_MIN = 8 * 60; // 8:00 AM
const END_MIN = 22 * 60; // 10:00 PM
const PX_PER_MIN = 96 / 60; // one hour ≈ 96px — a 50-min block fits all detail lines + Drop
const BODY_HEIGHT = (END_MIN - START_MIN) * PX_PER_MIN;

const BASE_DAYS = new Set<Day>(["M", "Tu", "W", "Th", "F"]);
const DAY_LABEL: Record<Day, string> = {
  Su: "Sun",
  M: "Mon",
  Tu: "Tue",
  W: "Wed",
  Th: "Thu",
  F: "Fri",
  Sa: "Sat",
};

// Block colors encode state, not identity: planned-only courses are blue, live TSS enrollments
// are green (matching the ✓ badges elsewhere).
const PLANNED_COLOR = "#bfdbfe";
const ENROLLED_COLOR = "#bbf7d0";

function fmtMinutes(min: number): string {
  const h24 = Math.floor(min / 60);
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}${suffix}`;
}

/** Weekly grid of planned sections + a total-units readout, a conflict flag, and a remove list. */
export function createCalendar(ctx: AppContext): { el: HTMLElement } {
  const el = h("section", { class: "tsh-section" }, [
    h("div", { class: "tsh-label", text: "Weekly schedule" }),
  ]);
  const wrap = h("div", { class: "tsh-cal-wrap" });
  el.append(wrap);

  const booking = createBookingRunner(ctx, () => render());

  function render(): void {
    clear(wrap);
    const plan = ctx.getActivePlan();
    const planned = plan?.sections ?? [];

    // Live enrollments overlay. Booked sections render on the grid alongside planned ones —
    // merged (✓ styling) when the same section is planned, as extra blocks when it isn't.
    const enrollments = ctx.getBookings();
    const bookedByCourse = new Map<string, ResolvedBooking>();
    const bookedIds = new Set<string>();
    const bookedExtras: PlannedSection[] = [];
    for (const rb of enrollments) {
      bookedByCourse.set(courseKey(rb.course), rb);
      if (!rb.section) continue;
      const id = plannedSectionId(rb.course, rb.section);
      bookedIds.add(id);
      if (!planned.some((ps) => ps.id === id)) {
        bookedExtras.push({ id, course: rb.course, section: rb.section, addedAt: 0 });
      }
    }
    const gridSections = [...planned, ...bookedExtras];

    // Total units over unique courses (a course's LE + DI count once).
    const uniqueCourses = new Map<string, { units: string }>();
    for (const ps of planned) {
      const key = `${ps.course.year}-${ps.course.period}-${ps.course.moduleID}`;
      if (!uniqueCourses.has(key)) uniqueCourses.set(key, { units: ps.course.units });
    }
    const units = totalUnits([...uniqueCourses.values()]);

    const header = h("div", { class: "tsh-cal-header" }, [
      h("span", { class: "tsh-cal-title", text: plan ? plan.name : "No active plan" }),
      h("span", { class: "tsh-cal-units", text: `${units} units · ${planned.length} section(s)` }),
    ]);
    wrap.append(header);

    // Consolidated conflict list (weekly-vs-weekly and exam-vs-weekly), shown up top.
    const conflictList = conflictListEl(planned);
    if (conflictList) wrap.append(conflictList);

    // Dated exams (midterms, etc.) don't belong on the weekly grid — surface them as notes above
    // it, flagging any that collide with an existing weekly class on the same weekday/time.
    const exams = datedExams(planned);
    if (exams.length > 0) {
      const notes = h("div", { class: "tsh-cal-notes" }, [
        h("div", { class: "tsh-cal-notes-title", text: "Exams (not on grid)" }),
      ]);
      for (const { course, exam } of exams) {
        const clashes = examConflicts(exam, planned, courseKey(course));
        const row = h("div", {
          class: `tsh-cal-note${clashes.length > 0 ? " tsh-cal-note-conflict" : ""}`,
        }, [
          h("span", { class: "tsh-cal-note-abbr", text: course.abbr }),
          ` ${exam.meeting.raw}`,
        ]);
        if (clashes.length > 0) {
          row.append(
            h("div", {
              class: "tsh-cal-note-warn",
              text: `⚠ Time conflict with ${clashes.join(", ")}`,
            }),
          );
        }
        notes.append(row);
      }
      wrap.append(notes);
    }

    // Weekly parts with no set time yet (e.g. an unscheduled lab) can't be placed on the grid.
    // Surface them as a note so they aren't silently missing, mirroring how TSS shows "TBA".
    const tbaItems: Array<{ abbr: string; m: Meeting }> = [];
    for (const ps of planned) {
      for (const m of ps.section.meetings) {
        if (isUnscheduled(m)) tbaItems.push({ abbr: ps.course.abbr, m });
      }
    }
    if (tbaItems.length > 0) {
      const notes = h("div", { class: "tsh-cal-notes" }, [
        h("div", { class: "tsh-cal-notes-title", text: "Not yet scheduled (TBA)" }),
      ]);
      for (const { abbr, m } of tbaItems) {
        const detail = [m.methodText || m.method, "Time TBA", m.location].filter(Boolean).join(" · ");
        notes.append(
          h("div", { class: "tsh-cal-note" }, [
            h("span", { class: "tsh-cal-note-abbr", text: abbr }),
            ` ${detail}`,
          ]),
        );
      }
      wrap.append(notes);
    }

    // Which day columns to show: Mon–Fri always, plus any weekend day with a block.
    const present = new Set<Day>();
    for (const ps of gridSections) for (const b of sectionBlocks(ps.section)) present.add(b.day);
    const days = DAY_ORDER.filter((d) => BASE_DAYS.has(d) || present.has(d));

    // Header row.
    const daysRow = h("div", { class: "tsh-cal-daysrow" }, [
      h("div", { class: "tsh-cal-gutter-head" }),
    ]);
    for (const d of days) {
      daysRow.append(h("div", { class: "tsh-cal-dayhead", text: DAY_LABEL[d] }));
    }

    // Body: time gutter + one relative column per day.
    const gutter = h("div", { class: "tsh-cal-gutter" });
    for (let m = START_MIN; m <= END_MIN; m += 60) {
      const label = h("div", { class: "tsh-cal-hour", text: fmtMinutes(m) });
      label.style.top = `${(m - START_MIN) * PX_PER_MIN}px`;
      gutter.append(label);
    }

    const dayCols = new Map<Day, HTMLElement>();
    const gridlineBg = `repeating-linear-gradient(to bottom, #eef2f6 0, #eef2f6 1px, transparent 1px, transparent ${
      60 * PX_PER_MIN
    }px)`;
    for (const d of days) {
      const col = h("div", { class: "tsh-cal-day" });
      col.style.height = `${BODY_HEIGHT}px`;
      col.style.backgroundImage = gridlineBg;
      dayCols.set(d, col);
    }
    gutter.style.height = `${BODY_HEIGHT}px`;

    // Collect weekly blocks per day. `methods` collects codes → full names for the legend below.
    const methods = new Map<string, string>();
    const byDay = new Map<Day, EvBlock[]>();
    for (const ps of gridSections) {
      for (const m of ps.section.meetings) {
        if (m.method) methods.set(m.method, m.methodText || m.method);
        for (const b of meetingBlocks(m)) {
          if (!dayCols.has(b.day)) continue;
          const arr = byDay.get(b.day) ?? [];
          arr.push({
            day: b.day,
            start: b.start,
            end: b.end,
            ps,
            m,
            conflicted: false,
            lane: 0,
            lanes: 1,
            booked: bookedIds.has(ps.id),
          });
          byDay.set(b.day, arr);
        }
      }
    }

    const conflictedCourseKeys = new Set<string>();
    for (const [day, arr] of byDay) {
      const col = dayCols.get(day);
      if (!col) continue;

      // Flag ONLY the specific blocks that overlap a block from a different course.
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i];
          const b = arr[j];
          if (
            a.start < b.end &&
            b.start < a.end &&
            courseKey(a.ps.course) !== courseKey(b.ps.course)
          ) {
            a.conflicted = true;
            b.conflicted = true;
            conflictedCourseKeys.add(courseKey(a.ps.course));
            conflictedCourseKeys.add(courseKey(b.ps.course));
          }
        }
      }

      // Lay overlapping blocks out side by side so none is hidden underneath another.
      assignLanes(arr);

      for (const blk of arr) {
        const { ps, m } = blk;
        const top = (blk.start - START_MIN) * PX_PER_MIN;
        const height = Math.max((blk.end - blk.start) * PX_PER_MIN, 16);
        const timeRange = [m.start, m.end].filter(Boolean).join(" – ");
        const methodLoc = [m.method, m.location].filter(Boolean).join(" / ");
        const lines: HTMLElement[] = [
          h("div", { class: "tsh-ev-time", text: timeRange }),
          h("div", { class: "tsh-ev-abbr", text: blk.booked ? `✓ ${ps.course.abbr}` : ps.course.abbr }),
        ];
        if (methodLoc) lines.push(h("div", { class: "tsh-ev-loc", text: methodLoc }));
        if (m.instructor) lines.push(h("div", { class: "tsh-ev-inst", text: m.instructor }));
        const ev = h("div", {
          class: `tsh-ev${blk.conflicted ? " tsh-ev-conflict" : ""}${blk.booked ? " tsh-ev-booked" : ""}`,
          title: blk.booked ? `Enrolled in TSS (${ps.section.eventPkgText})` : undefined,
        }, lines);
        // Controls pinned to the block's bottom; all act on the whole course. An enrolled block
        // offers exactly one action — Drop, a REAL TSS drop that also removes the course from the
        // plan (no Switch/Book on live enrollments). A planned block gets Book / Switch / Drop.
        const actions = blk.booked
          ? [
              h("button", {
                class: "tsh-ev-drop",
                text: "Drop",
                title: `Drop ${ps.course.abbr} from TSS — also removes it from this plan`,
                onClick: (event) => {
                  event.stopPropagation();
                  booking.dropTss(ps.course, ps.section);
                },
              }),
            ]
          : [
              h("button", {
                class: "tsh-ev-book",
                text: "Book",
                title: `Book ${ps.section.eventPkgText} in TSS now`,
                onClick: (event) => {
                  event.stopPropagation();
                  booking.book(ps.course, ps.section);
                },
              }),
              h("button", {
                class: "tsh-ev-switch",
                text: "Switch",
                title: `Switch section of ${ps.course.abbr}`,
                onClick: (event) => {
                  event.stopPropagation();
                  ctx.showSections(ps.course);
                },
              }),
              h("button", {
                class: "tsh-ev-drop",
                text: "Drop",
                title: `Drop ${ps.course.abbr}`,
                onClick: (event) => {
                  event.stopPropagation();
                  const planId = ctx.getActivePlanId();
                  if (planId && confirmDrop(ps.course.abbr)) {
                    void dropCourse(ctx.store, planId, courseKey(ps.course));
                  }
                },
              }),
            ];
        ev.append(h("div", { class: "tsh-ev-actions" }, actions));
        const widthPct = 100 / blk.lanes;
        const leftPct = blk.lane * widthPct;
        ev.style.left = `calc(${leftPct}% + 1px)`;
        ev.style.width = `calc(${widthPct}% - 2px)`;
        ev.style.right = "auto";
        ev.style.top = `${top}px`;
        ev.style.height = `${height}px`;
        ev.style.background = blk.booked ? ENROLLED_COLOR : PLANNED_COLOR;
        col.append(ev);
      }
    }

    const bodyRow = h("div", { class: "tsh-cal-body" }, [gutter, ...dayCols.values()]);
    wrap.append(h("div", { class: "tsh-cal" }, [daysRow, bodyRow]));

    // Legend: which part-code means what (LE = Lecture, DI = Discussion, LA = Lab, …).
    if (methods.size > 0) {
      const legend = h("div", { class: "tsh-cal-legend" });
      for (const [code, name] of methods) {
        if (code === name) continue; // no expansion available
        legend.append(
          h("span", { class: "tsh-legend-item" }, [
            h("span", { class: "tsh-legend-code", text: code }),
            ` ${name}`,
          ]),
        );
      }
      if (legend.childNodes.length > 0) wrap.append(legend);
    }

    // Course strip — one row per course (its LE/DI/LA parts collapse into a single entry).
    // Planned courses keep plan Switch/Drop and gain a real "Book" action; live enrollments not
    // in the plan get their own rows with a real "Drop from TSS".
    if (planned.length > 0 || enrollments.length > 0) {
      const list = h("div", { class: "tsh-planned" });

      const bookingState = (course: (typeof planned)[number]["course"]): HTMLElement[] => {
        const bits: HTMLElement[] = [];
        const busyLabel = booking.busy(course);
        if (busyLabel) bits.push(h("span", { class: "tsh-book-busy", text: busyLabel }));
        const err = booking.error(course);
        if (err) bits.push(h("span", { class: "tsh-book-err", text: `⚠ ${err}` }));
        return bits;
      };

      for (const group of groupByCourse(planned)) {
        const conflicted = conflictedCourseKeys.has(group.key);
        const rb = bookedByCourse.get(group.key);
        const plannedSec = group.planned[0].section;
        const sameSection = rb?.section != null && bookedIds.has(group.planned[0].id);

        const cells: Array<Node | string> = [
          h("span", { class: "tsh-planned-abbr", text: group.course.abbr }),
          h("span", { class: "tsh-planned-name", text: group.course.title }),
          h("span", { class: "tsh-planned-units", text: `${group.course.units}u` }),
        ];
        if (rb) {
          cells.push(
            h("span", {
              class: "tsh-booked-badge",
              text: sameSection ? "✓ Enrolled" : "✓ Enrolled (other section)",
              title: rb.section
                ? `Enrolled in ${rb.section.eventPkgText}`
                : `Enrolled in TSS (section still being located)`,
            }),
          );
        }
        const busyLabel = booking.busy(group.course);
        cells.push(...bookingState(group.course));
        if (rb) {
          // Enrolled: the only action is a real TSS drop (which also clears the plan entry).
          // No Switch/Book on live enrollments.
          const enrolledSec = rb.section;
          if (enrolledSec && !busyLabel) {
            cells.push(
              h("button", {
                class: "tsh-course-drop",
                text: "Drop from TSS",
                title: `Cancel your ${group.course.abbr} enrollment — also removes it from this plan`,
                onClick: () => booking.dropTss(rb.course, enrolledSec),
              }),
            );
          }
        } else {
          if (!busyLabel) {
            cells.push(
              h("button", {
                class: "tsh-course-book",
                text: "Book",
                title: `Book ${plannedSec.eventPkgText} in TSS now`,
                onClick: () => booking.book(group.course, plannedSec),
              }),
            );
          }
          cells.push(
            h("button", {
              class: "tsh-course-switch",
              text: "Switch",
              title: `Pick a different section of ${group.course.abbr}`,
              onClick: () => ctx.showSections(group.course),
            }),
            h("button", {
              class: "tsh-course-drop",
              text: "Drop",
              title: `Drop ${group.course.abbr} (all sections)`,
              onClick: () => {
                const planId = ctx.getActivePlanId();
                if (planId && confirmDrop(group.course.abbr)) {
                  void dropCourse(ctx.store, planId, group.key);
                }
              },
            }),
          );
        }
        list.append(
          h("div", { class: `tsh-planned-row${conflicted ? " tsh-conflict" : ""}` }, cells),
        );
      }

      // Enrollments with no counterpart in the plan.
      const plannedKeys = new Set(planned.map((ps) => courseKey(ps.course)));
      for (const rb of enrollments) {
        if (plannedKeys.has(courseKey(rb.course))) continue;
        const cells: Array<Node | string> = [
          h("span", { class: "tsh-planned-abbr", text: rb.course.abbr }),
          h("span", { class: "tsh-planned-name", text: rb.course.title }),
          h("span", { class: "tsh-planned-units", text: `${rb.course.units}u` }),
          h("span", {
            class: "tsh-booked-badge",
            text: "✓ Enrolled",
            title: rb.section
              ? `Enrolled in ${rb.section.eventPkgText}`
              : rb.error
                ? `Enrolled in TSS — section lookup failed: ${rb.error}`
                : "Enrolled in TSS — locating section…",
          }),
        ];
        cells.push(...bookingState(rb.course));
        if (rb.section && !booking.busy(rb.course)) {
          const sec = rb.section;
          cells.push(
            h("button", {
              class: "tsh-course-drop",
              text: "Drop from TSS",
              title: `Cancel your ${rb.course.abbr} enrollment in TSS`,
              onClick: () => booking.dropTss(rb.course, sec),
            }),
          );
        }
        list.append(h("div", { class: "tsh-planned-row tsh-planned-row-booked" }, cells));
      }

      if (list.childNodes.length > 0) wrap.append(list);
    }
  }

  ctx.subscribe((reason) => {
    if (reason === "plans" || reason === "bookings") render();
  });

  render();
  return { el };
}

// Injected into the shadow-root stylesheet by the integrator (see panel wiring). Only classes
// introduced by this component live here; existing `.tsh-*` classes come from styles.ts.
export const CALENDAR_EXTRA_STYLES = `
/* Lay the block out as a column so the Drop button can pin to the bottom. */
.tsh-ev { display: flex; flex-direction: column; }

/* Per-block Switch / Drop controls: anchored to the bottom of the block, side by side, with the
   detail lines flowing above them. Solid white with colored borders so they read against the block. */
.tsh-ev-actions {
  margin-top: auto;
  display: flex;
  gap: 3px;
}
.tsh-ev-book,
.tsh-ev-switch,
.tsh-ev-drop {
  flex: 1 1 0;
  min-width: 0;
  padding: 1px 4px;
  border-radius: 4px;
  background: #fff;
  font: inherit;
  font-size: 9px;
  font-weight: 700;
  line-height: 1.4;
  cursor: pointer;
  box-sizing: border-box;
}
.tsh-ev-book { border: 1px solid #16a34a; color: #15803d; }
.tsh-ev-book:hover { background: #f0fdf4; }
.tsh-ev-switch { border: 1px solid #2563eb; color: #1d4ed8; }
.tsh-ev-switch:hover { background: #eff6ff; }
.tsh-ev-drop { border: 1px solid #dc2626; color: #b91c1c; }
.tsh-ev-drop:hover { background: #fef2f2; }

/* Dated-exam notes above the grid (midterms, etc.). */
.tsh-cal-notes {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tsh-cal-notes-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #64748b;
}
.tsh-cal-note { font-size: 12px; color: #475569; }
.tsh-cal-note-abbr { font-weight: 700; color: #1a1f2b; }
.tsh-cal-note-conflict { color: #b91c1c; }
.tsh-cal-note-warn { font-size: 11px; font-weight: 600; color: #b91c1c; }

/* Per-course Switch / Drop buttons in the list beneath the grid. */
.tsh-course-switch,
.tsh-course-drop {
  flex: 0 0 auto;
  padding: 2px 8px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #fff;
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.tsh-course-switch { color: #1d4ed8; }
.tsh-course-switch:hover {
  background: #eff6ff;
  border-color: #93c5fd;
}
.tsh-course-drop { color: #b91c1c; }
.tsh-course-drop:hover {
  background: #fef2f2;
  border-color: #fca5a5;
}
.tsh-course-book {
  flex: 0 0 auto;
  padding: 2px 8px;
  border: 1px solid #16a34a;
  border-radius: 6px;
  background: #16a34a;
  color: #fff;
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.tsh-course-book:hover { background: #15803d; border-color: #15803d; }

/* Blocks for sections the student is actually enrolled in (TSS bookings). */
.tsh-ev-booked { box-shadow: inset 0 0 0 2px #16a34a; }
.tsh-planned-row-booked { background: #f0fdf4; }
`;
