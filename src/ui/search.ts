import { normalizeCourseQuery } from "../api/courseCode";
import type { CourseSummary } from "../api/types";
import type { AppContext } from "./context";
import { clear, h } from "./dom";
import { errorMessage } from "./util";

const DEBOUNCE_MS = 350;
const MIN_QUERY = 2;

/** Course search box: debounced full-text search against the current term. */
export function createSearch(
  ctx: AppContext,
  onSelect: (course: CourseSummary) => void,
): { el: HTMLElement } {
  const input = h("input", {
    class: "tsh-in tsh-search-in",
    type: "search",
    placeholder: "Search courses (e.g. CHEM 7L, CSE 103, calculus)…",
  });
  const status = h("div", { class: "tsh-status" });
  const results = h("div", { class: "tsh-results" });

  let timer: number | undefined;
  let reqId = 0;

  function row(c: CourseSummary): HTMLElement {
    return h("button", { class: "tsh-course-row", onClick: () => onSelect(c) }, [
      h("div", { class: "tsh-course-top" }, [
        h("span", { class: "tsh-course-abbr", text: c.abbr }),
        h("span", { class: "tsh-course-units", text: `${c.units} units` }),
      ]),
      h("div", { class: "tsh-course-title", text: c.title }),
      h("div", { class: "tsh-course-sub", text: `${c.dept} · ${c.level}` }),
    ]);
  }

  async function run(raw: string): Promise<void> {
    // Normalize course-code-like input (e.g. "CHEM 7L" → "CHEM-007L"); titles pass through.
    const query = normalizeCourseQuery(raw);
    const myReq = ++reqId;
    clear(results);
    if (query.length < MIN_QUERY) {
      status.textContent = "";
      return;
    }
    status.textContent = query === raw.trim() ? "Searching…" : `Searching “${query}”…`;
    try {
      const res = await ctx.client.searchCourses({ term: ctx.getTerm(), query });
      if (myReq !== reqId) return; // a newer search superseded this one
      if (res.courses.length === 0) {
        status.textContent = "No courses found for this term.";
        return;
      }
      status.textContent = `Showing ${res.courses.length} of ${res.count} result(s)`;
      for (const c of res.courses) results.append(row(c));
      // A single match is almost certainly the intended course — load its sections immediately.
      if (res.courses.length === 1) onSelect(res.courses[0]);
    } catch (err) {
      if (myReq !== reqId) return;
      status.className = "tsh-status";
      results.append(h("div", { class: "tsh-error", text: errorMessage(err) }));
      status.textContent = "";
    }
  }

  input.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void run(input.value), DEBOUNCE_MS);
  });
  input.addEventListener("keydown", (ev) => {
    if ((ev as KeyboardEvent).key === "Enter") {
      window.clearTimeout(timer);
      void run(input.value);
    }
  });

  // Re-run (or clear) when the term changes.
  ctx.subscribe((reason) => {
    if (reason !== "term") return;
    if (input.value.trim().length >= MIN_QUERY) void run(input.value);
    else {
      clear(results);
      status.textContent = "";
    }
  });

  const el = h("section", { class: "tsh-section" }, [
    h("div", { class: "tsh-label", text: "Course search" }),
    input,
    status,
    results,
  ]);

  return { el };
}
