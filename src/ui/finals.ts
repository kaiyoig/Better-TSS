import type { CourseSummary } from "../api/types";
import type { Day } from "../model/schedule";
import { timeToMinutes } from "../model/schedule";
import type { CourseFinal } from "../model/planOps";
import { courseKey, dropCourse, finalMeetings } from "../model/planOps";
import type { AppContext } from "./context";
import { clear, h } from "./dom";
import { confirmDrop } from "./util";

// Weekly grid of final exams for finals week. Structurally mirrors `calendar.ts` (same time
// window, px-per-minute, gutter + one column per weekday) but plots only final-exam meetings.
// Constants are duplicated locally: calendar.ts keeps them private, and the shared CSS lives in
// styles.ts, so we reuse the `.tsh-cal-*` / `.tsh-ev-*` classes rather than importing.

const START_MIN = 8 * 60; // 8:00 AM
const END_MIN = 22 * 60; // 10:00 PM
const PX_PER_MIN = 96 / 60; // one hour ≈ 96px — matches the calendar view
const BODY_HEIGHT = (END_MIN - START_MIN) * PX_PER_MIN;

// UCSD finals week runs Saturday through the following Friday — show the whole week by default,
// ordered starting Saturday, regardless of which days actually have an exam.
const FINALS_DAYS: Day[] = ["Sa", "Su", "M", "Tu", "W", "Th", "F"];
const DAY_LABEL: Record<Day, string> = {
  Su: "Sun",
  M: "Mon",
  Tu: "Tue",
  W: "Wed",
  Th: "Thu",
  F: "Fri",
  Sa: "Sat",
};

// Muted, readable block colors keyed off a course's moduleID (mirrors calendar.ts).
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

function moduleKey(c: CourseSummary): string {
  return `${c.year}-${c.period}-${c.moduleID}`;
}

/** A final that has a resolved weekday plus start/end minutes and can be placed on the grid. */
interface PlacedFinal {
  item: CourseFinal;
  day: Day;
  start: number;
  end: number;
}

