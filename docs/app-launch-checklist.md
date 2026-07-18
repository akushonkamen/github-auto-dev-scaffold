# GithubAutoDev App 启动操作清单（非代码部分）

> 这些事项不需要写代码，但**必须在写第一行 App 代码之前完成**。建议并行推进。

## A3-1：GitHub App 注册（必须，~30 分钟）

### 步骤

1. 打开 https://github.com/settings/apps/new（个人账号）或 https://github.com/organizations/<org>/settings/apps/new（组织）
2. 填写：
   - **GitHub App name**：`GithubAutoDev`（建议，或你定的品牌名）
   - **Homepage URL**：`https://<你的域名>`（先填 placeholder，拿到域名后改）
   - **Webhook URL**：`https://<你的域名>/api/webhook/github`
   - **Webhook secret**：随机生成 32 字节，记到密码管理器（同时也是 `WEBHOOK_SECRET` 环境变量）
   - **Repository permissions**：
     - Issues: **Read & write**
     - Pull requests: **Read & write**
     - Contents: **Read & write**
     - Metadata: **Read-only**（默认必选）
     - Workflows: **Read & write**（触发 workflow_dispatch 必需）
     - Labels: **Read & write**
   - **Subscribe to events**：
     - Issues
     - Pull request
     - Label
     - Issue comment
     - Pull request review
     - Workflow run
     - Installation
   - **Where can this GitHub App be installed**：`Any account`（v1 允许任何人装，v2 可改仅限本组织）
3. 创建后立刻**下载 Private Key `.pem` 文件**（只能下载一次，丢了得重新生成）
4. 记下：
   - **App ID**（数字，形如 `123456`）
   - **Client ID**（形如 `Iv1.abcdef1234567890`）
   - **Client Secret**（生成一次，记下）
   - **Private Key**（`.pem` 内容，base64 后作为 `APP_PRIVATE_KEY` 环境变量）
   - **Webhook secret**（上面生成的）

### 产出

