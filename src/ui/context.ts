import type { TssClient } from "../api/tss";
import type { CourseSummary, Term } from "../api/types";
import type { Plan, PlanStore } from "../model/plan";

// Shared read surface passed to every UI component. The panel owns the mutable state and
// implements this; components read through the getters and re-render on `subscribe`.
//
// Two change channels are multiplexed through one listener:
//   "plans" — the PlanStore changed (plan list / active plan / a plan's sections).
//   "term"  — the browsing term changed (term selector or an active-plan switch).

export type ChangeReason = "plans" | "term";

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
  /** Subscribe to state changes; returns an unsubscribe fn. */
  subscribe(listener: (reason: ChangeReason) => void): () => void;
}
