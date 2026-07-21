import { TssError } from "../api/tss";

/** Turn a thrown value into a user-facing message, surfacing TssError hints (e.g. expired session). */
export function errorMessage(err: unknown): string {
  if (err instanceof TssError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong. Are you logged in to TSS?";
}

/** Confirm a course drop before it happens. Returns true if the user accepts. */
export function confirmDrop(courseLabel: string): boolean {
  return window.confirm(`Drop ${courseLabel} from your schedule?`);
}