- 一份 GitHub App（status: development，未发布）
- `APP_PRIVATE_KEY` / `GITHUB_APP_ID` / `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `WEBHOOK_SECRET` 五个值，待写入 Vercel env

### 预估时间：30 分钟

---

## A3-2：域名注册（待定）

> 品牌 **GitAutoDev** 已锁定（GitHub App 已注册，App ID `4331480`，slug `gitautodev`，https://github.com/apps/gitautodev）。域名候选待用户决定。

### 推荐

- **Cloudflare Registrar**（最便宜，无加价续费）：https://dash.cloudflare.com/?to=/:domains/registrar
- 次选：Porkbun / Namecheap

### 候选名（GitAutoDev 已锁定 2026-07-18，域名候选待用户决定）

| 域名 | 状态 | 备注 |
|---|---|---|
| **`gitautodev.com`** | 待查 | 首选主域名 |
| **`gitautodev.app`** | 待查 | .app 强制 HTTPS，技术感强 |
| `getgitautodev.com` | 待查 | .com 备份 |
| `gitautodev.dev` | 待查 | 与 GitHub .dev 同源 |

### 操作

1. 登录 Cloudflare（若无账号先注册）
2. whois 查询 4 个候选域名的可用性
3. 选 1 个主域名（推荐 `gitautodev.com`） + 1 个备份 → 加入购物车
4. 结账
5. **不需要买附加服务**（DNS 免费、SSL 免费、WHOIS 隐私 Cloudflare 免费送）
6. 注册后**保持域名在 Cloudflare DNS**（不要转出）— 后面 Vercel 用 CNAME 接入即可

### 产出

- 主域名 + 备份域名 + Cloudflare DNS 控制权
- 主域名解析权 → Vercel（部署后配）
- 备份域名 → 重定向到主域名（部署后配）

---

## A3-3：Stripe 账号（建议先做，验证需 1-2 周）

### 步骤

1. 注册：https://dashboard.stripe.com/register
2. 填写业务信息：
   - **公司/个人**：先个人（升级公司后续做）
   - **业务类型**：SaaS / Software
   - **产品描述**：`Automated GitHub Issue to Pull Request pipeline`
   - **月收入预估**：`< $50K`
3. **验证身份**：上传身份证 / 护照（中国身份证可过，需中文翻译件有时）
4. **绑定银行账户**：
   - 中国大陆用户：需要 Stripe Atlas 或用海外银行（如 Wise / Mercury）
   - 推荐路径：开 Wise 账户 → 绑定 Wise USD 账户到 Stripe
5. **启用测试模式**：拿到 `pk_test_*` + `sk_test_*` 两个 key

### 产出

- Stripe 账号（测试模式可用）
- `STRIPE_PUBLISHABLE_KEY` + `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` 三个值（test 模式）

### ⚠️ 注意

- Stripe 中国大陆**不支持**直接收款到大陆银行账户
- 必须用 Wise / Mercury / 海外银行
- 公司实体建议注册新加坡 / 美国 LLC（Stripe Atlas $500，2-4 周）

---

## A3-4：LLM API key（dogfood 用，必须）

> App 自己 dogfood 时（`akushonkamen/github-auto-dev-scaffold` 接入自己）需要 key。

### 推荐

- **Anthropic Console**：https://console.anthropic.com/ → 充值 $20 → 建一个 key（claude-3-5-sonnet / opus 权限）
- **智谱 GLM**：https://open.bigmodel.cn/ → 实名 → 充值 ¥100 → 建 key（与现有 `LLM_API_KEY` 一致）

### 产出

- `ANTHROPIC_API_KEY`（你的，dogfood 用）
- `LLM_API_KEY`（GLM，dogfood 用）

---

## A3-5：Vercel 部署环境（MVP 阶段，~10 分钟）

### 步骤

1. 注册 Vercel：https://vercel.com/signup（用 GitHub 登录）
2. 新建 project（先不连代码库，先把环境变量备好）
3. 在 project settings → Environment Variables，提前备好（先不填）：
   - `APP_PRIVATE_KEY`
   - `GITHUB_APP_ID`
   - `GITHUB_CLIENT_ID`
   - `GITHUB_CLIENT_SECRET`
   - `WEBHOOK_SECRET`
   - `NEXTAUTH_SECRET`（随机 32 字节）
   - `NEXTAUTH_URL`（=你的域名）
   - `DATABASE_URL`（待 Neon / Supabase 创建后填）
   - `STRIPE_PUBLISHABLE_KEY`
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `KMS_MASTER_KEY_ID`（待 KMS 配置后填）

### Vercel 套餐

- **Free**：Hobby 计划够 v1 MVP（100 installation 内）
- **Pro**：$20/月，需要当月用量超 100GB bandwidth / 函数执行时间 > 100h

### 产出

- Vercel project 准备好接代码

---

## A3-6：Postgres（Neon 或 Supabase，~10 分钟）

### 推荐：Neon

- 优点：完全 Postgres 兼容、免费层够大（3GB storage / 100 compute hours）、分支功能好
- 注册：https://neon.tech/

### 步骤

1. 注册 Neon（GitHub 登录）
2. New Project → Region 选 `AWS ap-east-1`（香港，国内访问快）
3. 拿到 `DATABASE_URL`（形如 `postgresql://user:pass@host/db?sslmode=require`）
4. 把 `DATABASE_URL` 写入 Vercel env

### 替代：Supabase

- 优点：自带 dashboard、auth、storage（一站式）
- 缺点：免费层只有 500MB storage
- 注册：https://supabase.com/

### 产出

- 一个 Postgres 实例 + `DATABASE_URL`

---

## A3-7：Redis（Upstash，~5 分钟）

### 用途

- webhook 去重（GitHub 会重发）
- 限流
- 短期缓存 installation_token（< 50 分钟）

