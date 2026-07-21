import type { TssClient } from "../api/tss";
import type { Term } from "../api/types";
import type { Plan, PlanStore } from "../model/plan";
import { createCalendar } from "./calendar";
import type { AppContext, ChangeReason } from "./context";
import { h } from "./dom";
import { createPlans } from "./plans";
import { createSearch } from "./search";
import { createSections } from "./sections";
import { STYLES } from "./styles";
import { TERM_PRESETS, createTermSelector, termFromYearPeriod } from "./term";

const HOST_ID = "tsshook-root";
const DEFAULT_TERM: Term = TERM_PRESETS[0];

/** Imperative handle returned by mountPanel, so external triggers (toolbar icon) can drive it. */
export interface PanelHandle {
  toggle(): void;
  open(): void;
  close(): void;
}

/**
 * Mount the self-contained planner overlay: a Shadow DOM host on <body>, a floating toggle,
 * and a sliding drawer. The panel owns all app state and implements AppContext; components read
 * through it and re-render on subscribe. PlanStore is the single source of truth for plans — its
 * `subscribe` drives a reload → re-render, so mutations from any component flow back uniformly.
 */
export function mountPanel(client: TssClient, store: PlanStore): PanelHandle {
  // Guard against double injection; hand back a handle bound to the existing instance if present.
  const existing = (window as unknown as { __tsshookPanel?: PanelHandle }).__tsshookPanel;
  if (document.getElementById(HOST_ID)) {
    return existing ?? { toggle() {}, open() {}, close() {} };
  }

  // ---- state ----
  let term: Term = DEFAULT_TERM;
  let plans: Plan[] = [];
  let activePlanId: string | null = null;
  const listeners = new Set<(reason: ChangeReason) => void>();

  const emit = (reason: ChangeReason): void => {
    for (const l of listeners) l(reason);
  };

  const ctx: AppContext = {
    client,
    store,
    getTerm: () => term,
    setTerm: (t) => {
      term = t;
      emit("term");
    },
    getPlans: () => plans,
    getActivePlanId: () => activePlanId,
    getActivePlan: () => plans.find((p) => p.id === activePlanId) ?? null,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  async function reload(): Promise<void> {
    plans = await store.listPlans();
    const nextActive = await store.getActivePlanId();
    const activeChanged = nextActive !== activePlanId;
    activePlanId = nextActive;
    emit("plans");
    if (activeChanged) {
      const plan = ctx.getActivePlan();
      if (plan) ctx.setTerm(termFromYearPeriod(plan.termYear, plan.termPeriod));
    }
  }

  // ---- shadow host ----
  const host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = STYLES;

  const wrap = h("div", { class: "tsh-wrap" });

  const toggle = h("button", {
    class: "tsh-toggle",
    title: "Open the WebReg-style planner",
    onClick: () => wrap.classList.toggle("open"),
  }, ["📅 Planner"]);

  const header = h("div", { class: "tsh-header" }, [
    h("span", { class: "tsh-title", text: "TSS Hook · Planner" }),
    h("button", {
      class: "tsh-close",
      title: "Close",
      onClick: () => wrap.classList.remove("open"),
    }, ["×"]),
  ]);

  // ---- components ----
  const termSelector = createTermSelector(ctx);
  const plansSwitcher = createPlans(ctx);
  const calendar = createCalendar(ctx);
  const sections = createSections(ctx);
  const search = createSearch(ctx, (course) => {
    sections.load(course);
    sections.el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  const content = h("div", { class: "tsh-content" }, [
    termSelector.el,
    plansSwitcher.el,
    search.el,
    sections.el,
    calendar.el,
  ]);

  const drawer = h("div", { class: "tsh-drawer" }, [header, content]);
  wrap.append(toggle, drawer);
  shadow.append(style, wrap);
  document.body.append(host);

  // ---- wire persistence ----
  store.subscribe(() => {
    void reload();
  });

  // ---- initial load ----
  void (async () => {
    await reload();
    if (plans.length === 0) {
      // Seed a starter plan so the calendar / Add-to-plan work immediately.
      const plan = await store.createPlan("My Schedule", {
        year: term.year,
        period: term.period,
      });
      await store.setActivePlanId(plan.id); // triggers reload via store.subscribe
    } else if (activePlanId === null) {
      await store.setActivePlanId(plans[0].id);
    }
  })();

  const handle: PanelHandle = {
    toggle: () => wrap.classList.toggle("open"),
    open: () => wrap.classList.add("open"),
    close: () => wrap.classList.remove("open"),
  };
  (window as unknown as { __tsshookPanel?: PanelHandle }).__tsshookPanel = handle;
  return handle;
}
