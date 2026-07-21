import type { CourseSummary, Meeting, Section } from "../api/types";
import type { PlannedSection } from "./plan";

// Pure scheduling utilities shared by Phase 2 and Phase 3. No DOM, no chrome APIs.
// Frozen contract — do not change signatures without updating both consumers.

export const DAY_ORDER = ["Su", "M", "Tu", "W", "Th", "F", "Sa"] as const;
export type Day = (typeof DAY_ORDER)[number];

/** Parse a "11:00 AM" / "02:29 PM" clock string to minutes since midnight, or null. */
export function timeToMinutes(t: string | null): number | null {
  if (!t) return null;
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*([AP])M$/i);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === "P") h += 12;
  return h * 60 + Number(m[2]);
}

export interface TimeBlock {
  day: Day;
  start: number; // minutes since midnight
  end: number;
}

/** Expand a meeting into concrete day/time blocks. Final exams and un-timed rows yield none. */
export function meetingBlocks(meeting: Meeting): TimeBlock[] {
  if (meeting.isFinal) return [];
  const start = timeToMinutes(meeting.start);
  const end = timeToMinutes(meeting.end);
  if (start == null || end == null) return [];
  return meeting.days
    .filter((d): d is Day => (DAY_ORDER as readonly string[]).includes(d))
    .map((day) => ({ day, start, end }));
}

/** All weekly blocks for a section (across its meetings). */
export function sectionBlocks(section: Section): TimeBlock[] {
  return section.meetings.flatMap(meetingBlocks);
}

function blocksOverlap(a: TimeBlock, b: TimeBlock): boolean {
  return a.day === b.day && a.start < b.end && b.start < a.end;
}

/** True if two sections have any overlapping weekly meeting block. */
export function sectionsConflict(a: Section, b: Section): boolean {
  const ba = sectionBlocks(a);
  const bb = sectionBlocks(b);
  return ba.some((x) => bb.some((y) => blocksOverlap(x, y)));
}

export interface Conflict {
  a: string; // PlannedSection id
  b: string; // PlannedSection id
}

/** Find every pairwise time conflict among planned sections. */
export function findConflicts(planned: PlannedSection[]): Conflict[] {
  const out: Conflict[] = [];
  for (let i = 0; i < planned.length; i++) {
    for (let j = i + 1; j < planned.length; j++) {
      if (sectionsConflict(planned[i].section, planned[j].section)) {
        out.push({ a: planned[i].id, b: planned[j].id });
      }
    }
  }
  return out;
}

/** Set of PlannedSection ids that participate in at least one conflict. */
export function conflictedIds(planned: PlannedSection[]): Set<string> {
  const ids = new Set<string>();
  for (const c of findConflicts(planned)) {
    ids.add(c.a);
    ids.add(c.b);
  }
  return ids;
}

/** Sum of course units (CreditsDisplay parsed as float). */
export function totalUnits(courses: Array<Pick<CourseSummary, "units">>): number {
  return courses.reduce((sum, c) => {
    const n = parseFloat(c.units);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
}
