import type { CourseSummary, Section } from "../api/types";
import type { Plan, PlannedSection, PlanStore } from "../model/plan";
import { plannedSectionId } from "../model/plan";

const PLANS_KEY = "tsshook:plans";
const ACTIVE_KEY = "tsshook:activePlanId";

type PlansRecord = Record<string, Plan>;

/** Read the whole plans record from chrome.storage.local. */
async function readPlans(): Promise<PlansRecord> {
  const res = await chrome.storage.local.get(PLANS_KEY);
  return (res[PLANS_KEY] as PlansRecord | undefined) ?? {};
}

async function writePlans(plans: PlansRecord): Promise<void> {
  await chrome.storage.local.set({ [PLANS_KEY]: plans });
}

async function readActiveId(): Promise<string | null> {
  const res = await chrome.storage.local.get(ACTIVE_KEY);
  return (res[ACTIVE_KEY] as string | undefined) ?? null;
}

async function writeActiveId(id: string | null): Promise<void> {
  if (id === null) {
    await chrome.storage.local.remove(ACTIVE_KEY);
  } else {
    await chrome.storage.local.set({ [ACTIVE_KEY]: id });
  }
}

function requirePlan(plans: PlansRecord, id: string): Plan {
  const plan = plans[id];
  if (!plan) {
    throw new Error(`Plan not found: ${id}`);
  }
  return plan;
}

export function createPlanStore(): PlanStore {
  return {
    async listPlans(): Promise<Plan[]> {
      const plans = await readPlans();
      return Object.values(plans).sort((a, b) => a.createdAt - b.createdAt);
    },

    async getPlan(id: string): Promise<Plan | null> {
      const plans = await readPlans();
      return plans[id] ?? null;
    },

    async createPlan(
      name: string,
      term: { year: string; period: string },
    ): Promise<Plan> {
      const plans = await readPlans();
      const now = Date.now();
      const plan: Plan = {
        id: crypto.randomUUID(),
        name,
        termYear: term.year,
        termPeriod: term.period,
        sections: [],
        createdAt: now,
        updatedAt: now,
      };
      plans[plan.id] = plan;
      await writePlans(plans);

      const activeId = await readActiveId();
      if (activeId === null) {
        await writeActiveId(plan.id);
      }
      return plan;
    },

    async renamePlan(id: string, name: string): Promise<Plan> {
      const plans = await readPlans();
      const plan = requirePlan(plans, id);
      plan.name = name;
      plan.updatedAt = Date.now();
      await writePlans(plans);
      return plan;
    },

    async deletePlan(id: string): Promise<void> {
      const plans = await readPlans();
      requirePlan(plans, id);
      delete plans[id];
      await writePlans(plans);

      const activeId = await readActiveId();
      if (activeId === id) {
        const remaining = Object.values(plans).sort(
          (a, b) => a.createdAt - b.createdAt,
        );
        await writeActiveId(remaining.length > 0 ? remaining[0].id : null);
      }
    },

    async addSection(
      planId: string,
      course: CourseSummary,
      section: Section,
    ): Promise<Plan> {
      const plans = await readPlans();
      const plan = requirePlan(plans, planId);
      const id = plannedSectionId(course, section);
      if (!plan.sections.some((s) => s.id === id)) {
        const planned: PlannedSection = {
          id,
          course,
          section,
          addedAt: Date.now(),
        };
        plan.sections.push(planned);
        plan.updatedAt = Date.now();
        await writePlans(plans);
      }
      return plan;
    },

    async removeSection(planId: string, sectionId: string): Promise<Plan> {
      const plans = await readPlans();
      const plan = requirePlan(plans, planId);
      const next = plan.sections.filter((s) => s.id !== sectionId);
      if (next.length !== plan.sections.length) {
        plan.sections = next;
        plan.updatedAt = Date.now();
        await writePlans(plans);
      }
      return plan;
    },

    async getActivePlanId(): Promise<string | null> {
      return readActiveId();
    },

    async setActivePlanId(id: string): Promise<void> {
      const plans = await readPlans();
      requirePlan(plans, id);
      await writeActiveId(id);
    },

    subscribe(listener: () => void): () => void {
      const handler = (
        changes: { [key: string]: chrome.storage.StorageChange },
        areaName: string,
      ): void => {
        if (areaName !== "local") return;
        if (PLANS_KEY in changes || ACTIVE_KEY in changes) {
          listener();
        }
      };
      chrome.storage.onChanged.addListener(handler);
      return () => chrome.storage.onChanged.removeListener(handler);
    },
  };
}
