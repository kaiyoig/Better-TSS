import type { Meeting } from "./types";

const DAY_TOKENS = ["Su", "M", "Tu", "W", "Th", "F", "Sa"];

/**
 * Parse the TSS `Sched` string into structured meetings.
 *
 * Examples seen in the HAR:
 *   "M, W, F 11:00 AM - 11:50 AM In Person @ Pepper Canyon Hall Room 106\n
 *    Final Examination 12/08/2026 11:30 AM - 02:29 PM In Person"
 *   "M 04:00 PM - 04:50 PM In Person @ Pepper Canyon Hall Room 106"
 *
 * The string is a best-effort human format, so this parser is intentionally forgiving:
 * anything it can't classify is preserved in `raw` on a passthrough meeting.
 */
export function parseSched(
  sched: string,
  base: Pick<
    Meeting,
    "method" | "methodText" | "instructor" | "instructorEmail"
  >,
): Meeting[] {
  const lines = sched
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.map((line) => parseLine(line, base));
}

const TIME = /(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i;

function parseLine(
  line: string,
  base: Pick<
    Meeting,
    "method" | "methodText" | "instructor" | "instructorEmail"
  >,
): Meeting {
  const isFinal = /final\s+exam/i.test(line);

  const time = line.match(TIME);
  const start = time ? normTime(time[1]) : null;
  const end = time ? normTime(time[2]) : null;

  // Days precede the time range (skip the "Final Examination MM/DD/YYYY" date prefix).
  let days: string[] = [];
  if (!isFinal && time) {
    days = extractDays(line.slice(0, time.index ?? 0));
  }

  // Location is whatever follows "@".
  const atIdx = line.indexOf("@");
  const location = atIdx >= 0 ? line.slice(atIdx + 1).trim() : null;

  // Mode ("In Person" / "Remote" / ...) sits between the time range and the "@".
  let mode: string | null = null;
  if (time) {
    const afterTime = line.slice(
      (time.index ?? 0) + time[0].length,
      atIdx >= 0 ? atIdx : undefined,
    );
    mode = afterTime.trim() || null;
  }

  return {
    ...base,
    days,
    start,
    end,
    mode,
    location,
    isFinal,
    raw: line,
  };
}

function extractDays(prefix: string): string[] {
  // A genuine weekly day prefix is ONLY day tokens + separators, e.g. "M, W, F" or "TuTh".
  // If anything else appears (e.g. "Midterm Examination 10/20/2026"), it's a one-off dated event,
  // not a weekly meeting — return no days so it never lands on the weekly grid.
  const compact = prefix.replace(/[\s,]+/g, "");
  const out: string[] = [];
  let i = 0;
  while (i < compact.length) {
    // Longest-token-first via DAY_TOKENS order ("Tu"/"Th" before single letters, "Su"/"Sa").
    const tok = DAY_TOKENS.find((d) => compact.startsWith(d, i));
    if (!tok) return []; // non-day content → not a weekly meeting
    out.push(tok);
    i += tok.length;
  }
  return out;
}

function normTime(t: string): string {
  return t.replace(/\s+/g, " ").toUpperCase().trim();
}
