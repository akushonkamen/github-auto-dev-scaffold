import { KeyRound, Trash2 } from "lucide-react";

import { deleteApiKeyAction } from "./actions";
import type { ApiKeyRowPublic } from "@/lib/api-keys-queries";
import { Button } from "@/components/ui/button";

function fmtDate(value: Date | string | null): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export function ApiKeyList({ keys }: { keys: ApiKeyRowPublic[] }) {
  return (
    <ul className="divide-y">
      {keys.map((k) => (
        <li key={k.id} className="flex items-center justify-between gap-3 p-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2 text-sm">
              <KeyRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="font-mono">{k.provider}</span>
              <span className="text-muted-foreground">••••{k.keyHint ?? ""}</span>
            </div>
            <div className="text-[11px] text-muted-foreground">
              创建于 {fmtDate(k.createdAt)}
              {k.rotatedAt && ` · 轮换于 ${fmtDate(k.rotatedAt)}`}
            </div>
          </div>
          <form action={deleteApiKeyAction}>
            <input type="hidden" name="id" value={k.id} />
            <Button
              type="submit"
              variant="outline"
              size="sm"
              className="text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除
            </Button>
          </form>
        </li>
      ))}
    </ul>
  );
}
