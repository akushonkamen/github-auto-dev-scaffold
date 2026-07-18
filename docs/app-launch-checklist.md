# GitHubAutoDev App — Launch Checklist

> v1 上线检查清单。逐项确认后方可 launch。

## A3 品牌与域名

### A3-1 品牌锁定

- [x] 品牌名：GitAutoDev
- [x] GitHub App 已注册（App ID 4331480，slug gitautodev）
- [x] GitHub App URL：https://github.com/apps/gitautodev
- [x] 内部文档品牌统一（本 checklist + PRD）

### A3-2 域名注册（待定）

**状态：GitAutoDev 已锁定 2026-07-18，域名候选待用户决定。**

候选域名：

| 域名 | 状态 | 备注 |
|---|---|---|
| `gitautodev.com` | 待查 | 首选主域名 |
| `gitautodev.app` | 待查 | .app 强制 HTTPS，技术感强 |
| `getgitautodev.com` | 待查 | .com 备份 |
| `gitautodev.dev` | 待查 | 与 GitHub .dev 同源 |

**后续步骤（用户决策后执行）：**

1. 确认候选域名的可用性（whois 查询）
2. 注册首选域名（推荐注册商：Cloudflare Registrar、Namecheap、Porkbun）
3. 配置 DNS：
   - `@` → Fly.io IP / CNAME
   - `www` → CNAME 到 `@`
4. 配置域名邮箱（可选）
5. 更新 GitHub App 的 Homepage URL
6. 更新 GitHub Pages / repo 描述

> 注意：域名注册本身不通过本管线处理，由用户单独决策后手动完成。

## A4 Infra

- [ ] Fly.io app 已创建
- [ ] Turso 数据库已创建并迁移
- [ ] GitHub App Webhook 配置
- [ ] 环境变量 `.env.production` 已配置
- [ ] CI/CD 管线已就绪

## A5 安全

- [ ] PAT 生成（repo-scoped，最少权限）
- [ ] Webhook secret 已设置
- [ ] 数据库连接串凭据轮换
- [ ] 日志级别：production
