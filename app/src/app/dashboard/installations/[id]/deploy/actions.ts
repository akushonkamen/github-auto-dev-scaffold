"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getServerSession } from "next-auth";
import { authOptions } from "@/auth/config";
import { getAppInstallationsForUser } from "@/auth/with-app-installer";
import { findInstallationByDbId } from "@/lib/installations-queries";
import {
  applyDeploy as applyDeployCore,
  dryRun as dryRunCore,
  type ApplyOptions,
  type ApplyReport,
  type DiffReport,
} from "@/lib/deploy-pipeline";

/**
 * Resolve a DB installation id into a usable (token, repoFullName) pair,
 * after re-checking that the current user actually has access to that
 * installation via GitHub. S11: cookie + path alone are not enough.
 *
 * Token precedence:
 *   1. PAT (if provided in ApplyArgs.claudePat) — covers Actions vars/secrets
 *      + branch rulesets. Required because GitHub App installation tokens
 *      403 on actions/variables even with `actions: write` permission, and
 *      user OAuth tokens may also lack `workflow` scope.
 *   2. Session user OAuth token (fallback) — works for contents/labels only.
 *
 * Identity is still verified via session.accessToken regardless of which
 * token is used for the actual GitHub API calls.
 */
async function resolveAuthorized(
  dbId: number,
  pat?: string,
): Promise<{ token: string; repoFullName: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) redirect("/login");

  const installation = await findInstallationByDbId(dbId);
  if (!installation) throw new Error("Installation not found");

  const accessible = await getAppInstallationsForUser(session.accessToken);
  const ok = accessible.some((i) => i.id === installation.installationId);
  if (!ok) throw new Error("Access denied for this installation");

  return {
    token: pat?.trim() || session.accessToken,
    repoFullName: installation.repoFullName,
  };
}

export interface DryRunResult {
  ok: boolean;
  error?: string;
  report?: DiffReport;
}

export async function dryRunDeploy(dbId: number): Promise<DryRunResult> {
  let ctx;
  try {
    ctx = await resolveAuthorized(dbId);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const result = await dryRunCore(ctx.repoFullName, ctx.token);
  return result;
}

export interface ApplyArgs {
  dbId: number;
  llmKey: string;
  claudePat?: string;
  claudePatOwner?: string;
  baseBranch?: string;
  vars?: Record<string, string>;
  fileOverrides?: string[];
}

export interface ApplyResult {
  ok: boolean;
  error?: string;
  report?: ApplyReport;
}

export async function applyDeploy(args: ApplyArgs): Promise<ApplyResult> {
  let ctx;
  try {
    ctx = await resolveAuthorized(args.dbId, args.claudePat);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (!args.llmKey || args.llmKey.length < 8) {
    return { ok: false, error: "LLM_API_KEY is required (min 8 chars)" };
  }

  const options: ApplyOptions = {
    llmKey: args.llmKey,
    claudePat: args.claudePat?.trim() || undefined,
    claudePatOwner: args.claudePatOwner?.trim() || undefined,
    baseBranch: args.baseBranch?.trim() || undefined,
    vars: args.vars ?? {},
    fileOverrides: new Set(args.fileOverrides ?? []),
  };

  try {
    const report = await applyDeployCore(ctx.repoFullName, ctx.token, options);
    revalidatePath(`/dashboard/installations/${args.dbId}`);
    return { ok: true, report };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
