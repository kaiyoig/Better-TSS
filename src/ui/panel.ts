import type { TssClient } from "../api/tss";
import type { CourseSummary, Section, Term } from "../api/types";
import type { Plan, PlanStore } from "../model/plan";
import { CALENDAR_EXTRA_STYLES, createCalendar } from "./calendar";
import { CONFLICT_STYLES } from "./conflicts";
import type { AppContext, ChangeReason, ResolvedBooking } from "./context";
import { errorMessage } from "./util";
import { h } from "./dom";
import { FINALS_STYLES, createFinals } from "./finals";
import { LIST_STYLES, createList } from "./list";
import { createPlans } from "./plans";
import { createSearch } from "./search";
import { createSections } from "./sections";
import { STYLES } from "./styles";
import { TERM_PRESETS, createTermSelector, termFromYearPeriod } from "./term";

const HOST_ID = "tsshook-root";
const DEFAULT_TERM: Term = TERM_PRESETS[0];

type ViewKey = "list" | "calendar" | "finals";

// Tab bar + view styles (WebReg's List / Calendar / Finals tabs). Kept here since the tab shell
// is the panel's concern; each view ships its own content styles.
const TAB_STYLES = `
.tsh-tabs { display: flex; gap: 4px; margin-bottom: 12px; border-bottom: 2px solid #cbd5e1; }
.tsh-tab {
  font: inherit;
  font-weight: 600;
  padding: 7px 16px;
  border: 1px solid #cbd5e1;
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  background: #e2e8f0;
  color: #475569;
  cursor: pointer;
  margin-bottom: -2px;
}
.tsh-tab:hover { background: #eef2ff; }
.tsh-tab-active {
  background: #f4f6fb;
  color: #1d4ed8;
  border-color: #cbd5e1;
  border-bottom: 2px solid #f4f6fb;
}
.tsh-view-hidden { display: none; }
`;

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

  // ---- live enrollments ----
  // Fetched once on mount and re-fetched after every Book/Drop. The booked-modules feed names
  // only the course, so each row is then resolved to its catalog section (a sections read +
  // per-section live-status probes) for calendar placement; resolutions are cached by booking id.
  let bookings: ResolvedBooking[] = [];
  const locatedSections = new Map<string, Section>(); // ModregId → located section
  let bookingsRefreshing = false;
  let bookingsRefreshQueued = false;

  async function refreshBookings(): Promise<void> {
    if (bookingsRefreshing) {
      // A Book/Drop landed mid-refresh — run once more when this pass finishes.
      bookingsRefreshQueued = true;
      return;
    }
    bookingsRefreshing = true;
    try {
      const rows = await client.listBookings();
      bookings = rows.map((b) => ({
        booking: b,
        course: {
          year: b.year,
          period: b.period,
          moduleID: b.moduleID,
          dept: b.abbr.split("-")[0] ?? b.abbr,
          abbr: b.abbr,
          title: b.title,
          units: b.units,
          level: "",
        },
        section: locatedSections.get(b.modregId) ?? null,
        pending: !locatedSections.has(b.modregId),
      }));
      emit("bookings");

      const unresolved = bookings.filter((rb) => rb.pending);
      await Promise.all(
        unresolved.map(async (rb) => {
          try {
            const { section } = await client.locateBookedSection(rb.booking);
            locatedSections.set(rb.booking.modregId, section);
            rb.section = section;
          } catch (err) {
            rb.error = errorMessage(err);
          }
          rb.pending = false;
        }),
      );
      // One emit for the whole resolution round — subscribers (sections view) re-poll live
      // status on each "bookings", so per-row emits would fan out into redundant request sweeps.
      if (unresolved.length > 0) emit("bookings");
    } catch {
      // Enrollments are an overlay — if the feed fails (expired session, service hiccup) the
      // planner still works, so fail silent and keep whatever we showed last.
    } finally {
      bookingsRefreshing = false;
      if (bookingsRefreshQueued) {
        bookingsRefreshQueued = false;
        void refreshBookings();
      }
    }
  }

  // Late-bound: `sections` is created below, after ctx. Reassigned once it exists.
  let showSectionsImpl: (course: CourseSummary) => void = () => {};

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
    showSections: (course) => showSectionsImpl(course),
    notifyBookingsChanged: () => void refreshBookings(),
    getBookings: () => bookings,
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
  style.textContent = [
    STYLES,
    TAB_STYLES,
    CONFLICT_STYLES,
    CALENDAR_EXTRA_STYLES,
    LIST_STYLES,
    FINALS_STYLES,
  ].join("\n");

  const wrap = h("div", { class: "tsh-wrap" });

  const toggle = h("button", {
    class: "tsh-toggle",
    title: "Open the WebReg-style planner",
    onClick: () => wrap.classList.toggle("open"),
  }, ["📅 Planner"]);

  const header = h("div", { class: "tsh-header" }, [
    h("span", { class: "tsh-title", text: "Better TSS · Planner" }),
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
  const list = createList(ctx);
  const finals = createFinals(ctx);
  const sections = createSections(ctx);
  const search = createSearch(ctx, (course) => {
    sections.load(course);
    sections.el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  // Now that `sections` exists, back the context's showSections with it. Ensure the drawer is open
  // (a Switch click may come from a view while the panel is somehow collapsed) before scrolling.
  showSectionsImpl = (course) => {
    wrap.classList.add("open");
    sections.load(course);
    sections.el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  // Right column is a WebReg-style tabbed view: List / Calendar / Finals. Each view self-renders
  // on plan changes; the tabs just show one at a time.
  const viewEls: Record<ViewKey, HTMLElement> = {
    list: list.el,
    calendar: calendar.el,
    finals: finals.el,
  };
  const tabDefs: Array<{ key: ViewKey; label: string }> = [
    { key: "list", label: "List" },
    { key: "calendar", label: "Calendar" },
    { key: "finals", label: "Finals" },
  ];
  let activeView: ViewKey = "calendar";
  const tabButtons = new Map<ViewKey, HTMLButtonElement>();
  const setView = (k: ViewKey): void => {
    activeView = k;
    for (const key of Object.keys(viewEls) as ViewKey[]) {
      viewEls[key].classList.toggle("tsh-view-hidden", key !== activeView);
    }
    for (const [key, btn] of tabButtons) {
      btn.classList.toggle("tsh-tab-active", key === activeView);
    }
  };
  const tabBar = h("div", { class: "tsh-tabs" });
  for (const def of tabDefs) {
    const btn = h("button", {
      class: "tsh-tab",
      text: def.label,
      onClick: () => setView(def.key),
    });
    tabButtons.set(def.key, btn);
    tabBar.append(btn);
  }

  // Two columns on wide screens: browse controls on the left, the tabbed schedule (which
  // benefits most from width) on the right. Collapses to a single stacked column when narrow.
  const leftCol = h("div", { class: "tsh-col tsh-col-left" }, [
    termSelector.el,
    plansSwitcher.el,
    search.el,
    sections.el,
  ]);
  const rightCol = h("div", { class: "tsh-col tsh-col-right" }, [
    tabBar,
    list.el,
    calendar.el,
    finals.el,
  ]);
  setView(activeView);
  const content = h("div", { class: "tsh-content" }, [leftCol, rightCol]);

  const drawer = h("div", { class: "tsh-drawer" }, [header, content]);
  wrap.append(toggle, drawer);
  shadow.append(style, wrap);
  document.body.append(host);

  // ---- wire persistence ----
  store.subscribe(() => {
    void reload();
  });

  // ---- initial load ----
  void refreshBookings(); // enrollments overlay: fetch + resolve in the background
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
