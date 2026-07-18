import { describe, it, expect } from "vitest";
import { eventToWorkflow } from "@/lib/dispatch";

describe("eventToWorkflow", () => {
  it("returns triage-issue.yml for issues.opened", () => {
    expect(eventToWorkflow("issues.opened")).toBe("triage-issue.yml");
  });

  it("returns triage-issue.yml for issues.reopened", () => {
    expect(eventToWorkflow("issues.reopened")).toBe("triage-issue.yml");
  });

  it("returns triage-issue.yml for issues.labeled", () => {
    expect(eventToWorkflow("issues.labeled")).toBe("triage-issue.yml");
  });

  it("returns clarify-loop.yml for issue_comment.created", () => {
    expect(eventToWorkflow("issue_comment.created")).toBe("clarify-loop.yml");
  });

  it("returns pr-lifecycle.yml for pull_request.opened", () => {
    expect(eventToWorkflow("pull_request.opened")).toBe("pr-lifecycle.yml");
  });

  it("returns pr-lifecycle.yml for pull_request.ready_for_review", () => {
    expect(eventToWorkflow("pull_request.ready_for_review")).toBe("pr-lifecycle.yml");
  });

  it("returns pr-lifecycle.yml for pull_request.labeled", () => {
    expect(eventToWorkflow("pull_request.labeled")).toBe("pr-lifecycle.yml");
  });

  it("returns review.yml for pull_request_review.submitted", () => {
    expect(eventToWorkflow("pull_request_review.submitted")).toBe("review.yml");
  });

  it("returns null for label.created (no-op)", () => {
    expect(eventToWorkflow("label.created")).toBeNull();
  });

  it("returns null for label.deleted (no-op)", () => {
    expect(eventToWorkflow("label.deleted")).toBeNull();
  });

  it("returns null for unknown event keys", () => {
    expect(eventToWorkflow("issues.closed")).toBeNull();
    expect(eventToWorkflow("unknown.event")).toBeNull();
    expect(eventToWorkflow("")).toBeNull();
  });
});
