#!/usr/bin/env node
/**
 * Notion sync — mirrors GitHub Issue lifecycle events to a Notion database.
 *
 * Triggered by the notion-sync composite action on issue/label/module-summary
 * events. Creates or updates a Notion page for the given issue using the
 * NOTION_API_KEY + NOTION_DATABASE_ID environment variables.
 *
 * Environment:
 *   NOTION_API_KEY       — Notion integration token (required)
 *   NOTION_DATABASE_ID   — target Notion database ID (required)
 *   GH_TOKEN             — GitHub token with issues:write (required)
 *   ISSUE_NUMBER         — GitHub issue number (required)
 *   ISSUE_TITLE          — issue title
 *   ISSUE_URL            — issue URL
 *   ISSUE_STATE          — issue state (open/closed)
 *   ISSUE_LABELS         — comma-separated label list
 *   ISSUE_BODY           — issue body (markdown)
 */

import { Client } from "@notionhq/client";

// ---------------------------------------------------------------------------
// GitHub helpers
// ---------------------------------------------------------------------------

/**
 * Post an audit comment on the issue.
 */
async function postAuditComment({ octokit, owner, repo, issueNumber, body }) {
  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body,
  });
}

/**
 * Post an error audit comment and re-throw.
 */
async function postErrorAuditComment({ octokit, owner, repo, issueNumber, err }) {
  const message = err instanceof Error ? err.message : String(err);
  await postAuditComment({
    octokit,
    owner,
    repo,
    issueNumber,
    body: [
      "🚨 **Notion sync failed**",
      "",
      "```",
      `notion sync failed: ${message}`,
      "```",
      "",
      "The sync will be retried on the next lifecycle event.",
    ].join("\n"),
  });
}

// ---------------------------------------------------------------------------
// Notion API surface
// ---------------------------------------------------------------------------

/** @type {Client|null} */
let notionClient = null;

/**
 * Return a lazily-initialised Notion client.
 *
 * Defined at line ~167. Used throughout the module wherever a Notion API call
 * is needed so that the client is created once and reused.
 */
function getNotion() {
  if (!notionClient) {
    if (!process.env.NOTION_API_KEY) {
      throw new Error("NOTION_API_KEY is not set");
    }
    notionClient = new Client({ auth: process.env.NOTION_API_KEY });
  }
  return notionClient;
}

/**
 * Build the Notion page properties payload from issue data.
 */
function buildPageProperties({ title, url, state, labels, issueNumber }) {
  return {
    parent: { database_id: process.env.NOTION_DATABASE_ID },
    properties: {
      Name: {
        title: [{ text: { content: title || `Issue #${issueNumber}` } }],
      },
      "Issue Number": {
        number: Number(issueNumber),
      },
      URL: {
        url: url || `https://github.com/unknown/issues/${issueNumber}`,
      },
      State: {
        select: { name: state || "open" },
      },
      Labels: {
        rich_text: [
          {
            text: {
              content: labels || "",
            },
          },
        ],
      },
    },
  };
}

/**
 * Query the Notion database for an existing page matching the issue number.
 *
 * Returns the page object or null.
 */
async function findExistingPage(issueNumber) {
  if (!process.env.NOTION_DATABASE_ID) {
    throw new Error("NOTION_DATABASE_ID is not set");
  }

  const response = await getNotion().databases.query({
    database_id: process.env.NOTION_DATABASE_ID,
    filter: {
      property: "Issue Number",
      number: {
        equals: Number(issueNumber),
      },
    },
    page_size: 1,
  });

  return response.results.length > 0 ? response.results[0] : null;
}

/**
 * Create a new page in the Notion database.
 *
 * NOTE: This is the function that originally contained the bug reported in
 * Issue #37. The reference `notion.pages.create(...)` was replaced with
 * `getNotion().pages.create(...)` — the same lazy-init pattern used elsewhere.
 */
async function createPageInDatabase(properties) {
  // FIX (Issue #37): use getNotion() instead of bare `notion` which is
  // undefined in this scope.
  return getNotion().pages.create(properties);
}

/**
 * Update an existing Notion page with fresh issue properties.
 */
async function updatePage(pageId, properties) {
  return getNotion().pages.update({
    page_id: pageId,
    properties: properties.properties,
  });
}

/**
 * Get or create a Notion page for the given issue.
 *
 * If a page with the matching Issue Number already exists, update it.
 * Otherwise create a new page.
 */
async function getOrCreatePageForIssue(issueData) {
  const existing = await findExistingPage(issueData.issueNumber);

  if (existing) {
    const properties = buildPageProperties(issueData);
    const updated = await updatePage(existing.id, properties);
    return { page: updated, created: false };
  }

  const properties = buildPageProperties(issueData);
  const page = await createPageInDatabase(properties);
  return { page, created: true };
}

// ---------------------------------------------------------------------------
// GitHub API helpers (lightweight — avoids pulling in @octokit/rest as a
// hard dependency; uses the gh CLI where available)
// ---------------------------------------------------------------------------

/**
 * Return an octokit-like object backed by gh CLI calls.
 *
 * In production this could use @octokit/rest, but we keep the dependency
 * surface minimal by shelling out to `gh api` which is always available in
 * GitHub Actions.
 */
function getOctokit() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GH_TOKEN is not set");
  }

  const ghApi = async (method, path, body) => {
    const args = ["api", "-X", method, "-H", "Accept: application/vnd.github+json"];
    if (body) {
      args.push("--input", "-");
    }
    args.push(path);
    const { execSync } = await import("node:child_process");
    const opts = {
      env: { ...process.env, GH_TOKEN: token },
      encoding: "utf-8",
    };
    if (body) {
      opts.input = JSON.stringify(body);
    }
    return JSON.parse(execSync(`gh ${args.join(" ")}`, opts));
  };

  return {
    rest: {
      issues: {
        createComment: (opts) =>
          ghApi("POST", `/repos/${opts.owner}/${opts.repo}/issues/${opts.issue_number}/comments`, {
            body: opts.body,
          }),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const issueNumber = Number(process.env.ISSUE_NUMBER);
  if (!issueNumber) {
    throw new Error("ISSUE_NUMBER is not set");
  }

  const [owner, repo] = (process.env.GITHUB_REPOSITORY || "unknown/unknown").split("/");

  const issueData = {
    issueNumber,
    title: process.env.ISSUE_TITLE || `Issue #${issueNumber}`,
    url: process.env.ISSUE_URL || "",
    state: process.env.ISSUE_STATE || "open",
    labels: process.env.ISSUE_LABELS || "",
    body: process.env.ISSUE_BODY || "",
  };

  const octokit = getOctokit();

  try {
    const { page, created } = await getOrCreatePageForIssue(issueData);
    const notionUrl = page.url || `https://notion.so/${page.id.replace(/-/g, "")}`;

    await postAuditComment({
      octokit,
      owner,
      repo,
      issueNumber,
      body: [
        created
          ? "📄 **Notion page created**"
          : "🔄 **Notion page updated**",
        "",
        `Mirror: ${notionUrl}`,
      ].join("\n"),
    });

    // Emit the Notion URL as an action output via GITHUB_OUTPUT.
    const fs = await import("node:fs");
    fs.appendFileSync(process.env.GITHUB_OUTPUT || "/dev/null", `notion-url=${notionUrl}\n`);
  } catch (err) {
    await postErrorAuditComment({ octokit, owner, repo, issueNumber, err });
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