/** Optional styles for the TBA list; the `.tsh-cal-*`/`.tsh-ev-*` grid classes come from styles.ts. */
export const FINALS_STYLES = `
.tsh-finals-tba { display: flex; flex-direction: column; gap: 4px; padding: 2px 2px 0; }
.tsh-finals-tba-label { font-size: 11px; font-weight: 700; color: #475569; }
.tsh-finals-tba-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 11px;
  color: #64748b;
}
.tsh-finals-tba-abbr { font-weight: 700; color: #334155; }
.tsh-finals-tba-raw { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

/** Weekly grid of final exams for the active plan, with a TBA list for unschedulable finals. */
export function createFinals(ctx: AppContext): { el: HTMLElement } {
  const el = h("section", { class: "tsh-section" }, [
    h("div", { class: "tsh-label", text: "Finals week" }),
  ]);
  const wrap = h("div", { class: "tsh-cal-wrap" });
  el.append(wrap);

  function render(): void {
    clear(wrap);
    const plan = ctx.getActivePlan();
    const finals = finalMeetings(plan?.sections ?? []);

    // Split into placeable (day + start + end all parsed) vs. TBA (missing any of them).
    const placed: PlacedFinal[] = [];
    const tba: CourseFinal[] = [];
    for (const item of finals) {
      const { day, start, end } = item.final;
      const startMin = timeToMinutes(start);
      const endMin = timeToMinutes(end);
      if (day && startMin != null && endMin != null) {
        placed.push({ item, day, start: startMin, end: endMin });
      } else {
        tba.push(item);
      }
    }

    // Flag overlapping finals (same day, overlapping minutes) so clashes are visible.
    const conflicting = new Set<PlacedFinal>();
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i];
        const b = placed[j];
        if (a.day === b.day && a.start < b.end && b.start < a.end) {
          conflicting.add(a);
          conflicting.add(b);
        }
      }
    }

    const header = h("div", { class: "tsh-cal-header" }, [
      h("span", { class: "tsh-cal-title", text: plan ? plan.name : "No active plan" }),
      h("span", { class: "tsh-cal-units", text: `${finals.length} final exam(s)` }),
    ]);
    if (conflicting.size > 0) {
      header.append(
        h("span", {
          class: "tsh-cal-warn",
          text: `⚠ ${conflicting.size} overlapping`,
        }),
      );
    }
    wrap.append(header);

    if (finals.length === 0) {
      wrap.append(h("div", { class: "tsh-cal-units", text: "No final exams in this plan." }));
      return;
    }

    // Show the entire finals week (Sat–Fri) by default, not just days with a scheduled exam.
    const days = FINALS_DAYS;

    // Always draw the full-week grid when the plan has any finals.
    if (days.length > 0) {
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
      gutter.style.height = `${BODY_HEIGHT}px`;

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

      // Place each final as a `.tsh-ev` block.
      for (const p of placed) {
        const col = dayCols.get(p.day);
        if (!col) continue;
        const { item } = p;
        const { final } = item;
        const top = (p.start - START_MIN) * PX_PER_MIN;
        const height = Math.max((p.end - p.start) * PX_PER_MIN, 16);
        const timeRange = [final.start, final.end].filter(Boolean).join(" – ");

        const lines: HTMLElement[] = [
          h("div", { class: "tsh-ev-abbr", text: item.course.abbr }),
          h("div", { class: "tsh-ev-time", text: "Final" }),
        ];
        if (timeRange) lines.push(h("div", { class: "tsh-ev-time", text: timeRange }));
        if (final.date) lines.push(h("div", { class: "tsh-ev-loc", text: final.date }));
        if (final.meeting.location) {
          lines.push(h("div", { class: "tsh-ev-loc", text: final.meeting.location }));
        }

        const ev = h("div", {
          class: `tsh-ev${conflicting.has(p) ? " tsh-ev-conflict" : ""}`,
        }, lines);
        ev.style.top = `${top}px`;
        ev.style.height = `${height}px`;
        ev.style.background = colorFor(moduleKey(item.course));
        col.append(ev);
      }

      const bodyRow = h("div", { class: "tsh-cal-body" }, [gutter, ...dayCols.values()]);
      wrap.append(h("div", { class: "tsh-cal" }, [daysRow, bodyRow]));
    }

    // Manage courses that have a final: Switch to a different section, or Drop the course. One row
    // per course (deduped). Reuses the `.tsh-planned*` / `.tsh-course-*` classes from calendar.ts.
    const managed: CourseSummary[] = [];
    const managedSeen = new Set<string>();
    for (const item of finals) {
      const key = courseKey(item.course);
      if (managedSeen.has(key)) continue;
      managedSeen.add(key);
      managed.push(item.course);
    }
    if (managed.length > 0) {
      const list = h("div", { class: "tsh-planned" });
      for (const course of managed) {
        const switchBtn = h("button", {
          class: "tsh-course-switch",
          text: "Switch",
          title: `Pick a different section of ${course.abbr}`,
          onClick: () => ctx.showSections(course),
        });
        const drop = h("button", {
          class: "tsh-course-drop",
          text: "Drop",
          title: `Drop ${course.abbr} (all sections)`,
          onClick: () => {
            const planId = ctx.getActivePlanId();
            if (planId && confirmDrop(course.abbr)) {
              void dropCourse(ctx.store, planId, courseKey(course));
            }
          },
        });
        list.append(
          h("div", { class: "tsh-planned-row" }, [
            h("span", { class: "tsh-planned-abbr", text: course.abbr }),
            h("span", { class: "tsh-planned-name", text: course.title }),
            switchBtn,
            drop,
          ]),
        );
      }
      wrap.append(list);
    }

    // Unscheduled / TBA finals (no parseable weekday or time) — listed, never dropped silently.
    if (tba.length > 0) {
      const box = h("div", { class: "tsh-finals-tba" }, [
        h("div", { class: "tsh-finals-tba-label", text: "Unscheduled / TBA finals" }),
      ]);
      for (const item of tba) {
        box.append(
          h("div", { class: "tsh-finals-tba-row" }, [
            h("span", { class: "tsh-finals-tba-abbr", text: item.course.abbr }),
            h("span", {
              class: "tsh-finals-tba-raw",
              text: item.final.meeting.raw || "TBA",
            }),
          ]),
        );
      }
      wrap.append(box);
    }
  }

  ctx.subscribe((reason) => {
    if (reason === "plans") render();
  });

  render();
  return { el };
}
