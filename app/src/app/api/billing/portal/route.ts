import "server-only";
import { NextResponse } from "next/server";

import { getServerSession } from "next-auth";
import { eq } from "drizzle-orm";
import { authOptions } from "@/auth/config";
import { db } from "@/db/client";
import { tenants } from "@/db/schema";
import { getStripe } from "@/lib/stripe-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/billing/portal
 *
 * Creates a Stripe Customer Portal session so the tenant can manage their
 * subscription (update payment method, cancel, view invoices). Requires
 * that the tenant already has a `stripe_customer_id` (i.e. has been through
 * Checkout at least once).
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
    .select({ stripeCustomerId: tenants.stripeCustomerId })
    .from(tenants)
    .where(eq(tenants.githubId, githubId))
    .limit(1);
  const customerId = tenantRows[0]?.stripeCustomerId;
  if (!customerId) {
    return NextResponse.json(
      { error: "No subscription to manage" },
      { status: 404 },
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
  const portal = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl}/settings/billing`,
  });

  return NextResponse.json({ url: portal.url });
}
