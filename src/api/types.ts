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
  /** EventPkgObjid, e.g. "154425" — the numeric EventPackageId the booking service is keyed by. */
  pkgObjid: string;
  limit: number;
  seatsAvailable: number;
  waitlist: number;
  capacity: CapacityColor;
  meetings: Meeting[];
}

/**
 * Real-time enrollment status for one section, read from the booking service
 * (`PR_MY_MODULES_V2_SRV`, see RECON.md). Distinct from the catalog snapshot on `Section`: it
 * carries the registration window and live waitlist detail the catalog doesn't expose.
 */
export interface LiveStatus {
  openSeats: number;
  openSeatsWaitlist: number;
  statusText: string; // SmStatusText, e.g. "Waitlist Inactive" / "Booked"
  waitlistBooking: boolean;
  onWishList: boolean;
  registrationBegin: Date | null;
  registrationEnd: Date | null;
  /** True when the signed-in student is enrolled in this section (SmStatus "01" / real ModregId). */
  booked: boolean;
  /** The enrollment guid when booked, else null. */
  modregId: string | null;
}

export interface CourseDetail extends CourseSummary {
  sections: Section[];
}

/**
 * One live enrollment from the booked-modules service (`BC_OVP_BOOKED_MODULES_SRV/ModuleSet`).
 * Note it identifies the *course* (module) but not which section — locating the booked section
 * takes a catalog + live-status sweep (see `TssClient.locateBookedSection`).
 */
export interface Booking {
  /** The booking guid (`ModregId`); non-zero means an actual enrollment exists. */
  modregId: string;
  /** Module ID with SAP's zero-padding stripped, e.g. "8366" — catalog-compatible. */
  moduleID: string;
  /** AcademicYear, e.g. "2026". */
  year: string;
  /** AcademicPeriod with padding stripped ("2"), catalog-compatible. */
  period: string;
  abbr: string; // SmShort, e.g. "MUS-008"
  title: string; // SmStext
  units: string; // Credits, e.g. "4.00"
  termText: string; // "Fall Quarter 2026/2027"
  conditional: boolean;
}
