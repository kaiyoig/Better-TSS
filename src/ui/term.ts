import type { Term } from "../api/types";
import type { AppContext } from "./context";
import { h } from "./dom";

// The TSS term value-help endpoints returned empty in recon, so we ship a small set of known /
// best-guess presets and let every field be hand-edited. Only the Fall 2026 preset is confirmed
// from the HAR; the AcademicPeriod codes for other quarters are guesses (recon: 2 = Fall), which
// is exactly why the raw fields below stay editable.

export const TERM_PRESETS: Term[] = [
  { year: "2026", period: "2", yearText: "2026/2027", periodText: "Fall Quarter" },
  { year: "2027", period: "3", yearText: "2026/2027", periodText: "Winter Quarter" },
  { year: "2027", period: "4", yearText: "2026/2027", periodText: "Spring Quarter" },
];

const PERIOD_NAMES: Record<string, string> = {
  "1": "Summer Session",
  "2": "Fall Quarter",
  "3": "Winter Quarter",
  "4": "Spring Quarter",
};

/** Reconstruct a full Term from a plan's stored (year, period). Prefers a matching preset. */
export function termFromYearPeriod(year: string, period: string): Term {
  const preset = TERM_PRESETS.find((t) => t.year === year && t.period === period);
  if (preset) return preset;
  const startYear = Number(year);
  const yearText = Number.isFinite(startYear) ? `${startYear}/${startYear + 1}` : year;
  return { year, period, yearText, periodText: PERIOD_NAMES[period] ?? "" };
}

export function createTermSelector(ctx: AppContext): { el: HTMLElement } {
  const yearIn = h("input", { class: "tsh-in", attrs: { "aria-label": "Academic year" } });
  const periodIn = h("input", { class: "tsh-in", attrs: { "aria-label": "Academic period" } });
  const yearTextIn = h("input", { class: "tsh-in", attrs: { "aria-label": "Year text" } });
  const periodTextIn = h("input", { class: "tsh-in", attrs: { "aria-label": "Period text" } });

  const preset = h(
    "select",
    { class: "tsh-in tsh-term-presets" },
    [
      h("option", { value: "", text: "Presets / custom…" }),
      ...TERM_PRESETS.map((t, i) =>
        h("option", { value: String(i), text: `${t.periodText} — ${t.yearText}` }),
      ),
    ],
  );

  function readInputs(): Term {
    return {
      year: yearIn.value.trim(),
      period: periodIn.value.trim(),
      yearText: yearTextIn.value.trim(),
      periodText: periodTextIn.value.trim(),
    };
  }

  function fill(t: Term): void {
    yearIn.value = t.year;
    periodIn.value = t.period;
    yearTextIn.value = t.yearText;
    periodTextIn.value = t.periodText;
  }

  const onEdit = (): void => {
    preset.value = "";
    ctx.setTerm(readInputs());
  };
  for (const input of [yearIn, periodIn, yearTextIn, periodTextIn]) {
    input.addEventListener("change", onEdit);
  }

  preset.addEventListener("change", () => {
    const t = TERM_PRESETS[Number(preset.value)];
    if (t) {
      fill(t);
      ctx.setTerm(t);
    }
  });

  fill(ctx.getTerm());

  // Reflect external term changes (e.g. switching to a plan saved in another term).
  ctx.subscribe((reason) => {
    if (reason === "term") fill(ctx.getTerm());
  });

  const field = (labelText: string, input: HTMLElement): HTMLElement =>
    h("label", { class: "tsh-field" }, [h("span", { text: labelText }), input]);

  const el = h("section", { class: "tsh-section" }, [
    h("div", { class: "tsh-label", text: "Term" }),
    preset,
    h("div", { class: "tsh-term-grid" }, [
      field("Year", yearIn),
      field("Period", periodIn),
      field("Year text", yearTextIn),
      field("Period text", periodTextIn),
    ]),
  ]);

  return { el };
}
