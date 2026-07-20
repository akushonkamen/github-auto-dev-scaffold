"use client";

import { useState } from "react";

interface Props {
  plan: "free" | "pro" | "enterprise";
}

/**
 * Client component for the two billing actions:
 * - Upgrade → POST /api/billing/checkout → redirect to Stripe URL
 * - Manage → POST /api/billing/portal → redirect to Stripe URL
 *
 * On Free plan we show "Upgrade to Pro". On paid plans we show "Manage subscription".
 */
export function BillingActions({ plan }: Props) {
  const [loading, setLoading] = useState<"checkout" | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout() {
    setError(null);
    setLoading("checkout");
    try {
      const res = await fetch("/api/billing/checkout", { method: "POST" });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? "Checkout failed");
        setLoading(null);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Network error");
      setLoading(null);
    }
  }

  async function startPortal() {
    setError(null);
    setLoading("portal");
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? "Portal unavailable");
        setLoading(null);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Network error");
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {plan === "free" ? (
        <button
          type="button"
          onClick={startCheckout}
          disabled={loading !== null}
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {loading === "checkout" ? "跳转中…" : "升级到 Pro"}
        </button>
      ) : (
        <button
          type="button"
          onClick={startPortal}
          disabled={loading !== null}
          className="rounded border px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading === "portal" ? "跳转中…" : "管理订阅"}
        </button>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
