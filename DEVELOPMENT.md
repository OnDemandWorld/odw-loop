# Loop — Development Status

**Last Updated:** 2026-06-24
**Status:** Pre-Implementation (Research & Specification Complete)

---

## Current State

### Completed
- [x] Product Requirements Document (PRD) — `prd.md`
- [x] System Architecture Document (SAD) — `sad.md`
- [x] Technical Specification Document (TSD) — `tsd.md`
- [x] Task Breakdown Document (TBK) — `tbk.md`
- [x] Competitive landscape research — `research.md`
- [x] Open-source reference repository analysis (12 platforms)
- [x] 6 reference repositories cloned to `reference/` directory
- [x] All spec documents updated with research findings and reference implementation guide

### Reference Repositories (in `reference/`)
| Repository | License | Primary Use for Loop |
|-----------|---------|---------------------|
| Activepieces | MIT | Piece SDK, trigger system, monorepo, React Flow canvas |
| n8n | Fair-code (SUL) | Execution engine, credentials, webhooks, error handling |
| Flowise | Apache 2.0 | React Flow visual builder, LLM integration |
| Trigger.dev | Apache 2.0 | Durable execution engine, retry logic, TypeScript API |
| Inngest | Apache 2.0 | Event-driven step functions, event matching |
| Windmill | AGPLv3 | Multi-language execution, Rust performance, RBAC |

### Not Started
- [ ] Phase 1: INFRA — Project Setup & Infrastructure
- [ ] Phase 2: CORE — Core Backend Services
- [ ] Phase 3: ENGINE — Execution Engine
- [ ] Phase 4: CONN — Connectors & Integrations
- [ ] Phase 5: TRIG — Triggers & Event System
- [ ] Phase 6: FE — Frontend Canvas Application
- [ ] Phase 7: SEC — Security, Egress & Observability

---

## Implementation Plan

Follow the TBK's 7-phase execution plan:

1. **Phase 1 (Week 1):** Monorepo scaffolding, TypeScript config, Docker, CI/CD, DB migrations, env config, logging
2. **Phase 2 (Weeks 2-3):** State store (SQLite + PostgreSQL), auth, RBAC, API gateway, workflow authoring, WebSocket
3. **Phase 3 (Weeks 4-6):** Execution engine (DAG scheduler, state machine, executor, retry, circuit breaker, control nodes)
4. **Phase 4 (Weeks 5-6):** All API endpoints from TSD §5
5. **Phase 5 (Weeks 5-7):** React canvas, node library, config panel, execution monitor, metrics, admin panel
6. **Phase 6 (Weeks 6-7):** Encryption, secrets, egress, sandbox, audit, Prometheus, OpenTelemetry
7. **Phase 7 (Weeks 8-9):** Testing (unit, integration, E2E), Docker images, Helm chart, documentation

**Critical Path:** INFRA → State Store → Workflow Authoring → Execution Engine → API Routes → Frontend Canvas → E2E Tests

---

## Decisions Made

| Decision | Rationale | Date |
|----------|-----------|------|
| Apache 2.0 license for Core tier | Permissive, allows commercial Scale tier differentiation, patent protection | 2026-06-24 |
| Hybrid execution model | Topological sort (Kahn's) + worklist stack (from n8n) + join map for multi-input + modular subsystems (from Trigger.dev) | 2026-06-24 |
| gVisor primary, Firecracker fallback for sandbox | n8n CVEs (2025) prove VM/WASM sandboxing insufficient | 2026-06-24 |
| React Flow for canvas | De facto standard — used by Flowise, Activepieces, Langflow | 2026-06-24 |
| Envelope encryption for Scale tier | n8n's production-grade pattern with key rotation | 2026-06-24 |
| Extend state machine with WAITPOINTS/SUSPENDED | Trigger.dev's durable execution pattern for human-in-the-loop | 2026-06-24 |

---

## Known Risks

| Risk | Mitigation |
|------|------------|
| Code Node sandbox escape | Use gVisor/Firecracker (validated by n8n CVE research) |
| SQLite write contention at 50 concurrent | WAL mode + hard cap; upgrade path to PostgreSQL |
| ODW agent API instability | Adapter layer + mock servers for development |
| Local LLM latency | Early benchmarking; remote API fallback |
