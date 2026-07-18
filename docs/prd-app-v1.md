# PRD — GithubAutoDev App v1（SaaS 化）

> **状态**：pending approval（待用户确认范围后再拆 Issue）
> **起点 tag**：`v0.1.0`（开源骨架稳定版）
> **路径**：A — GitHub App + SaaS 仪表盘
> **作者**：akushonkamen
> **日期**：2026-07-18

## 1. 愿景

把现有 `akushonkamen/github-auto-dev-scaffold` 的 Issue→PR pipeline 包装成**多租户 GitHub App**，用户一键安装到自己的 repo，通过 Web 仪表盘查看状态、配置模型、追踪用量，订阅付费。

差异化定位（vs. Copilot Workspace / Cursor）：
- **端到端 Issue→Merge 自动化**（不只 chat-in-editor）
- **多模型 + 用户自带 key**（BYOK，无锁定）
- **中文团队友好**（v2 加 Feishu/Lark 集成，路径 C 元素合并）

## 2. 范围（v1 MVP）

### 2.1 In scope

- **GitHub App** 注册 + OAuth（marketplace 上架准备）
- **Web 仪表盘 v0**（Next.js）：
  - 登录（GitHub OAuth）
  - Installation 选择器（用户已授权的 repos 列表）
  - Issue→PR 实时状态列表（拉取 installation 的 webhook 事件）
  - 配置页（model / budget / context-paths，写入 Postgres，触发时注入）
  - 用量统计（per-PR 的 AI token / 时长）
- **后端 API**（Next.js API Routes v1）：
  - webhook 接收（`issues.opened` / `pull_request.*` / `label.*`）
  - 路由到现有 composite actions（通过 `workflow_dispatch` 触发 installation repo 的 workflow）
  - Postgres schema：`installations` / `runs` / `usage_logs` / `tenants` / `api_keys`
- **BYOK 模式**：用户在仪表盘填 `ANTHROPIC_API_KEY` / `LLM_API_KEY`，加密存 Postgres
- **Stripe 计费**（Free / Pro 两档）

### 2.2 Out of scope（v1 不做，留 v2）

- 代理 key 模式（Team 档，v2）
- Feishu/Lark 集成（v2，路径 C 元素）
- 自建 worker 池（v2 评估）
- 团队/组织级权限管理（v2）
- 自托管版（Enterprise，v3）
- 移动端 App

### 2.3 非目标

- **不重写引擎**：现有 `.github/actions/*` 直接复用，App 只做编排 + 路由 + 计费
- **不绕过 GitHub Actions ToS**：用户用自己的 Actions quota，我们收订阅费不是 Actions 转售费
- **不锁 key**：BYOK 优先，用户随时撤回

## 3. 用户故事

### US-001：安装 App
> 作为开发者，我希望在 GitHub Marketplace 点 "Install App"，授权到我的 repo，30 秒内看到仪表盘。

**验收标准**：
- GitHub App 注册完成，App ID + Private Key 生成
- OAuth callback handler 上线 `/api/auth/callback/github`
- 安装后首次访问仪表盘显示已授权 repo 列表

### US-002：配置引擎
> 作为用户，我希望在仪表盘填入 Anthropic / GLM API key，选择默认 model，配置预算（max-turns / time-budget）。

**验收标准**：
- 仪表盘 `/settings/engines` 页面能提交 key（masked 显示）
- key 写入 Postgres `api_keys` 表（字段级 AES-256 加密）
- 触发 workflow 时，通过 `workflow_dispatch` 的 `inputs` 注入 key（不写明文到 repo secret）

### US-003：查看 Issue→PR 链路
> 作为用户，我希望打开仪表盘就能看到当前 installation 的所有 Issue 处理进度（triage → clarify → develop → verify → test → review → merge）。

**验收标准**：
- 仪表盘 `/runs` 列表显示最近 50 个 run
- 每个 run 显示：Issue 标题、当前阶段、AI 用量、耗时、PR 链接
- 点击进入详情页，展示每阶段的 verdict / 输出摘要

### US-004：接收 webhook
> 作为系统，当用户 repo 有 Issue 被打开时，我能在 3 秒内收到 webhook 并触发 triage。

**验收标准**：
- `/api/webhook/github` 接收 `issues.opened` 事件
- 验证 signature（X-Hub-Signature-256）
- 落表 `runs` 表（status=pending）
- 通过 `installation_token` 调用 GitHub Actions API 触发 triage workflow

### US-005：用量计费
> 作为用户，我希望月底看到本月 PR 数 / AI token 消耗 / 是否超额，并能升级到 Pro。

**验收标准**：
- 仪表盘 `/usage` 显示当月 PR 数 / token 数 / 当前档位
- Free 档 5 PR/月达上限后阻断新 Issue 触发，提示升级
- Pro 档 $19/seat/月，Stripe Checkout 接入

## 4. 技术架构

### 4.1 分层

