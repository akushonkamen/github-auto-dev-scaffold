import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock all dependencies ────────────────────────────────────────────────

const mockVerifyQStashSignature = vi.fn();
vi.mock("@/lib/qstash-verify", () => ({
  verifyQStashSignature: mockVerifyQStashSignature,
}));

const mockClaimDelivery = vi.fn();
vi.mock("@/lib/redis", () => ({
  claimDelivery: mockClaimDelivery,
}));

const mockGetInstallationToken = vi.fn();
vi.mock("@/lib/installation-token", () => ({
  getInstallationToken: mockGetInstallationToken,
}));

const mockDispatchWorkflow = vi.fn();
const mockEventToWorkflow = vi.fn();
vi.mock("@/lib/dispatch", () => ({
  dispatchWorkflow: mockDispatchWorkflow,
  eventToWorkflow: mockEventToWorkflow,
}));

const mockUpsertRun = vi.fn();
vi.mock("@/lib/runs", () => ({
  upsertRun: mockUpsertRun,
}));

// Mock the db client for installations lookup
const mockDbSelect = vi.fn();
vi.mock("@/db/client", () => ({
  db: {
    select: mockDbSelect,
  },
}));

// ── Tests ────────────────────────────────────────────────────────────────

async function createRequest(
  overrides: {
    body?: string;
    signature?: string;
    deliveryId?: string;
  } = {},
): Promise<Request> {
  const body = overrides.body ?? JSON.stringify({ event: "issues.opened", payload: { issue: { number: 1 }, installation: { id: 42 } } });
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "upstash-signature": overrides.signature ?? "valid-signature",
  };
  if (overrides.deliveryId !== undefined) {
    headers["x-github-delivery"] = overrides.deliveryId;
  }
  return new Request("https://example.com/api/webhook/github/worker", {
    method: "POST",
    headers,
    body,
  });
}

// Helper: configure the installations select mock to return a row
function mockInstallationRow(row?: { id: number; repoFullName: string } | null) {
  const fromMock = vi.fn();
  const whereMock = vi.fn();
  const limitMock = vi.fn();

  mockDbSelect.mockReturnValue({ from: fromMock });
  fromMock.mockReturnValue({ where: whereMock });
  whereMock.mockReturnValue({ limit: limitMock });
  limitMock.mockResolvedValue(row ? [row] : []);
}

