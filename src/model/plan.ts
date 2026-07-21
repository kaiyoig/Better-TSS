import type { CourseSummary, Section } from "../api/types";

// Shared contract between the persistence layer (Phase 2) and the planner UI (Phase 3).
// Neither agent should change this file without the other; treat it as frozen.

export interface PlannedSection {
  /** Stable id: `${year}-${period}-${moduleID}::${section.eventPkgText}`. */
  id: string;
  course: CourseSummary;
  section: Section;
  addedAt: number;
}

export interface Plan {
  id: string;
  name: string;
  termYear: string; // AcademicYear, e.g. "2026"
  termPeriod: string; // AcademicPeriod, e.g. "2"
  sections: PlannedSection[];
  createdAt: number;
  updatedAt: number;
}

/** Compose the canonical PlannedSection id from a course + section. */
export function plannedSectionId(
  course: Pick<CourseSummary, "year" | "period" | "moduleID">,
  section: Pick<Section, "eventPkgText">,
): string {
  return `${course.year}-${course.period}-${course.moduleID}::${section.eventPkgText}`;
}

/**
 * Persistence surface for named schedule plans, backed by `chrome.storage.local`.
 * Implemented by the Phase 2 agent (`src/storage/planStore.ts`, exporting
 * `createPlanStore(): PlanStore`). Consumed by the Phase 3 UI.
 */
export interface PlanStore {
  listPlans(): Promise<Plan[]>;
  getPlan(id: string): Promise<Plan | null>;
  createPlan(
    name: string,
    term: { year: string; period: string },
  ): Promise<Plan>;
  renamePlan(id: string, name: string): Promise<Plan>;
  deletePlan(id: string): Promise<void>;
  addSection(
    planId: string,
    course: CourseSummary,
    section: Section,
  ): Promise<Plan>;
  removeSection(planId: string, sectionId: string): Promise<Plan>;
  getActivePlanId(): Promise<string | null>;
  setActivePlanId(id: string): Promise<void>;
  /** Subscribe to any change; returns an unsubscribe fn. */
  subscribe(listener: () => void): () => void;
}
