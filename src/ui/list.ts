import type { Meeting } from "../api/types";
import type { CourseGroup } from "../model/planOps";
import { courseKey, dropCourse, groupByCourse, isUnscheduled, parseFinal } from "../model/planOps";
import { plannedSectionId } from "../model/plan";
import { createBookingRunner } from "./bookingOps";
import { conflictListEl } from "./conflicts";
import type { AppContext, ResolvedBooking } from "./context";
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

const DATED_RE = /\d{1,2}\/\d{1,2}\/\d{4}/;

/** A one-off dated exam that isn't a final (e.g. a midterm): dated, non-weekly, not final. */
function isDatedExam(m: Meeting): boolean {
  return !m.isFinal && m.days.length === 0 && DATED_RE.test(m.raw);
}

/** Order a course's meetings: weekly first (LE before the rest), then dated exams, finals last. */
function orderMeetings(group: CourseGroup): Meeting[] {
  const meetings: Meeting[] = [];
  for (const ps of group.planned) meetings.push(...ps.section.meetings);
  const rank = (m: Meeting): number => {
    if (m.isFinal) return 3;
    if (isDatedExam(m)) return 2;
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
  // Finals and other dated exams (midterms) are one-off: show the exam date + weekday, not a
  // weekly day list. Type is "FI" for finals, "MI" for midterms, "EX" for any other dated exam.
  if (m.isFinal || isDatedExam(m)) {
    const info = parseFinal(m);
    const time = [info.date, timeRange(info.start, info.end)]
      .filter(Boolean)
      .join(" ");
    const type = m.isFinal ? "FI" : /midterm/i.test(m.raw) ? "MI" : "EX";
    return [
      h("td", { class: "tsh-list-type", text: type }),
      h("td", { class: "tsh-list-inst", text: m.instructor ?? "" }),
      h("td", { class: "tsh-list-days", text: info.day ?? "—" }),
      h("td", { class: "tsh-list-time", text: time || "—" }),
      h("td", { class: "tsh-list-loc", text: m.location ?? "" }),
    ];
  }
  // A weekly part with no set time yet (e.g. an unscheduled lab): show "TBA", not a blank cell.
  const tba = isUnscheduled(m);
  return [
    h("td", { class: "tsh-list-type", text: m.method }),
    h("td", { class: "tsh-list-inst", text: m.instructor ?? "" }),
    h("td", { class: "tsh-list-days", text: tba ? "TBA" : m.days.join("") }),
    h("td", {
      class: `tsh-list-time${tba ? " tsh-list-tba" : ""}`,
      text: tba ? "TBA" : timeRange(m.start, m.end) || "—",
    }),
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

  const booking = createBookingRunner(ctx, () => render());

  function render(): void {
    clear(wrap);
    const plan = ctx.getActivePlan();
    const planned = plan?.sections ?? [];

    // Live-enrollment overlay: flag courses the student is actually booked into.
    const bookedByCourse = new Map<string, ResolvedBooking>();
    for (const rb of ctx.getBookings()) bookedByCourse.set(courseKey(rb.course), rb);
    if (!plan || planned.length === 0) {
      wrap.append(
        h("div", { class: "tsh-empty", text: "No courses in this plan yet." }),
      );
      return;
    }

    const conflictList = conflictListEl(planned);
    if (conflictList) wrap.append(conflictList);

    const head = h(
      "tr",
      {},
      COLUMNS.map((c) => h("th", { class: "tsh-list-th", text: c })),
    );

    const body = h("tbody", { class: "tsh-list-body" });
    for (const group of groupByCourse(planned)) {
      const meetings = orderMeetings(group);
      const span = Math.max(meetings.length, 1);

      // Enrollment flag: is this course booked in TSS, and is it this exact section?
      const rb = bookedByCourse.get(group.key);
      const sameSection =
        rb?.section != null && plannedSectionId(rb.course, rb.section) === group.planned[0].id;

      const switchBtn = h("button", {
        class: "tsh-btn tsh-list-switch",
        text: "Switch",
        title: `Pick a different section of ${group.course.abbr}`,
        onClick: () => ctx.showSections(group.course),
      });
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

      const actionBits: Array<Node | string> = [];
      const busyLabel = booking.busy(group.course);
      if (busyLabel) actionBits.push(h("div", { class: "tsh-book-busy", text: busyLabel }));
      if (rb) {
        // Enrolled: one action — a real TSS drop that also removes the course from the plan.
        // No Switch/Book/plan-Drop on live enrollments.
        const enrolledSec = rb.section;
        if (enrolledSec && !busyLabel) {
          actionBits.push(
            h("button", {
              class: "tsh-btn tsh-btn-danger tsh-list-drop",
              text: "Drop from TSS",
              title: `Cancel your ${group.course.abbr} enrollment — also removes it from this plan`,
              onClick: () => booking.dropTss(rb.course, enrolledSec),
            }),
          );
        }
      } else {
        if (!busyLabel) {
          actionBits.push(
            h("button", {
              class: "tsh-btn tsh-book tsh-list-book",
              text: "Book",
              title: `Book ${group.planned[0].section.eventPkgText} in TSS now`,
              onClick: () => booking.book(group.course, group.planned[0].section),
            }),
          );
        }
        actionBits.push(switchBtn, dropBtn);
      }
      const bookErr = booking.error(group.course);
      if (bookErr) actionBits.push(h("div", { class: "tsh-book-err", text: `⚠ ${bookErr}` }));

      const rows = meetings.length > 0 ? meetings : [null];
      rows.forEach((m, idx) => {
        const tr = h("tr", { class: `tsh-list-row${idx === 0 ? " tsh-list-row-first" : ""}` });
        if (idx === 0) {
          const courseCell = h(
            "td",
            { class: "tsh-list-course", attrs: { rowspan: String(span) } },
            [group.course.abbr],
          );
          if (rb) {
            courseCell.append(
              h("span", {
                class: "tsh-list-flag",
                text: sameSection ? "✓ Enrolled" : "✓ Enrolled*",
                title: sameSection
                  ? "You are enrolled in this section in TSS"
                  : rb.section
                    ? `Enrolled in TSS, but in a different section (${rb.section.eventPkgText})`
                    : "Enrolled in TSS (section still being located)",
              }),
            );
          }
          tr.append(
            courseCell,
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
              class: `tsh-list-status${sameSection ? " tsh-list-status-enrolled" : ""}`,
              text: sameSection ? "Enrolled" : "Planned",
              attrs: { rowspan: String(span) },
            }),
            h(
              "td",
              { class: "tsh-list-action", attrs: { rowspan: String(span) } },
              actionBits,
            ),
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
    if (reason === "plans" || reason === "bookings") render();
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
.tsh-list-tba {
  color: #b45309;
  font-weight: 600;
}
.tsh-list-action {
  text-align: center;
  white-space: nowrap;
}
.tsh-list-switch {
  margin-right: 6px;
}
.tsh-list-drop {
  white-space: nowrap;
}
.tsh-list-book {
  margin-right: 6px;
}
.tsh-list-status-enrolled {
  color: #166534;
}
/* Enrollment flag under the course code ("✓ Enrolled"; * = a different section is booked). */
.tsh-list-flag {
  display: block;
  margin-top: 2px;
  font-size: 10px;
  font-weight: 700;
  color: #166534;
  white-space: nowrap;
}
`;
