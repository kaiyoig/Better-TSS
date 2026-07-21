import type { Meeting } from "../api/types";
import type { PlannedSection } from "../model/plan";
import type { Day } from "../model/schedule";
import { DAY_ORDER, meetingBlocks, sectionBlocks, totalUnits } from "../model/schedule";
import {
  courseKey,
  datedExams,
  dropCourse,
  examConflicts,
  groupByCourse,
} from "../model/planOps";
import { conflictListEl } from "./conflicts";
import type { AppContext } from "./context";
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

// Muted, readable block colors keyed off a course's moduleID.
const PALETTE = [
  "#bfdbfe",
  "#bbf7d0",
  "#fde68a",
  "#fbcfe8",
  "#c7d2fe",
  "#a7f3d0",
  "#fecaca",
  "#ddd6fe",
];

function colorFor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

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

  function render(): void {
    clear(wrap);
    const plan = ctx.getActivePlan();
    const planned = plan?.sections ?? [];

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

    // Which day columns to show: Mon–Fri always, plus any weekend day with a block.
    const present = new Set<Day>();
    for (const ps of planned) for (const b of sectionBlocks(ps.section)) present.add(b.day);
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
    for (const ps of planned) {
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
          h("div", { class: "tsh-ev-abbr", text: ps.course.abbr }),
        ];
        if (methodLoc) lines.push(h("div", { class: "tsh-ev-loc", text: methodLoc }));
        if (m.instructor) lines.push(h("div", { class: "tsh-ev-inst", text: m.instructor }));
        const ev = h("div", {
          class: `tsh-ev${blk.conflicted ? " tsh-ev-conflict" : ""}`,
        }, lines);
        // Drop control: dropping one part drops the whole course.
        ev.append(
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
        );
        const widthPct = 100 / blk.lanes;
        const leftPct = blk.lane * widthPct;
        ev.style.left = `calc(${leftPct}% + 1px)`;
        ev.style.width = `calc(${widthPct}% - 2px)`;
        ev.style.right = "auto";
        ev.style.top = `${top}px`;
        ev.style.height = `${height}px`;
        ev.style.background = colorFor(ps.course.moduleID);
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

    // Droppable list — one row per course (its LE/DI/LA parts collapse into a single entry).
    if (planned.length > 0) {
      const list = h("div", { class: "tsh-planned" });
      for (const group of groupByCourse(planned)) {
        const conflicted = conflictedCourseKeys.has(group.key);
        const drop = h("button", {
          class: "tsh-course-drop",
          text: "Drop",
          title: `Drop ${group.course.abbr} (all sections)`,
          onClick: () => {
            const planId = ctx.getActivePlanId();
            if (planId && confirmDrop(group.course.abbr)) {
              void dropCourse(ctx.store, planId, group.key);
            }
          },
        });
        list.append(
          h("div", { class: `tsh-planned-row${conflicted ? " tsh-conflict" : ""}` }, [
            h("span", { class: "tsh-planned-abbr", text: group.course.abbr }),
            h("span", { class: "tsh-planned-name", text: group.course.title }),
            h("span", { class: "tsh-planned-units", text: `${group.course.units}u` }),
            drop,
          ]),
        );
      }
      wrap.append(list);
    }
  }

  ctx.subscribe((reason) => {
    if (reason === "plans") render();
  });

  render();
  return { el };
}

// Injected into the shadow-root stylesheet by the integrator (see panel wiring). Only classes
// introduced by this component live here; existing `.tsh-*` classes come from styles.ts.
export const CALENDAR_EXTRA_STYLES = `
/* Lay the block out as a column so the Drop button can pin to the bottom. */
.tsh-ev { display: flex; flex-direction: column; }

/* Per-block Drop control: anchored to the bottom of the block, full width, with the detail
   lines flowing above it. Solid white with a red border so it stands out against the block. */
.tsh-ev-drop {
  margin-top: auto;
  width: 100%;
  padding: 1px 4px;
  border: 1px solid #dc2626;
  border-radius: 4px;
  background: #fff;
  color: #b91c1c;
  font: inherit;
  font-size: 9px;
  font-weight: 700;
  line-height: 1.4;
  cursor: pointer;
  box-sizing: border-box;
}
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

/* Per-course Drop button in the list beneath the grid. */
.tsh-course-drop {
  flex: 0 0 auto;
  padding: 2px 8px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #fff;
  color: #b91c1c;
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.tsh-course-drop:hover {
  background: #fef2f2;
  border-color: #fca5a5;
}
`;
