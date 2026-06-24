# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Loop is the orchestration layer of the ODW.ai sovereign agent suite. It connects ODW's individual agents (Vault, Desk, Recap) into automated, multi-step workflows that run entirely on customer infrastructure. This repository contains the product and technical specifications for implementation.

## Repository Structure

| File | Purpose |
|------|---------|
| `Goal.md` | Implementation goal and completion criteria — read this first |
| `prd.md` | Product Requirements Document — features, scope, success metrics |
| `tsd.md` | Technical Specification Document — detailed service breakdown, APIs, data models |
| `tbk.md` | Task Breakdown Document — phased implementation plan with task definitions |
| `sad.md` | System Architecture Document — high-level components, data flow, trade-offs |
| `research.md` | Competitive landscape analysis and market gap identification |

## Key Architecture Concepts

**Modular Monolith (Core Tier):** Single deployable unit hosting all internal modules (`@loop/*`). Designed for self-hosted SMB customers who lack platform engineering teams.

**Execution Model:** Event-driven, actor-based runtime with topological DAG scheduling. Core tier uses in-process execution (~50 concurrent workflows); Scale tier decomposes to distributed actor system with Redis/NATS.

**Service Structure:**
- `loop-canvas` — React 18 SPA (React Flow canvas, Zustand state, Tailwind)
- `loop-api` — Fastify HTTP/WS server hosting all `@loop/*` modules
- `loop-sandbox` — Isolated code execution (gVisor/Firecracker) for Python/TypeScript
- `loop-control-plane` — Multi-instance management (Scale tier only)

**Data Sovereignty:** First-class architectural constraint. Egress Policy Engine intercepts all outbound calls. SQLite for Core (zero-config), PostgreSQL+Redis for Scale.

## Implementation Approach

Per `Goal.md`, implementation should:
1. Read `tsd.md` and `tbk.md` to understand current status and remaining gaps
2. Work in small checkpoints, verifying changes after each
3. Update `DEVELOPMENT.md` with status, decisions, and blockers
4. Not invent scope beyond the specification documents

The TBK defines 7 phases across ~45-55 engineering-weeks, with 4 parallel workstreams (Backend Core, Connectors, Frontend, Security/Ops).

## Tech Stack (from TSD §3)

- **Backend:** TypeScript/Node.js, Fastify, pnpm workspaces
- **Frontend:** React 18, React Flow, Zustand, Tailwind CSS
- **Database:** SQLite (Core), PostgreSQL+Redis (Scale)
- **Isolation:** gVisor or Firecracker for code sandbox
- **Build:** pnpm, TypeScript project references, Vitest
