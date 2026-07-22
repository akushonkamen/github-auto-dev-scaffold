import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the db layer — we don't need a real Postgres connection for this
// unit test. The webhook only needs: select tenant by client_reference_id,
// then update plan + stripe_customer_id.
vi.mock("@/db/client", () => {
  const updateSet = vi.fn();
  const updateWhere = vi.fn();
  const selectFrom = vi.fn();
  const state: { rows: Array<{ id: number }> ; set: unknown; } = {
    rows: [{ id: 1001 }],
    set: undefined,
  };
  updateWhere.mockImplementation(() => ({ id: 1001 }));
  updateSet.mockImplementation((patch: unknown) => {
    state.set = patch;
    return { where: updateWhere };
  });
  selectFrom.mockImplementation(() => ({
    where: () => ({ limit: () => Promise.resolve(state.rows) }),
  }));
  return {
    db: {
      select: () => ({ from: selectFrom }),
      update: () => ({ set: updateSet }),
    },
    __state: state,
  };
});

vi.mock("@/lib/stripe-client", () => {
  // Minimal mock: webhook construction returns the event we pass in via
  // the `signature` sentinel header. We never verify real signatures
  // in the unit test — that requires the Stripe SDK.
  return {
    getStripe: () => ({
      webhooks: {
        constructEvent: (_body: string, sig: string) => {
          if (sig !== "valid-sig") throw new Error("bad signature");
          return JSON.parse(_body);
        },
      },
    }),
    PRO_PRICE_ID: "price_test_pro",
  };
});

// We import after mocks are set up so the webhook uses the mocked deps.
const { POST } = await import("@/app/api/webhook/stripe/route");

function makeRequest(body: unknown, sig = "valid-sig"): Request {
  return new Request("http://localhost/api/webhook/stripe", {
    method: "POST",
    headers: { "stripe-signature": sig, "content-type": "text/plain" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("stripe webhook — checkout.session.completed", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("upgrades tenant plan to pro + persists stripe customer id", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "test-secret";
    const fixture = (await import("../../../../fixtures/stripe/checkout-completed.json")).default;
    const res = await POST(makeRequest(fixture));
    expect(res.status).toBe(200);

    // Check that the mocked db.update().set() was called with pro + customer id.
    const mod = (await import("@/db/client")) as unknown as { __state: { set: unknown } };
    expect(mod.__state.set).toMatchObject({
      plan: "pro",
      stripeCustomerId: "cus_test_customer_001",
    });
  });

  it("rejects bad signatures with 401 (S4)", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "test-secret";
    const fixture = (await import("../../../../fixtures/stripe/checkout-completed.json")).default;
    const res = await POST(makeRequest(fixture, "bogus-sig"));
    expect(res.status).toBe(401);
  });

  it("500s when STRIPE_WEBHOOK_SECRET is missing", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const fixture = (await import("../../../../fixtures/stripe/checkout-completed.json")).default;
    const res = await POST(makeRequest(fixture));
    expect(res.status).toBe(500);
  });
});
