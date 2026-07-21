import type { CourseSummary, Meeting } from "../api/types";
import type { Plan, PlannedSection, PlanStore } from "./plan";
import type { Day } from "./schedule";
import { meetingBlocks, timeToMinutes } from "./schedule";

// Shared operations over a plan's sections: grouping by course, dropping a whole course, and
// extracting final-exam info. Used by the calendar, list, and finals views. Frozen contract —
// coordinate before changing a signature.

/** Stable per-course key: a course's LE/DI/LA parts all share it. */
export function courseKey(
  c: Pick<CourseSummary, "year" | "period" | "moduleID">,
): string {
  return `${c.year}-${c.period}-${c.moduleID}`;
}

export interface CourseGroup {
  key: string;
  course: CourseSummary;
  /** Every planned section belonging to this course. */
  planned: PlannedSection[];
}

/** Group planned sections by course, preserving first-seen order. */
export function groupByCourse(planned: PlannedSection[]): CourseGroup[] {
  const map = new Map<string, CourseGroup>();
  for (const ps of planned) {
    const key = courseKey(ps.course);
    let g = map.get(key);
    if (!g) {
      g = { key, course: ps.course, planned: [] };
      map.set(key, g);
    }
    g.planned.push(ps);
  }
  return [...map.values()];
}

/**
 * Drop an entire course: remove every planned section that belongs to it. Dropping one part
 * (lecture/discussion/lab) removes them all, matching the requirement that a course is atomic.
 */
export async function dropCourse(
  store: PlanStore,
  planId: string,
  key: string,
): Promise<void> {
  const plan: Plan | null = await store.getPlan(planId);
  if (!plan) return;
  const ids = plan.sections
    .filter((ps) => courseKey(ps.course) === key)
    .map((ps) => ps.id);
  for (const id of ids) {
    await store.removeSection(planId, id);
  }
}

// ---- finals ----

export interface FinalInfo {
  meeting: Meeting;
  /** "MM/DD/YYYY" pulled from the meeting's raw Sched text, or null. */
  date: string | null;
  /** Weekday derived from `date`, or null if unparseable. */
  day: Day | null;
  start: string | null;
  end: string | null;
}

const DATE_RE = /(\d{1,2})\/(\d{1,2})\/(\d{4})/;
const JS_DAY_TO_TOKEN: Day[] = ["Su", "M", "Tu", "W", "Th", "F", "Sa"];

/** Parse a final-exam meeting's date/weekday/time out of its raw Sched text. */
export function parseFinal(meeting: Meeting): FinalInfo {
  const m = meeting.raw.match(DATE_RE);
  let date: string | null = null;
  let day: Day | null = null;
  if (m) {
    date = `${m[1]}/${m[2]}/${m[3]}`;
    const d = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
    day = Number.isNaN(d.getTime()) ? null : (JS_DAY_TO_TOKEN[d.getDay()] ?? null);
  }
  return { meeting, date, day, start: meeting.start, end: meeting.end };
}

export interface CourseFinal {
  course: CourseSummary;
  final: FinalInfo;
}

/** All final-exam meetings across planned sections, paired with their course. */
export function finalMeetings(planned: PlannedSection[]): CourseFinal[] {
  const out: CourseFinal[] = [];
  for (const ps of planned) {
    for (const mt of ps.section.meetings) {
      if (mt.isFinal) out.push({ course: ps.course, final: parseFinal(mt) });
    }
  }
  return out;
}

export interface CourseExam {
  course: CourseSummary;
  exam: FinalInfo; // date/day/start/end parsed from a one-off dated meeting
}

/** One-off dated exams that are NOT weekly meetings and NOT finals (e.g. midterms). */
export function datedExams(planned: PlannedSection[]): CourseExam[] {
  const out: CourseExam[] = [];
  for (const ps of planned) {
    for (const m of ps.section.meetings) {
      if (m.isFinal || m.days.length > 0) continue; // finals have their own view; weekly = a class
      const info = parseFinal(m);
      if (info.date == null) continue; // must have a real date to be a dated exam
      out.push({ course: ps.course, exam: info });
    }
  }
  return out;
}

/**
 * Weekly meetings (lecture/discussion/lab) of OTHER courses that clash with a dated exam:
 * same weekday as the exam plus an overlapping time window. Returns "ABBR Part" labels.
 */
export function examConflicts(
  exam: FinalInfo,
  planned: PlannedSection[],
  selfCourseKey: string,
): string[] {
  const s = timeToMinutes(exam.start);
  const e = timeToMinutes(exam.end);
  if (exam.day == null || s == null || e == null) return [];
  const labels = new Set<string>();
  for (const ps of planned) {
    if (courseKey(ps.course) === selfCourseKey) continue;
    for (const m of ps.section.meetings) {
      for (const b of meetingBlocks(m)) {
        if (b.day === exam.day && s < b.end && b.start < e) {
          labels.add(`${ps.course.abbr} ${m.methodText || m.method}`);
        }
      }
    }
  }
  return [...labels];
}
