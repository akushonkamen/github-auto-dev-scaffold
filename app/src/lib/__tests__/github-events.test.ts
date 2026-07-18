import { describe, it, expect } from "vitest";
import { asyncEventKey } from "@/lib/github-events";
import type { AsyncEvent } from "@/lib/github-events";

describe("asyncEventKey", () => {
  it("returns issues.opened for issues event with opened action", () => {
    expect(asyncEventKey("issues" as AsyncEvent, "opened")).toBe("issues.opened");
  });

  it("returns issues.reopened for issues event with reopened action", () => {
    expect(asyncEventKey("issues" as AsyncEvent, "reopened")).toBe("issues.reopened");
  });

  it("returns issues.labeled for issues event with labeled action", () => {
    expect(asyncEventKey("issues" as AsyncEvent, "labeled")).toBe("issues.labeled");
  });

  it("returns null for issues.closed (no dispatch)", () => {
    expect(asyncEventKey("issues" as AsyncEvent, "closed")).toBeNull();
  });

  it("returns issue_comment.created for comment created", () => {
    expect(asyncEventKey("issue_comment" as AsyncEvent, "created")).toBe("issue_comment.created");
  });

  it("returns null for issue_comment.edited", () => {
    expect(asyncEventKey("issue_comment" as AsyncEvent, "edited")).toBeNull();
  });

  it("returns pull_request.opened for PR opened", () => {
    expect(asyncEventKey("pull_request" as AsyncEvent, "opened")).toBe("pull_request.opened");
  });

  it("returns pull_request.ready_for_review for PR review requested", () => {
    expect(asyncEventKey("pull_request" as AsyncEvent, "ready_for_review")).toBe("pull_request.ready_for_review");
  });

  it("returns pull_request.labeled for PR labeled", () => {
    expect(asyncEventKey("pull_request" as AsyncEvent, "labeled")).toBe("pull_request.labeled");
  });

  it("returns null for pull_request.closed", () => {
    expect(asyncEventKey("pull_request" as AsyncEvent, "closed")).toBeNull();
  });

  it("returns pull_request_review.submitted for review submitted", () => {
    expect(asyncEventKey("pull_request_review" as AsyncEvent, "submitted")).toBe("pull_request_review.submitted");
  });

  it("returns label.created for label.created", () => {
    expect(asyncEventKey("label" as AsyncEvent, "created")).toBe("label.created");
  });

  it("returns label.deleted for label.deleted", () => {
    expect(asyncEventKey("label" as AsyncEvent, "deleted")).toBe("label.deleted");
  });

  it("returns null for label.edited", () => {
    expect(asyncEventKey("label" as AsyncEvent, "edited")).toBeNull();
  });

  it("returns null when action is undefined", () => {
    expect(asyncEventKey("issues" as AsyncEvent, undefined)).toBeNull();
  });
});
