import type { TssClient } from "../api/tss";
import type { Booking, CourseSummary, Section, Term } from "../api/types";
import type { Plan, PlanStore } from "../model/plan";

// Shared read surface passed to every UI component. The panel owns the mutable state and
// implements this; components read through the getters and re-render on `subscribe`.
//
// Three change channels are multiplexed through one listener:
//   "plans"    — the PlanStore changed (plan list / active plan / a plan's sections).
//   "term"     — the browsing term changed (term selector or an active-plan switch).
//   "bookings" — a live TSS enrollment was created or dropped (Book/Drop actions).

export type ChangeReason = "plans" | "term" | "bookings";

/**
 * A live TSS enrollment enriched for display. The booked-modules feed names only the course, so
 * the panel resolves each booking to its catalog section (needed for calendar meetings) in the
 * background; `section` stays null while `pending` and if the sweep failed.
 */
export interface ResolvedBooking {
  booking: Booking;
  /** CourseSummary reconstructed from the booking row — enough for views + the sections browser. */
  course: CourseSummary;
  section: Section | null;
  pending: boolean;
  error?: string;
}

export interface AppContext {
  readonly client: TssClient;
  readonly store: PlanStore;
  /** The term currently used for course search. */
  getTerm(): Term;
  /** Update the browsing term (emits "term"). */
  setTerm(term: Term): void;
  /** Snapshot of all saved plans (sorted by creation). */
  getPlans(): Plan[];
  getActivePlanId(): string | null;
  getActivePlan(): Plan | null;
  /** Open the sections browser for a course and scroll to it (drives the "Switch" buttons). */
  showSections(course: CourseSummary): void;
  /** Announce that a live enrollment changed; the panel re-reads TSS and emits "bookings". */
  notifyBookingsChanged(): void;
  /** Snapshot of the student's live TSS enrollments (empty until the background fetch lands). */
  getBookings(): ResolvedBooking[];
  /** Subscribe to state changes; returns an unsubscribe fn. */
  subscribe(listener: (reason: ChangeReason) => void): () => void;
}
