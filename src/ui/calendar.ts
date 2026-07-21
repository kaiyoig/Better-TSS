import type { Day } from "../model/schedule";
import {
  DAY_ORDER,
  conflictedIds,
  meetingBlocks,
  sectionBlocks,
  totalUnits,
} from "../model/schedule";
import type { AppContext } from "./context";
import { clear, h } from "./dom";

const START_MIN = 8 * 60; // 8:00 AM
const END_MIN = 22 * 60; // 10:00 PM
const PX_PER_MIN = 64 / 60; // one hour ≈ 64px — tall enough to fit method/location/instructor
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
    const conflicts = conflictedIds(planned);

    const header = h("div", { class: "tsh-cal-header" }, [
      h("span", { class: "tsh-cal-title", text: plan ? plan.name : "No active plan" }),
      h("span", { class: "tsh-cal-units", text: `${units} units · ${planned.length} section(s)` }),
    ]);
    if (conflicts.size > 0) {
      header.append(
        h("span", { class: "tsh-cal-warn", text: `⚠ ${conflicts.size} in conflict` }),
      );
    }
    wrap.append(header);

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

    // Place blocks. Each carries WebReg-style detail: time range, course + part (LE/DI/LA),
    // location, and instructor. `methods` collects codes → full names for the legend below.
    const methods = new Map<string, string>();
    for (const ps of planned) {
      const bg = colorFor(ps.course.moduleID);
      const conflicted = conflicts.has(ps.id);
      for (const m of ps.section.meetings) {
        if (m.method) methods.set(m.method, m.methodText || m.method);
        const timeRange = [m.start, m.end].filter(Boolean).join(" – ");
        // WebReg-style: part code and location on one line, e.g. "LE / Pepper Canyon Hall 106".
        const methodLoc = [m.method, m.location].filter(Boolean).join(" / ");
        for (const b of meetingBlocks(m)) {
          const col = dayCols.get(b.day);
          if (!col) continue;
          const top = (b.start - START_MIN) * PX_PER_MIN;
          const height = Math.max((b.end - b.start) * PX_PER_MIN, 16);
          const lines: HTMLElement[] = [
            h("div", { class: "tsh-ev-time", text: timeRange }),
            h("div", { class: "tsh-ev-abbr", text: ps.course.abbr }),
          ];
          if (methodLoc) lines.push(h("div", { class: "tsh-ev-loc", text: methodLoc }));
          if (m.instructor) lines.push(h("div", { class: "tsh-ev-inst", text: m.instructor }));
          const ev = h("div", {
            class: `tsh-ev${conflicted ? " tsh-ev-conflict" : ""}`,
          }, lines);
          ev.style.top = `${top}px`;
          ev.style.height = `${height}px`;
          ev.style.background = bg;
          col.append(ev);
        }
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

    // Removable list of planned sections.
    if (planned.length > 0) {
      const list = h("div", { class: "tsh-planned" });
      for (const ps of planned) {
        const conflicted = conflicts.has(ps.id);
        const remove = h("button", {
          class: "tsh-remove",
          text: "×",
          title: "Remove from plan",
          onClick: () => {
            const planId = ctx.getActivePlanId();
            if (planId) void ctx.store.removeSection(planId, ps.id);
          },
        });
        list.append(
          h("div", { class: `tsh-planned-row${conflicted ? " tsh-conflict" : ""}` }, [
            h("span", { class: "tsh-planned-abbr", text: ps.course.abbr }),
            h("span", { class: "tsh-planned-name", text: ps.section.eventPkgText }),
            h("span", { class: "tsh-planned-units", text: `${ps.course.units}u` }),
            remove,
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
