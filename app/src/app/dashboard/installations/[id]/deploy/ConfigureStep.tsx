"use client";

import { useState } from "react";

export interface WizardConfig {
  llmKey: string;
  claudePat: string;
  claudePatOwner: string;
  baseBranch: string;
}

interface Props {
  config: WizardConfig;
  onChange: (next: WizardConfig) => void;
  onBack: () => void;
  onApply: () => void;
}

export function ConfigureStep({ config, onChange, onBack, onApply }: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [touched, setTouched] = useState(false);

  const llmKeyValid = config.llmKey.trim().length >= 8;
  // Classic PAT (ghp_...) with `repo` + `workflow` scope OR fine-grained
  // PAT (github_pat_...). Required — GitHub App tokens can't write Actions
  // vars/secrets.
  const patTrim = config.claudePat.trim();
  const patValid =
    patTrim.startsWith("ghp_") || patTrim.startsWith("github_pat_");
  const ownerValid = config.claudePatOwner.trim().length > 0;
  const branchValid = /^[a-z0-9._/-]+$/i.test(config.baseBranch.trim()) && config.baseBranch.trim().length > 0;
  const canApply = llmKeyValid && patValid && ownerValid && branchValid;

  function update<K extends keyof WizardConfig>(key: K, value: string) {
    onChange({ ...config, [key]: value });
    setTouched(true);
  }

  return (
    <div className="space-y-4">
      <section className="rounded-md border p-4 space-y-3">
        <h2 className="text-lg font-semibold">必填：LLM API Key</h2>
        <p className="text-sm text-muted-foreground">
          将作为 Actions secret <code>LLM_API_KEY</code> 加密写入目标 repo。S4：不回显、不入数据库。
        </p>
        <Field
          id="llmKey"
          label="LLM_API_KEY"
          type="password"
          placeholder="sk-..."
          value={config.llmKey}
          onChange={(v) => update("llmKey", v)}
          invalid={touched && !llmKeyValid}
          helper={touched && !llmKeyValid ? "至少 8 个字符" : undefined}
        />
      </section>

      <section className="rounded-md border p-4 space-y-3">
        <h2 className="text-lg font-semibold">必填：部署用 PAT</h2>
        <p className="text-sm text-muted-foreground">
          GitHub App 的 installation token 调 Actions vars/secrets API 会被
          GitHub 限制（403 &ldquo;Resource not accessible by integration&rdquo;）。
          必须提供 PAT 才能写入 vars/secrets/branch protection。S4：不回显、不入数据库。
        </p>
        <Field
          id="claudePat"
          label="CLAUDE_DEV_PAT"
          type="password"
          placeholder="ghp_... 或 github_pat_..."
          value={config.claudePat}
          onChange={(v) => update("claudePat", v)}
          invalid={touched && !patValid}
          helper={
            touched && !patValid
              ? "必须以 ghp_ 或 github_pat_ 开头"
              : "classic PAT：需 repo + workflow scope。fine-grained：需 Contents=RW, Actions=RW, Administration=RW。≤90 天。"
          }
        />
        <Field
          id="owner"
          label="CLAUDE_DEV_PAT_OWNER"
          type="text"
          value={config.claudePatOwner}
          onChange={(v) => update("claudePatOwner", v)}
          invalid={touched && !ownerValid}
          helper="PAT 的拥有者 login"
        />
      </section>

      <section className="rounded-md border p-4 space-y-3">
        <h2 className="text-lg font-semibold">基础分支</h2>
        <Field
          id="baseBranch"
          label="DEV_BASE_BRANCH"
          type="text"
          value={config.baseBranch}
          onChange={(v) => update("baseBranch", v)}
          invalid={touched && !branchValid}
          helper="PR 合入目标分支，默认 dev"
        />
      </section>

      <section className="rounded-md border p-4">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-sm underline text-muted-foreground"
        >
          {showAdvanced ? "收起高级配置" : "高级（24 vars 已用默认值，点开自定义）"}
        </button>
        {showAdvanced && (
          <p className="mt-2 text-sm text-muted-foreground">
            默认值见 <code>DEFAULT_VARS</code>。如需自定义特定 var，部署后到目标 repo Actions
            settings 修改即可。本期 UI 暂不暴露 24 个表单字段。
          </p>
        )}
      </section>

      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
        >
          返回
        </button>
        <button
          type="button"
          disabled={!canApply}
          onClick={onApply}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          开始部署
        </button>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  type,
  value,
  onChange,
  placeholder,
  invalid,
  helper,
}: {
  id: string;
  label: string;
  type: "text" | "password";
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  invalid?: boolean;
  helper?: string;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type={type}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-md border bg-background px-3 py-2 text-sm ${
          invalid ? "border-destructive" : "border-input"
        }`}
      />
      {helper && (
        <p className={`text-xs ${invalid ? "text-destructive" : "text-muted-foreground"}`}>
          {helper}
        </p>
      )}
    </div>
  );
}
