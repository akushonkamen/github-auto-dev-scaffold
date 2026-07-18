"use client";

import { useActionState } from "react";
import { removeApiKey, type ActionState } from "./actions";

const initialState: ActionState = { ok: true, message: "" };

export function DeleteKeyButton({ id }: { id: number }) {
  const [state, formAction, pending] = useActionState(
    removeApiKey,
    initialState,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-input bg-background px-3 py-2 text-sm font-medium text-destructive ring-offset-background transition-colors hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
      >
        {pending ? "Deleting…" : "Delete"}
      </button>
      {state.message && !state.ok && (
        <p className="mt-1 text-xs text-destructive">{state.message}</p>
      )}
    </form>
  );
}