```
GitHub App (OAuth + webhook source)
    ↓
Next.js API Routes (app-server/)
    - /api/auth/*          NextAuth.js
    - /api/webhook/github  signature verify + route
    - /api/triggers/*      workflow_dispatch via installation_token
    - /api/usage           read Postgres
    ↓
Postgres (Supabase / Neon)
    - tenants, installations, runs, usage_logs, api_keys
    ↓
Web 仪表盘 (app-dashboard/ — 同 Next.js app router)
    - SSR + RSC
    - SSE 推送 run 状态
    ↓
引擎层（复用现有 .github/workflows + .github/actions）
    - 通过 workflow_dispatch 远程触发
    - run 结果通过 existing PR labels + Issue comments 回写
    - webhook 捕获 label / comment 事件 → 更新 Postgres
```

### 4.2 数据模型（Postgres schema v1）

```sql
-- tenants: 一个 GitHub user/org
CREATE TABLE tenants (
    id BIGSERIAL PRIMARY KEY,
    github_id BIGINT UNIQUE NOT NULL,
    github_login TEXT NOT NULL,
    plan TEXT DEFAULT 'free',  -- free | pro | team | enterprise
    stripe_customer_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- installations: GitHub App 安装实例
CREATE TABLE installations (
    id BIGSERIAL PRIMARY KEY,
    installation_id BIGINT UNIQUE NOT NULL,  -- from GitHub
    tenant_id BIGINT REFERENCES tenants(id),
    repo_full_name TEXT NOT NULL,  -- owner/name
    installed_at TIMESTAMPTZ DEFAULT NOW(),
    uninstalled_at TIMESTAMPTZ
);

-- runs: 一次 Issue→PR 的完整链路
CREATE TABLE runs (
    id BIGSERIAL PRIMARY KEY,
    installation_id BIGINT REFERENCES installations(id),
    issue_number INT NOT NULL,
    pr_number INT,
    current_stage TEXT,  -- triage | clarify | develop | verify | test | review | merge
    status TEXT,         -- pending | running | passed | failed | merged
    ai_tokens_used INT DEFAULT 0,
    ai_minutes_used REAL DEFAULT 0,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- usage_logs: 每次 AI 调用
CREATE TABLE usage_logs (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT REFERENCES runs(id),
    stage TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INT,
    output_tokens INT,
    cost_usd DECIMAL(10,4),
    called_at TIMESTAMPTZ DEFAULT NOW()
);

-- api_keys: 用户自带的 LLM key（加密）
CREATE TABLE api_keys (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT REFERENCES tenants(id),
    provider TEXT NOT NULL,  -- anthropic | glm | openai
    encrypted_key TEXT NOT NULL,  -- AES-256-GCM
    key_hint TEXT,  -- last 4 chars for display
    created_at TIMESTAMPTZ DEFAULT NOW(),
    rotated_at TIMESTAMPTZ
);
```

### 4.3 引擎复用策略

**不重写引擎**。现有 `.github/workflows/*.yml` + `.github/actions/*` 直接用，App 通过 `workflow_dispatch` 远程触发：

