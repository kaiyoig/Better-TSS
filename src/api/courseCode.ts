// TSS course codes are DEPARTMENT-NNN where NNN is a zero-padded 3-digit number optionally
// followed by a letter (e.g. "CSE-103", "CHEM-007L", "MATH-020C"). Users type looser forms like
// "CHEM 7L" or "cse103"; normalize those to the canonical code so full-text search matches.

// Anchored: dept letters, optional space/dash, 1–3 digits, optional 1–2 letter suffix.
const COURSE_CODE_RE = /^\s*([A-Za-z]{2,5})\s*-?\s*(\d{1,3})\s*([A-Za-z]{0,2})\s*$/;

/**
 * If `input` looks like a course code, return it in canonical DEPT-NNN[suffix] form.
 * Otherwise (e.g. a title search) return the input trimmed, unchanged.
 */
export function normalizeCourseQuery(input: string): string {
  const m = input.match(COURSE_CODE_RE);
  if (!m) return input.trim();
  const dept = m[1].toUpperCase();
  const num = m[2].padStart(3, "0");
  const suffix = m[3].toUpperCase();
  return `${dept}-${num}${suffix}`;
}
