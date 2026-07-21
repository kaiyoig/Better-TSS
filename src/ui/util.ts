import { TssError } from "../api/tss";

/** Turn a thrown value into a user-facing message, surfacing TssError hints (e.g. expired session). */
export function errorMessage(err: unknown): string {
  if (err instanceof TssError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong. Are you logged in to TSS?";
}
