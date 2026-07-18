import { describe, it, expect } from "vitest";
import {
  SYNC_EVENTS,
  ASYNC_EVENTS,
  isSyncEvent,
  isAsyncEvent,
  asyncEventKey,
} from "@/lib/github-events";

describe("isSyncEvent", () => {
  it.each(SYNC_EVENTS)("returns true for '%s'", (event) => {
    expect(isSyncEvent(event)).toBe(true);
  });

  it("returns false for an async event", () => {
    expect(isSyncEvent("issues")).toBe(false);
  });

  it("returns false for an unknown event", () => {
    expect(isSyncEvent("ping")).toBe(false);
    expect(isSyncEvent("star")).toBe(false);
    expect(isSyncEvent("")).toBe(false);
  });
});

describe("isAsyncEvent", () => {
  it.each(ASYNC_EVENTS)("returns true for '%s'", (event) => {
    expect(isAsyncEvent(event)).toBe(true);
  });

  it("returns false for a sync event", () => {
    expect(isAsyncEvent("installation")).toBe(false);
  });

  it("returns false for an unknown event", () => {
    expect(isAsyncEvent("ping")).toBe(false);
    expect(isAsyncEvent("")).toBe(false);
  });
});

describe("asyncEventKey", () => {
  describe("issues", () => {
    it('returns "issues.opened" for opened action', () => {
      expect(asyncEventKey("issues", "opened")).toBe("issues.opened");
    });

    it('returns "issues.reopened" for reopened action', () => {
      expect(asyncEventKey("issues", "reopened")).toBe("issues.reopened");
    });

    it('returns "issues.labeled" for labeled action', () => {
      expect(asyncEventKey("issues", "labeled")).toBe("issues.labeled");
    });

    it("returns null for uninteresting actions", () => {
      expect(asyncEventKey("issues", "closed")).toBeNull();
      expect(asyncEventKey("issues", "edited")).toBeNull();
      expect(asyncEventKey("issues", "deleted")).toBeNull();
      expect(asyncEventKey("issues", "assigned")).toBeNull();
    });

    it("returns null when action is undefined", () => {
      expect(asyncEventKey("issues", undefined)).toBeNull();
    });
  });

  describe("issue_comment", () => {
    it('returns "issue_comment.created" for created action', () => {
      expect(asyncEventKey("issue_comment", "created")).toBe(
        "issue_comment.created",
      );
    });

    it("returns null for non-created actions", () => {
      expect(asyncEventKey("issue_comment", "edited")).toBeNull();
      expect(asyncEventKey("issue_comment", "deleted")).toBeNull();
    });

    it("returns null when action is undefined", () => {
      expect(asyncEventKey("issue_comment", undefined)).toBeNull();
    });
  });

  describe("pull_request", () => {
    it('returns "pull_request.opened" for opened action', () => {
      expect(asyncEventKey("pull_request", "opened")).toBe(
        "pull_request.opened",
      );
    });

    it('returns "pull_request.ready_for_review" for ready_for_review action', () => {
      expect(asyncEventKey("pull_request", "ready_for_review")).toBe(
        "pull_request.ready_for_review",
      );
    });

    it('returns "pull_request.labeled" for labeled action', () => {
      expect(asyncEventKey("pull_request", "labeled")).toBe(
        "pull_request.labeled",
      );
    });

    it("returns null for uninteresting actions", () => {
      expect(asyncEventKey("pull_request", "closed")).toBeNull();
      expect(asyncEventKey("pull_request", "edited")).toBeNull();
      expect(asyncEventKey("pull_request", "synchronize")).toBeNull();
    });
  });

  describe("pull_request_review", () => {
    it('returns "pull_request_review.submitted" for submitted action', () => {
      expect(asyncEventKey("pull_request_review", "submitted")).toBe(
        "pull_request_review.submitted",
      );
    });

    it("returns null for non-submitted actions", () => {
      expect(asyncEventKey("pull_request_review", "edited")).toBeNull();
      expect(asyncEventKey("pull_request_review", "dismissed")).toBeNull();
    });
  });

  describe("label", () => {
    it('returns "label.created" for created action', () => {
      expect(asyncEventKey("label", "created")).toBe("label.created");
    });

    it('returns "label.deleted" for deleted action', () => {
      expect(asyncEventKey("label", "deleted")).toBe("label.deleted");
    });

    it("returns null for uninteresting label actions", () => {
      expect(asyncEventKey("label", "edited")).toBeNull();
    });
  });

  describe("unknown event type", () => {
    // @ts-expect-error — testing a runtime path that should not happen
    it("returns null", () => {
      // The type system rejects unknown events, but at runtime we guard
      // with isAsyncEvent first, so this is a belt-and-suspenders check.
      expect(asyncEventKey("ping" as Parameters<typeof asyncEventKey>[0], "pong")).toBeNull();
    });
  });
});
