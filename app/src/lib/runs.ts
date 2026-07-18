import "server-only";
import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { runs } from "@/db/schema";

/**
 * `runs` table helpers — one row per (installation, issue) lifecycle.
 *
 * The same Issue produces multiple `workflow_dispatch` calls over its life
 * (triage → clarify → develop → …) — each module updates `currentStage` and
 * `status` on the same row. New Issues insert; subsequent dispatches update.
 *
 * PRD §4.2 audit trail + Issue #9 billing source.
 */

export async function findRunByIssue(
  installationDbId: number,
  issueNumber: number,
): Promise<{ id: number } | null> {
  const row = await db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.installationId, installationDbId),
        eq(runs.issueNumber, issueNumber),
      ),
    )
    .limit(1);
  return row[0] ?? null;
}

export async function upsertRun(args: {
  installationDbId: number;
  issueNumber: number;
  prNumber?: number;
  currentStage: string;
  status: string;
}): Promise<{ runId: number }> {
  const existing = await findRunByIssue(
    args.installationDbId,
    args.issueNumber,
  );
  if (existing) {
    await db
      .update(runs)
      .set({
        prNumber: args.prNumber,
        currentStage: args.currentStage,
        status: args.status,
      })
      .where(eq(runs.id, existing.id));
    return { runId: existing.id };
  }
  const inserted = await db
    .insert(runs)
    .values({
      installationId: args.installationDbId,
      issueNumber: args.issueNumber,
      prNumber: args.prNumber,
      currentStage: args.currentStage,
      status: args.status,
    })
    .returning({ id: runs.id });
  return { runId: inserted[0]?.id ?? 0 };
}