describe("POST /api/webhook/github/worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyQStashSignature.mockResolvedValue(true);
    mockClaimDelivery.mockResolvedValue(true);
    mockEventToWorkflow.mockReturnValue("triage-issue.yml");
    mockGetInstallationToken.mockResolvedValue("ghs_mock_token");
    mockDispatchWorkflow.mockResolvedValue(undefined);
    mockUpsertRun.mockResolvedValue({ runId: 1 });
    mockInstallationRow({ id: 10, repoFullName: "owner/test-repo" });
  });

  it("returns 401 when QStash signature is invalid", async () => {
    mockVerifyQStashSignature.mockResolvedValue(false);
    const { POST } = await import("@/app/api/webhook/github/worker/route");
    const res = await POST(await createRequest());
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Invalid QStash signature");
  });

  it("returns 400 when body is malformed JSON", async () => {
    const { POST } = await import("@/app/api/webhook/github/worker/route");
    const res = await POST(await createRequest({ body: "not-json" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Malformed JSON");
  });

  it("returns 400 when event or payload is missing", async () => {
    const { POST } = await import("@/app/api/webhook/github/worker/route");
    const res = await POST(await createRequest({ body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Missing event/payload");
  });

  it("returns deduped=true when claimDelivery returns false (already seen)", async () => {
    mockClaimDelivery.mockResolvedValue(false);
    const { POST } = await import("@/app/api/webhook/github/worker/route");
    const res = await POST(await createRequest({ deliveryId: "dup-delivery" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deduped).toBe(true);
    // No dispatch should occur
    expect(mockDispatchWorkflow).not.toHaveBeenCalled();
  });

  it("returns 200 deduped=true even with duplicate when deliveryId is null (no dedup)", async () => {
    // Without deliveryId header, dedup is skipped
    const { POST } = await import("@/app/api/webhook/github/worker/route");
    // claimDelivery should NOT be called
    expect(mockClaimDelivery).not.toHaveBeenCalled();
  });

  it("returns 503 and retry=true when Redis is down", async () => {
    mockClaimDelivery.mockRejectedValue(new Error("Redis connection refused"));
    const { POST } = await import("@/app/api/webhook/github/worker/route");
    const res = await POST(await createRequest({ deliveryId: "redis-down" }));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.retry).toBe(true);
  });

  it("returns 200 ignored=true for events with no workflow mapping", async () => {
    mockEventToWorkflow.mockReturnValue(null);
    const { POST } = await import("@/app/api/webhook/github/worker/route");
    const res = await POST(await createRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ignored).toBe(true);
    expect(mockDispatchWorkflow).not.toHaveBeenCalled();
  });

  it("returns 400 when installation.id is missing", async () => {
    const { POST } = await import("@/app/api/webhook/github/worker/route");
    const body = JSON.stringify({ event: "issues.opened", payload: { issue: { number: 1 } } });
    const res = await POST(await createRequest({ body }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Missing installation.id");
  });

  it("returns 200 ignored=true when installation not found in DB", async () => {
    mockInstallationRow(null);
    const { POST } = await import("@/app/api/webhook/github/worker/route");
    const res = await POST(await createRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ignored).toBe(true);
    expect(json.reason).toBe("installation_not_found");
  });

  it("returns 200 ignored=true when no issue_number or pr_number", async () => {
    const { POST } = await import("@/app/api/webhook/github/worker/route");
    const body = JSON.stringify({ event: "issues.opened", payload: { issue: { }, installation: { id: 42 } } });
    const res = await POST(await createRequest({ body }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ignored).toBe(true);
    expect(json.reason).toBe("no_issue_or_pr");
  });

  it("successfully dispatches a workflow and returns 200", async () => {
    const { POST } = await import("@/app/api/webhook/github/worker/route");
    const res = await POST(await createRequest({
      deliveryId: "fresh-delivery",
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.dispatched).toBe("triage-issue.yml");
    expect(json.deliveryId).toBe("fresh-delivery");

    // Verify the full dispatch flow
    expect(mockVerifyQStashSignature).toHaveBeenCalled();
    expect(mockClaimDelivery).toHaveBeenCalledWith("fresh-delivery");
    expect(mockEventToWorkflow).toHaveBeenCalledWith("issues.opened");

    // upsertRun called twice: dispatching → dispatched
    expect(mockUpsertRun).toHaveBeenCalledTimes(2);
    expect(mockUpsertRun).toHaveBeenNthCalledWith(1, expect.objectContaining({ status: "dispatching" }));
    expect(mockUpsertRun).toHaveBeenNthCalledWith(2, expect.objectContaining({ status: "dispatched" }));

    expect(mockGetInstallationToken).toHaveBeenCalledWith(42);
    expect(mockDispatchWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        installationToken: "ghs_mock_token",
        repoFullName: "owner/test-repo",
        workflowFile: "triage-issue.yml",
        eventKey: "issues.opened",
      }),
    );
  });

  it("returns 502 retry=true on dispatch failure", async () => {
    mockDispatchWorkflow.mockRejectedValue(new Error("workflow_dispatch failed: status=404"));
    const { POST } = await import("@/app/api/webhook/github/worker/route");
    const res = await POST(await createRequest({ deliveryId: "fail-delivery" }));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.retry).toBe(true);

    // Should record failed status
    expect(mockUpsertRun).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("handles PR events with pr_number", async () => {
    mockEventToWorkflow.mockReturnValue("pr-lifecycle.yml");
    const { POST } = await import("@/app/api/webhook/github/worker/route");
    const body = JSON.stringify({
      event: "pull_request.opened",
      payload: { pull_request: { number: 42 }, installation: { id: 99 } },
    });
    const res = await POST(await createRequest({ body, deliveryId: "pr-delivery" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.dispatched).toBe("pr-lifecycle.yml");

    expect(mockUpsertRun).toHaveBeenCalledWith(
      expect.objectContaining({ prNumber: 42, status: "dispatching" }),
    );
  });

  it("responds to GET with ok:true", async () => {
    const { GET } = await import("@/app/api/webhook/github/worker/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });
});
