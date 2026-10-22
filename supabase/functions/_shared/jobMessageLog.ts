/**
 * One line per job email or SMS so edge-runtime logs can be filtered with
 * `[job-message]`. `origin` separates a job that came from an estimate, a
 * walkthrough, or a job the owner created directly.
 */

export type JobOrigin = "converted_estimate" | "converted_walkthrough" | "created";

export function jobOrigin(job: {
  estimate_id?: string | null;
  walkthrough_id?: string | null;
}): JobOrigin {
  if (job.estimate_id) return "converted_estimate";
  if (job.walkthrough_id) return "converted_walkthrough";
  return "created";
}

export function logJobMessage(event: string, details: Record<string, unknown>): void {
  console.log(`[job-message] ${event} ${JSON.stringify(details)}`);
}
