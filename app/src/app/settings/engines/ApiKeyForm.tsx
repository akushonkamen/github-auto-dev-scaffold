import { addApiKeyAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ApiKeyForm() {
  return (
    <form action={addApiKeyAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="provider">Provider</Label>
        <select
          id="provider"
          name="provider"
          required
          defaultValue="anthropic"
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="deepseek">DeepSeek</option>
          <option value="custom">Custom</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="apiKey">API Key</Label>
        <Input
          id="apiKey"
          name="apiKey"
          type="password"
          required
          autoComplete="off"
          placeholder="sk-..."
          className="font-mono"
        />
        <p className="text-[11px] text-muted-foreground">
          只在提交时通过 HTTPS 传输；服务端立刻加密。
        </p>
      </div>

      <Button type="submit">保存密钥</Button>
    </form>
  );
}