```typescript
// app-server/lib/trigger-workflow.ts
async function triggerTriage(installationId: number, issueNumber: number) {
  const token = await getAppInstallationToken(installationId);
  const res = await fetch(
    `https://api.github.com/repos/${repoFullName}/actions/workflows/triage-issue.yml/dispatches`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ref: 'dev', inputs: { 'issue-number': String(issueNumber) } })
    }
  );
}
```

引擎 run 结果通过 webhook 回写（现有 pipeline 已经会打 label + 评论，App 监听这些事件即可）。

### 4.4 密钥隔离

- **GitHub App Private Key**：环境变量 `APP_PRIVATE_KEY`（Vercel secret）
- **Postgres 加密主密钥**：KMS（AWS KMS / GCP KMS，Vercel 不能直接拿明文）
- **用户 API key**：`api_keys.encrypted_key` 字段，AES-256-GCM，主密钥从 KMS 派生
- **Webhook secret**：`WEBHOOK_SECRET`，验证 X-Hub-Signature-256

### 4.5 部署

| 服务 | 平台 | 成本预估（MVP） |
|---|---|---|
| 仪表盘 + API | Vercel Pro | $20/月 |
| Postgres | Neon free → Scale | $0 → $19/月 |
| Redis（webhook 去重） | Upstash | $0（免费层） |
| Stripe | Stripe | 抽佣 2.9% |
| 域名 | Cloudflare | $10/年 |
| 监控 | Sentry free | $0 |

**MVP 总成本**：~$30-50/月（不含 LLM，因为 BYOK）。

## 5. 定价

| 档位 | 月费 | 含 | 超出 |
|---|---|---|---|
| Free | $0 | BYOK，5 PR/月，社区支持 | 阻断 |
| Pro | $19/seat | BYOK，无限 PR，仪表盘高级功能，邮件支持 | — |
| Team（v2） | $49/seat | + 代理 key（含 $30 token 额度）+ 优先支持 | $0.01/1K tokens |
| Enterprise（v3） | 联系销售 | 自托管 + SSO + SLA | 定制 |

**目标转化率**：10% Free → Pro（行业基准 5-15%）。

## 6. 安全红线（继承开源版 S1-S7 + 新增）

继承 CLAUDE.md 的 S1-S7，外加：

- **S8 — 多租户隔离**：任何 API 必须校验 `tenant_id` ownership；不可跨租户读 `runs` / `api_keys`。
- **S9 — Key 加密**：用户 API key 入库前必须 AES-256-GCM 加密；主密钥在 KMS，不在代码 / 环境变量明文。
- **S10 — Webhook signature**：所有 GitHub webhook 必须验签；未验签的请求直接 403。
- **S11 — Installation token 短期性**：`installation_access_token` 缓存不超过 50 分钟（GitHub 上限 1 小时）；过期前重新签发。
- **S12 — BYOK 不可回传**：用户的 LLM key 只在触发 workflow 时通过 `inputs` 注入，不写日志、不写 issue comment、不进 Postgres 明文字段。

## 7. 30/60/90 天里程碑

### Day 0-30：MVP

- [ ] GitHub App 注册（US-001）
- [ ] Next.js 项目脚手架（app-server + app-dashboard）
- [ ] Postgres schema v1（4 张表）
- [ ] OAuth 登录（US-001）
- [ ] Webhook 接收 + 验签（US-004）
- [ ] workflow_dispatch 触发现有 triage（US-004）
- [ ] 仪表盘 runs 列表（US-003）
- [ ] BYOK 配置页（US-002）
- [ ] **dogfood**：把 `akushonkamen/github-auto-dev-scaffold` 自己接入

### Day 31-60：计费 + 上架

- [ ] Stripe 接入（Free / Pro）
- [ ] 用量统计页（US-005）
- [ ] 5 PR/月配额阻断（US-005）
- [ ] Marketplace 上架（Free 档）
- [ ] 邀请 5-10 beta 用户
- [ ] 根据反馈迭代

### Day 61-90：差异化 + 增长

- [ ] 代理 key 模式（Team 档）
- [ ] Feishu/Lark 集成 PoC
- [ ] 公开 landing page（SEO）
- [ ] 技术博客 + HN/PH launch
- [ ] 目标：100 安装，MRR $2K+

## 8. 风险登记

| ID | 风险 | 严重度 | 概率 | 对策 |
|---|---|---|---|---|
| R1 | GitHub Actions ToS 禁止转售 Actions 分钟 | 🔴 | 低 | 明确订阅费不是 Actions 转售；用户用自己的 quota |
| R2 | Copilot Workspace 竞争 | 🟡 | 高 | 差异化（端到端 + 多模型 + 中文） |
| R3 | 多租户 secret 泄漏 | 🔴 | 低 | S8/S9 + 第三方安全审计 v1 前 |
| R4 | LLM 成本失控（BYOK 下用户承担，影响留存） | 🟡 | 中 | 仪表盘预算告警 + per-run turn limit |
| R5 | 用户 repo 被 AI 误改 | 🟡 | 中 | 强制 PR review gate；分支保护不可被 App 关闭 |
| R6 | Vercel function 超时（webhook 处理慢） | 🟢 | 中 | webhook 入 Upstash Queue 异步处理 |
| R7 | NextAuth + GitHub App 的 installation_id 传递坑 | 🟡 | 中 | v1 单租户简化（一个 user 一个 installation），v2 再做多 installation |

## 9. 成功指标（v1 出炉后 90 天）

| 指标 | 目标 |
|---|---|
| Marketplace 安装数 | 100+ |
| 周活跃 installation（WAU） | 30+ |
| Free → Pro 转化率 | 10%+ |
| 付费用户 MRR | $2K+ |
| 平均 NPS | 30+ |
| 关键 bug（数据丢失/key 泄漏） | 0 |

## 10. 决策点（已锁定 2026-07-18）

1. **品牌名**：`GitAutoDev` ✅ LOCKED — 与仓库名 `github-auto-dev-scaffold` 一脉相承，名字直白无歧义；GitHub App 已注册（App ID `4331480`，slug `gitautodev`，URL https://github.com/apps/gitautodev）。前期候选 Cyclo 在实际注册时被用户改回。
2. **域名**：待定（候选 `gitautodev.com` / `gitautodev.app` / `getgitautodev.com` / `gitautodev.dev`）— 由用户单独决策
3. **GitHub App 名**：`GitAutoDev` ✅ LOCKED + 已注册（影响 marketplace URL）
4. **代码仓库**：✅ monorepo（当前 repo 加 `app/`）— Issue #156 已落地 Next.js 脚手架
5. **v1 开源策略**：✅ 完全开源（路径 A 完整版）
6. **是否走 YC / 种子轮**：✅ 自筹（v1 MVP 阶段）；融资决策推迟到 100 安装 + $2K MRR 验证后

### 待解决（v1 MVP 后置）

7. **公司实体**：先个人跑（Stripe 个人账户 + Wise USD 收款）；新加坡 LLC 评估推迟到 Stripe 验证通过后
8. **Stripe 收款路径**：Wise USD 账户（开 Wise → 绑 Stripe）；不注册海外公司

---

**下一步**：launch checklist A3-1 ~ A3-7 立即可做的手动项推进（域名 / GitHub App / Neon / Upstash / Vercel），代码 Issue #2 已开 (#162) 等 pipeline 跑完。
