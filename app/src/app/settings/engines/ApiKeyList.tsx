import { deleteApiKeyAction } from "./actions";
import type { ApiKeyRowPublic } from "@/lib/api-keys-queries";

function fmtDate(value: Date | string | null): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export function ApiKeyList({ keys }: { keys: ApiKeyRowPublic[] }) {
  return (
    <ul className="divide-y rounded-lg border">
      {keys.map((k) => (
        <li key={k.id} className="flex items-center justify-between gap-3 p-3">
          <div className="flex-1 space-y-1 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-mono">{k.provider}</span>
              <span className="text-muted-foreground">
                ••••{k.keyHint ?? ""}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              创建于 {fmtDate(k.createdAt)}
              {k.rotatedAt && ` · 轮换于 ${fmtDate(k.rotatedAt)}`}
            </div>
          </div>
          <form action={deleteApiKeyAction}>
            <input type="hidden" name="id" value={k.id} />
            <button
              type="submit"
              className="rounded border border-destructive px-3 py-1 text-xs text-destructive hover:bg-destructive/10"
            >
              删除
            </button>
          </form>
        </li>
      ))}
    </ul>
  );
}
