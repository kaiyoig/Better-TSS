import type { CourseSummary, Section } from "../api/types";
import { courseKey } from "../model/planOps";
import type { AppContext } from "./context";
import { confirmBook, confirmTssDrop, errorMessage } from "./util";

// Shared Book-in-TSS / Drop-from-TSS operation state for the calendar and list views. Each view
// creates one runner and re-renders on `onChange`; success flows back through the "bookings"
// change channel (the panel re-reads enrollments, every subscribed view re-renders).

export interface BookingRunner {
  /** In-flight label for a course ("Booking…"/"Dropping…"), or undefined when idle. */
  busy(course: CourseSummary): string | undefined;
  /** Last failure for a course, cleared when a new attempt starts. */
  error(course: CourseSummary): string | undefined;
  /** Confirm + submit a real TSS enrollment for the given section. */
  book(course: CourseSummary, section: Section): void;
  /** Confirm + cancel a real TSS enrollment. */
  dropTss(course: CourseSummary, section: Section): void;
}

export function createBookingRunner(ctx: AppContext, onChange: () => void): BookingRunner {
  const busy = new Map<string, string>();
  const errors = new Map<string, string>();

  function run(
    course: CourseSummary,
    label: string,
    op: () => Promise<unknown>,
  ): void {
    const key = courseKey(course);
    busy.set(key, label);
    errors.delete(key);
    onChange();
    op()
      .then(() => {
        busy.delete(key);
        ctx.notifyBookingsChanged(); // panel refresh → "bookings" → views re-render
      })
      .catch((err: unknown) => {
        busy.delete(key);
        errors.set(key, errorMessage(err));
        onChange();
      });
  }

  return {
    busy: (c) => busy.get(courseKey(c)),
    error: (c) => errors.get(courseKey(c)),
    book: (course, section) => {
      if (!confirmBook(`${course.abbr} (${section.eventPkgText})`)) return;
      run(course, "Booking…", () => ctx.client.bookSection(course, section));
    },
    dropTss: (course, section) => {
      if (!confirmTssDrop(`${course.abbr} (${section.eventPkgText})`)) return;
      run(course, "Dropping…", () => ctx.client.dropSection(course, section));
    },
  };
}
