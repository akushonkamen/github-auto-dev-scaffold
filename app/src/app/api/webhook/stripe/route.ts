import "server-only";
import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { tenants } from "@/db/schema";
import { getStripe } from "@/lib/stripe-client";
import { updateTenantPlan, type Plan } from "@/lib/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webhook/stripe
 *
 * Verifies the Stripe signature, then handles subscription lifecycle:
 * - checkout.session.completed → upgrade to "pro" + persist customer id
 * - customer.subscription.updated → re-derive plan from price id / status
 * - customer.subscription.deleted → downgrade to "free"
 *
 * The tenant is resolved via `client_reference_id` (tenantId) on checkout
 * or via `customer` (stripe_customer_id) on subscription events. Unknown
 * → 200 ignored (return 200 so Stripe doesn't retry forever).
 */
function derivePlan(status: string): Plan {
  if (status === "active" || status === "trialing") return "pro";
  return "free";
}

async function findByTenantId(tenantId: number) {
  const rows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return rows[0] ?? null;
}

async function findByCustomerId(customerId: string) {
  const rows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.stripeCustomerId, customerId))
    .limit(1);
  return rows[0] ?? null;
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 },
    );
  }

  const sig = request.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 401 });
  }

  const body = await request.text();

  let stripe;
  try {
    stripe = getStripe();
  } catch {
    return NextResponse.json(
      { error: "Billing unavailable" },
      { status: 500 },
    );
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch {
    // Verification failure — S4: don't echo the error message.
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const sess = event.data.object as Stripe.Checkout.Session;
        const tenantIdStr = sess.client_reference_id;
        const customerId = typeof sess.customer === "string" ? sess.customer : null;
        if (!tenantIdStr || !customerId) break;
        const tenantId = Number.parseInt(tenantIdStr, 10);
        if (!Number.isFinite(tenantId)) break;
        const tenant = await findByTenantId(tenantId);
        if (!tenant) break;
        await updateTenantPlan(tenant.id, "pro", customerId);
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === "string" ? sub.customer : null;
        if (!customerId) break;
        const tenant = await findByCustomerId(customerId);
        if (!tenant) break;
        const plan = derivePlan(sub.status);
        await updateTenantPlan(tenant.id, plan, customerId);
        break;
      }
      default:
        // Unhandled event types return 200 — Stripe won't retry.
        break;
    }
  } catch {
    // Surface 500 so Stripe retries. Don't echo details (S4).
    return NextResponse.json({ error: "Internal" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
