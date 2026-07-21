import { conflictPairs } from "../model/planOps";
import type { PlannedSection } from "../model/plan";
import { h } from "./dom";

/**
 * A human-readable conflict list shared by the calendar and list tabs, e.g.
 *   ⚠ 2 conflicts
 *   Conflict: CHEM-7L Lab & CSE-103 Discussion
 * Returns null when there are no conflicts.
 */
export function conflictListEl(planned: PlannedSection[]): HTMLElement | null {
  const pairs = conflictPairs(planned);
  if (pairs.length === 0) return null;
  const box = h("div", { class: "tsh-conflicts" }, [
    h("div", {
      class: "tsh-conflicts-title",
      text: `⚠ ${pairs.length} time conflict${pairs.length > 1 ? "s" : ""}`,
    }),
  ]);
  for (const p of pairs) {
    box.append(
      h("div", { class: "tsh-conflict-line", text: `Conflict: ${p.a} & ${p.b}` }),
    );
  }
  return box;
}

export const CONFLICT_STYLES = `
.tsh-conflicts {
  border: 1px solid #fca5a5;
  background: #fef2f2;
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.tsh-conflicts-title {
  font-size: 12px;
  font-weight: 700;
  color: #b91c1c;
}
.tsh-conflict-line { font-size: 12px; color: #7f1d1d; }
`;
