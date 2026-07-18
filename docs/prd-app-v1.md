# GitHubAutoDev App — PRD v1

> Product Requirements Document for the GitHubAutoDev companion app (Next.js + Drizzle + Turso).

## §1 概述

GitHubAutoDev App v1 是 GitHubAutoDev 自动化管线的配套 Web 应用，提供 Issue 可视化看板、配置管理、以及管线运行状态监控。

## §10 决策点

本 PRD 的记录决策日志。

| 决策 | 选择 | 日期 | 备注 |
|---|---|---|---|
| 品牌名 | **GitAutoDev ✅ LOCKED（GitHub App 已注册，App ID 4331480，slug gitautodev）** | 2026-07-18 | 用户在注册 GitHub App 时确认。仓库名为 github-auto-dev-scaffold，slug 为 gitautodev。 |
| 域名 | 待定（候选：gitautodev.com / gitautodev.app / getgitautodev.com） | 2026-07-18 | 域名未注册，待用户决策。候选列表已排除被占用/否决的选项。 |
| GitHub App 名 | **GitAutoDev（已注册 https://github.com/apps/gitautodev）** | 2026-07-18 | App ID 4331480，slug gitautodev，权限范围：issues/PRs/webhooks。 |
| 框架 | Next.js 15 + App Router | 2026-06-15 | 见架构文档 |
| 数据库 | Turso (libsql) + Drizzle ORM | 2026-06-15 | 边缘优先，无需自托管 |
| 认证 | GitHub App JWT | 2026-06-15 | 与管线共用 token |
| 部署 | Fly.io + Fly Postgres → Turso 迁移 | 2026-07-10 | 第一阶段暂用 Postgres，GA 前迁 Turso |
