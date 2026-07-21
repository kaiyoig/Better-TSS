// Normalized domain model. Raw OData rows (see RECON.md) are mapped into these shapes so the
// planning UI never touches SAP field names directly.

export interface Term {
  /** AcademicYear, e.g. "2026" */
  year: string;
  /** AcademicPeriod code, e.g. "2" (Fall Quarter) */
  period: string;
  /** AcYearText filter value, e.g. "2026/2027" */
  yearText: string;
  /** AcademicPeriodText filter value, e.g. "Fall Quarter" */
  periodText: string;
}

export interface CourseSummary {
  year: string;
  period: string;
  moduleID: string;
  dept: string; // DepartmentAbbr, e.g. "CSE"
  abbr: string; // CourseAbbr, e.g. "CSE-103"
  title: string;
  units: string; // CreditsDisplay, e.g. "4.00"
  level: string; // AcademicLevel, e.g. "Upper Division"
}

export type CapacityColor = "green" | "yellow" | "red" | "unknown";

/** One scheduled meeting: a lecture/discussion/lab occurrence or a final exam. */
export interface Meeting {
  method: string; // "LE" | "DI" | "LA" | ...
  methodText: string; // "Lecture" | "Discussion" | ...
  days: string[]; // ["M","W","F"]
  start: string | null; // "11:00 AM"
  end: string | null; // "11:50 AM"
  mode: string | null; // "In Person" | "Remote" | ...
  location: string | null; // "Pepper Canyon Hall Room 106"
  instructor: string | null;
  instructorEmail: string | null;
  isFinal: boolean;
  /** Original unparsed Sched string, kept for display fallback. */
  raw: string;
}

export interface Section {
  eventPkgText: string; // "CSE-103 (P-001-001)"
  limit: number;
  seatsAvailable: number;
  waitlist: number;
  capacity: CapacityColor;
  meetings: Meeting[];
}

export interface CourseDetail extends CourseSummary {
  sections: Section[];
}
