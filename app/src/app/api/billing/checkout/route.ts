import "server-only";
import { NextResponse } from "next/server";

import { getServerSession } from "next-auth";
import { eq } from "drizzle-orm";
import { authOptions } from "@/auth/config";
import { db } from "@/db/client";
import { tenants } from "@/db/schema";
import { getStripe, PRO_PRICE_ID } from "@/lib/stripe-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/billing/checkout
 *
 * Creates a Stripe Checkout Session for the Pro plan (monthly). The
 * tenant's `githubId` is passed as metadata so the webhook can map the
 * subscription back to a tenant row without storing PII in Stripe.
 *
 * Returns `{ url }` — the client redirects via `window.location = url`.
 */
export async function POST(): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const githubId = (session.user as { githubId?: number }).githubId;
  if (typeof githubId !== "number") {
    return NextResponse.json({ error: "No githubId" }, { status: 400 });
  }

  const tenantRows = await db
    .select({ id: tenants.id, stripeCustomerId: tenants.stripeCustomerId })
    .from(tenants)
    .where(eq(tenants.githubId, githubId))
    .limit(1);
  const tenant = tenantRows[0];
  if (!tenant) {
    return NextResponse.json(
      { error: "Tenant not initialized" },
      { status: 409 },
    );
  }

  if (!PRO_PRICE_ID) {
    return NextResponse.json(
      { error: "STRIPE_PRO_PRICE_ID not configured" },
      { status: 500 },
    );
  }

  let stripe;
  try {
    stripe = getStripe();
  } catch {
    return NextResponse.json(
      { error: "Billing unavailable" },
      { status: 500 },
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const checkout = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: PRO_PRICE_ID, quantity: 1 }],
    success_url: `${appUrl}/settings/billing?checkout=success`,
    cancel_url: `${appUrl}/settings/billing?checkout=cancel`,
    client_reference_id: String(tenant.id),
    customer: tenant.stripeCustomerId ?? undefined,
    customer_creation: tenant.stripeCustomerId ? undefined : "always",
    metadata: { githubId: String(githubId), tenantId: String(tenant.id) },
  });

  return NextResponse.json({ url: checkout.url });
}
