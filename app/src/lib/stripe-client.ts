import "server-only";
import Stripe from "stripe";

/**
 * Lazily-instantiated Stripe client. Throws if STRIPE_SECRET_KEY is unset
 * so callers can surface a generic 500 (S4: never log the key).
 */
let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY missing");
  cached = new Stripe(key, { apiVersion: "2024-06-20" });
  return cached;
}

export const PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID ?? "";
