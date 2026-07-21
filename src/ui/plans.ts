import type { AppContext } from "./context";
import { clear, h } from "./dom";

/** Saved-plan switcher: select active plan; create / rename / delete plans. */
export function createPlans(ctx: AppContext): { el: HTMLElement } {
  const select = h("select", {
    class: "tsh-in tsh-plan-select",
    onChange: () => {
      if (select.value) void ctx.store.setActivePlanId(select.value);
    },
  });

  const newBtn = h("button", {
    class: "tsh-btn",
    text: "New",
    onClick: () => {
      const name = window.prompt("Name for the new plan:", "New Plan");
      if (!name || !name.trim()) return;
      const t = ctx.getTerm();
      void ctx.store
        .createPlan(name.trim(), { year: t.year, period: t.period })
        .then((plan) => ctx.store.setActivePlanId(plan.id));
    },
  });

  const renameBtn = h("button", {
    class: "tsh-btn",
    text: "Rename",
    onClick: () => {
      const plan = ctx.getActivePlan();
      if (!plan) return;
      const name = window.prompt("Rename plan:", plan.name);
      if (!name || !name.trim()) return;
      void ctx.store.renamePlan(plan.id, name.trim());
    },
  });

  const delBtn = h("button", {
    class: "tsh-btn tsh-btn-danger",
    text: "Delete",
    onClick: () => {
      const plan = ctx.getActivePlan();
      if (!plan) return;
      if (!window.confirm(`Delete plan "${plan.name}"? This cannot be undone.`)) return;
      void ctx.store.deletePlan(plan.id);
    },
  });

  function render(): void {
    const plans = ctx.getPlans();
    const active = ctx.getActivePlanId();
    clear(select);
    if (plans.length === 0) {
      select.append(h("option", { value: "", text: "No plans yet" }));
      select.disabled = true;
    } else {
      select.disabled = false;
      for (const p of plans) {
        select.append(
          h("option", {
            value: p.id,
            text: `${p.name} (${p.sections.length})`,
            selected: p.id === active,
          }),
        );
      }
    }
    const hasPlans = plans.length > 0;
    renameBtn.disabled = !hasPlans;
    delBtn.disabled = !hasPlans;
  }

  ctx.subscribe((reason) => {
    if (reason === "plans") render();
  });

  render();

  const el = h("section", { class: "tsh-section" }, [
    h("div", { class: "tsh-label", text: "Plan" }),
    h("div", { class: "tsh-plan-row" }, [select, newBtn, renameBtn, delBtn]),
  ]);

  return { el };
}
