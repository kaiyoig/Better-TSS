import type { Meeting } from "../api/types";
import type { CourseGroup } from "../model/planOps";
import { dropCourse, groupByCourse, parseFinal } from "../model/planOps";
import type { AppContext } from "./context";
import { clear, h } from "./dom";
import { confirmDrop } from "./util";

// WebReg-style "List" view: a table where each course spans several rows (one per meeting part —
// LE / DI / LA — plus a Final Exam row). The merged left/right cells (course, title, units,
// status, action) use rowSpan so a whole course reads as one block, matching WebReg's layout.

const COLUMNS = [
  "Subject / Course",
  "Title",
  "Type",
  "Instructor",
  "Units",
  "Days",
  "Time",
  "Location",
  "Status",
  "Action",
];

/** Order a course's meetings: non-finals first (LE before the rest), finals last. */
function orderMeetings(group: CourseGroup): Meeting[] {
  const meetings: Meeting[] = [];
  for (const ps of group.planned) meetings.push(...ps.section.meetings);
  const rank = (m: Meeting): number => {
    if (m.isFinal) return 2;
    return m.method === "LE" ? 0 : 1;
  };
  return meetings
    .map((m, i) => ({ m, i }))
    .sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i)
    .map((x) => x.m);
}

function timeRange(start: string | null, end: string | null): string {
  return [start, end].filter(Boolean).join("–");
}

/** Build the <td> cells for one meeting row: Type, Instructor, Days, Time, Location. */
function meetingCells(m: Meeting): HTMLElement[] {
  if (m.isFinal) {
    const final = parseFinal(m);
    const time = [final.date, timeRange(final.start, final.end)]
      .filter(Boolean)
      .join(" ");
    return [
      h("td", { class: "tsh-list-type", text: "FI" }),
      h("td", { class: "tsh-list-inst", text: m.instructor ?? "" }),
      h("td", { class: "tsh-list-days", text: final.day ?? "—" }),
      h("td", { class: "tsh-list-time", text: time || "—" }),
      h("td", { class: "tsh-list-loc", text: m.location ?? "" }),
    ];
  }
  return [
    h("td", { class: "tsh-list-type", text: m.method }),
    h("td", { class: "tsh-list-inst", text: m.instructor ?? "" }),
    h("td", { class: "tsh-list-days", text: m.days.join("") }),
    h("td", { class: "tsh-list-time", text: timeRange(m.start, m.end) || "—" }),
    h("td", { class: "tsh-list-loc", text: m.location ?? "" }),
  ];
}

/** WebReg-style list/table of the active plan's courses, one meeting per row. */
export function createList(ctx: AppContext): { el: HTMLElement } {
  const el = h("section", { class: "tsh-section" }, [
    h("div", { class: "tsh-label", text: "List" }),
  ]);
  const wrap = h("div", { class: "tsh-list-wrap" });
  el.append(wrap);

  function render(): void {
    clear(wrap);
    const plan = ctx.getActivePlan();
    const planned = plan?.sections ?? [];
    if (!plan || planned.length === 0) {
      wrap.append(
        h("div", { class: "tsh-empty", text: "No courses in this plan yet." }),
      );
      return;
    }

    const head = h(
      "tr",
      {},
      COLUMNS.map((c) => h("th", { class: "tsh-list-th", text: c })),
    );

    const body = h("tbody", { class: "tsh-list-body" });
    for (const group of groupByCourse(planned)) {
      const meetings = orderMeetings(group);
      const span = Math.max(meetings.length, 1);

      const dropBtn = h("button", {
        class: "tsh-btn tsh-btn-danger tsh-list-drop",
        text: "Drop",
        onClick: () => {
          const planId = ctx.getActivePlanId();
          if (planId && confirmDrop(group.course.abbr)) {
            void dropCourse(ctx.store, planId, group.key);
          }
        },
      });

      const rows = meetings.length > 0 ? meetings : [null];
      rows.forEach((m, idx) => {
        const tr = h("tr", { class: `tsh-list-row${idx === 0 ? " tsh-list-row-first" : ""}` });
        if (idx === 0) {
          tr.append(
            h("td", {
              class: "tsh-list-course",
              text: group.course.abbr,
              attrs: { rowspan: String(span) },
            }),
            h("td", {
              class: "tsh-list-title",
              text: group.course.title,
              attrs: { rowspan: String(span) },
            }),
          );
        }
        if (m) {
          for (const cell of meetingCells(m)) tr.append(cell);
        } else {
          // No meetings on record — keep the row shape intact.
          for (let i = 0; i < 5; i++) tr.append(h("td", { text: "—" }));
        }
        if (idx === 0) {
          tr.append(
            h("td", {
              class: "tsh-list-units",
              text: group.course.units,
              attrs: { rowspan: String(span) },
            }),
            h("td", {
              class: "tsh-list-status",
              text: "Planned",
              attrs: { rowspan: String(span) },
            }),
            h("td", { class: "tsh-list-action", attrs: { rowspan: String(span) } }, [dropBtn]),
          );
        }
        body.append(tr);
      });
    }

    const table = h("table", { class: "tsh-list-table" }, [
      h("thead", { class: "tsh-list-head" }, [head]),
      body,
    ]);
    wrap.append(table);
  }

  ctx.subscribe((reason) => {
    if (reason === "plans") render();
  });

  render();
  return { el };
}

export const LIST_STYLES = `
.tsh-list-wrap {
  overflow-x: auto;
  max-width: 100%;
}
.tsh-list-table {
  border-collapse: collapse;
  width: 100%;
  min-width: 720px;
  font-size: 12px;
  line-height: 1.4;
}
.tsh-list-table th,
.tsh-list-table td {
  border: 1px solid #dfe4ea;
  padding: 4px 8px;
  text-align: left;
  vertical-align: top;
  white-space: nowrap;
}
.tsh-list-table th {
  background: #f1f4f8;
  font-weight: 600;
  color: #33415c;
  position: sticky;
  top: 0;
}
.tsh-list-table td.tsh-list-title,
.tsh-list-table td.tsh-list-loc {
  white-space: normal;
}
/* Zebra-stripe whole courses: a course starts a new stripe on its first row. */
.tsh-list-row-first > td {
  border-top: 2px solid #c3ccd8;
}
.tsh-list-row:nth-child(even) > td {
  background: #fafbfc;
}
.tsh-list-course {
  font-weight: 600;
  color: #1f2d3d;
}
.tsh-list-type {
  font-weight: 600;
  color: #445;
}
.tsh-list-status {
  color: #2a7a3b;
  font-weight: 600;
}
.tsh-list-action {
  text-align: center;
}
.tsh-list-drop {
  white-space: nowrap;
}
`;
