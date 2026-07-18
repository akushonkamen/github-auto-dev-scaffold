import { addApiKeyAction } from "./actions";

export function ApiKeyForm() {
  return (
    <form action={addApiKeyAction} className="space-y-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="provider" className="text-sm font-medium">
          Provider
        </label>
        <select
          id="provider"
          name="provider"
          required
          defaultValue="anthropic"
          className="rounded border bg-background px-3 py-2 text-sm"
        >
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="deepseek">DeepSeek</option>
          <option value="custom">Custom</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="apiKey" className="text-sm font-medium">
          API Key
        </label>
        <input
          id="apiKey"
          name="apiKey"
          type="password"
          required
          autoComplete="off"
          placeholder="sk-..."
          className="rounded border bg-background px-3 py-2 text-sm font-mono"
        />
        <p className="text-xs text-muted-foreground">
          只在提交时通过 HTTPS 传输；服务端立刻加密。
        </p>
      </div>

      <button
        type="submit"
        className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        保存密钥
      </button>
    </form>
  );
}