### 步骤

1. 注册：https://upstash.com/
2. Create Database → Region `us-east-1` 或 `ap-east-1`
3. 拿到 `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`

### 产出

- Redis 实例 + 两个 env 值

---

## A3-8：KMS 主密钥（S9 必需，~15 分钟）

### 用途

加密用户 API key（`api_keys.encrypted_key`）的主密钥。

### 选项 A：AWS KMS（推荐，便宜）

1. 注册 AWS（如无）
2. IAM → Encryption keys → Create key
3. Symmetric key / 256 GCM / alias `github-auto-dev-master`
4. 拿到 Key ARN
5. AWS root 账号绝对不要泄露；建 IAM 用户只给 `kms:Encrypt` + `kms:Decrypt` 权限

### 选项 B：GCP KMS

类似流程。

### 选项 C（v1 简化）：环境变量主密钥

- ⚠️ 安全性弱，仅限 v1 MVP
- 生成 32 字节随机串：`openssl rand -hex 32`
- 写入 Vercel env `MASTER_ENCRYPTION_KEY`
- **v2 必须迁移到 KMS**

---

## A3-9：监控（Sentry，~5 分钟）

1. 注册 Sentry：https://sentry.io/signup/
2. Create Project → Next.js
3. 拿到 `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN`

---

## A3-10：法律页面（~1 小时，可推迟到 marketplace 上架前）

### 必需文档

- **Terms of Service**：参考 Linear / Vercel 改
- **Privacy Policy**：说明你收集哪些数据（GitHub user data / API key 加密存储 / usage 日志）
- **DPA**（Data Processing Agreement）：欧盟用户必需

### 模板

- Termsfeed：https://www.termsfeed.com/
- iubenda：https://www.iubenda.com/

---

## A3-11：Marketplace 上架准备（v1 beta 后，~2 小时）

### GitHub Marketplace 审核

1. https://github.com/marketplace/new
2. 选 GitHub App（不是 Action）
3. 填写：
   - App name + listing description
   - 截图（仪表盘、Issue→PR 链路、用量页）
   - Pricing plans（Free / Pro）
4. 提交审核（1-2 周）

### 审核要点

- 必须有公开的 ToS + Privacy Policy
- 必须有 support email
- webhook URL 必须可用且验签
- OAuth callback 必须工作

---

## 总计时间预估

| 任务 | 时间 | 阻塞条件 |
|---|---|---|
| A3-1 GitHub App | 30min | 域名（先用 placeholder 也行） |
| A3-2 域名 | 10min | 信用卡 |
| A3-3 Stripe | 2-4 周（验证） | 海外银行 / 公司实体 |
| A3-4 LLM key | 15min | 实名认证（GLM） |
| A3-5 Vercel | 10min | 无 |
| A3-6 Postgres | 10min | 无 |
| A3-7 Redis | 5min | 无 |
| A3-8 KMS | 15min | AWS 账号 |
| A3-9 Sentry | 5min | 无 |
| A3-10 法律 | 1h | 可推迟 |
| A3-11 Marketplace | 2h + 1-2 周审核 | v1 beta 完成 |

**立即可做**：A3-1, A3-2, A3-4, A3-5, A3-6, A3-7, A3-8, A3-9（合计 ~2 小时）
**延后做**：A3-3（验证慢）、A3-10（beta 前）、A3-11（beta 后）

---

## 决策清单（待你确认）

1. **品牌名**：`GithubAutoDev` / `IssueFlow` / `AutoMerge` / `Clawbridge` / 其他？
2. **域名**：先抢哪个（`.dev` 优先）？
3. **公司实体**：先个人跑还是直接开新加坡 LLC？
4. **Stripe 收款**：用 Wise 还是注册海外公司？
5. **App 开源策略**：完全闭源 / 仪表盘闭源引擎开源 / 完全开源？
6. **是否融资**：自筹 / pre-seed / YC W27？
