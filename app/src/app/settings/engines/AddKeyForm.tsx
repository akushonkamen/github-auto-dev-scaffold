"use client";

import { useActionState } from "react";
import { addApiKey, type ActionState } from "./actions";

const initialState: ActionState = { ok: true, message: "" };

export function AddKeyForm() {
  const [state, formAction, pending] = useActionState(addApiKey, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <label
          htmlFor="provider"
          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
        >
          Provider
        </label>
        <select
          id="provider"
          name="provider"
          required
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="deepseek">DeepSeek</option>
          <option value="custom">Custom</option>
        </select>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="apiKey"
          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
        >
          API Key
        </label>
        <input
          id="apiKey"
          name="apiKey"
          type="password"
          required
          placeholder="sk-…"
          autoComplete="off"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save Key"}
      </button>

      {state.message && (
        <p
          className={
            "text-sm " +
            (state.ok ? "text-emerald-600" : "text-destructive")
          }
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
