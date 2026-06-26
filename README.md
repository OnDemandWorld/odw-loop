# ODW Loop

> Workflow orchestration engine for the ODW.ai sovereign agent suite

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/OnDemandWorld/odw-loop/actions)
[![Tests](https://img.shields.io/badge/tests-244%20passing-brightgreen)](#testing)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue)](https://www.typescript.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

ODW Loop is a production-ready workflow orchestration platform that connects ODW's sovereign agents (Vault, Desk, Recap) into automated, multi-step workflows. Built as a TypeScript monorepo with a Fastify backend, React Flow canvas, and comprehensive test coverage.

## 🎯 Overview

**Problem:** Teams need to automate workflows across multiple AI agents while maintaining data sovereignty and control.

**Solution:** Loop provides visual workflow building with DAG-based execution, native ODW agent integration, and enterprise-grade security features.

**Key Features:**
- 🎨 Visual workflow builder with React Flow canvas
- ⚡ DAG-based execution engine with topological scheduling
- 🔒 Enterprise security (encryption, egress policies, RBAC, audit logging)
- 🔌 Native ODW agent connectors (Vault, Desk, Recap)
- 🤖 7 LLM providers with automatic failover
- 📊 Real-time execution monitoring with WebSocket updates
- 🚀 Production-ready with Docker, Helm, and CI/CD

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        React Canvas                          │
│                   (React Flow + Tailwind)                    │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP/WebSocket
┌────────────────────────▼────────────────────────────────────┐
│                      Fastify API Server                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Auth  │  RBAC  │  Rate Limit  │  CORS  │  Metrics  │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
┌───────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐
│   Engine     │  │ Connectors  │  │  Triggers   │
│  (DAG + FSM) │  │  (Vault,    │  │  (Cron,     │
│              │  │   Desk,     │  │   Webhook,  │
│              │  │   Recap)    │  │   Event)    │
└───────┬──────┘  └──────┬──────┘  └─────────────┘
        │                │
┌───────▼────────────────▼───────────────────────────────────┐
│                    State Store Layer                         │
│              (SQLite Core / PostgreSQL Scale)                │
└─────────────────────────────────────────────────────────────┘
```

## 🛠️ Tech Stack

**Backend:**
- TypeScript 5.4, Node.js 20+
- Fastify 4 (HTTP/WebSocket server)
- Drizzle ORM (SQLite + PostgreSQL)
- Pino (structured logging)
- Jose (JWT authentication)

**Frontend:**
- React 18, TypeScript
- React Flow 11 (workflow canvas)
- Tailwind CSS (styling)
- Vite (build tool)

**Infrastructure:**
- Docker + Docker Compose (Core tier)
- Helm + Kubernetes (Scale tier)
- GitHub Actions (CI/CD)
- Vitest (testing)

## 📦 Monorepo Structure

```
loop/
├── apps/
│   ├── api/              # Fastify HTTP/WS server
│   ├── canvas/           # React Flow frontend
│   ├── sandbox/          # Code execution sandbox
│   └── control-plane/    # Multi-instance management
├── packages/
│   ├── types/            # Shared Zod schemas
│   ├── state/            # State store (SQLite/PostgreSQL)
│   ├── engine/           # DAG execution engine
│   ├── connectors/       # ODW agent adapters
│   ├── triggers/         # Trigger handlers
│   ├── workflow-authoring/ # Workflow CRUD
│   ├── versioning/       # Git-based versioning
│   ├── secrets/          # Encryption + secrets
│   ├── egress/           # Network policies
│   ├── observability/    # Metrics + logging
│   └── llm/              # LLM provider abstraction
├── tests/
│   ├── unit/             # 162 unit tests
│   ├── integration/      # 55 integration tests
│   └── e2e/              # 27 E2E tests
├── docker/               # Dockerfiles
├── helm/                 # Kubernetes charts
└── templates/            # Workflow templates
```

## 🚀 Quick Start

### Prerequisites

- Node.js 20+ and pnpm 9+
- Docker and Docker Compose (for containerized deployment)

### Installation

```bash
# Clone repository
git clone git@github.com:OnDemandWorld/odw-loop.git
cd loop

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run development server
pnpm dev
```

### Docker Deployment

```bash
# Start Core tier (single instance)
docker-compose up -d

# Access the application
open http://localhost:3000
```

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# Required
LOOP_ENCRYPTION_KEY=your-32-char-encryption-key
LOOP_JWT_SECRET=your-jwt-secret

# Database (Core tier uses SQLite by default)
LOOP_DB_TYPE=sqlite
LOOP_DB_PATH=./data/loop.db

# For PostgreSQL (Scale tier)
# LOOP_DB_TYPE=postgres
# LOOP_DB_HOST=localhost
# LOOP_DB_PORT=5432
# LOOP_DB_NAME=loop
# LOOP_DB_USER=loop
# LOOP_DB_PASSWORD=your-password
```

## 🧪 Testing

```bash
# Run all tests (244 tests)
pnpm test

# Run specific test suites
pnpm test:unit        # 162 unit tests
pnpm test:integration # 55 integration tests
pnpm test:e2e         # 27 E2E tests

# Run with coverage
pnpm test:coverage
```

**Test Coverage:**
- Unit tests: Engine, connectors, triggers, state store, encryption
- Integration tests: API endpoints, workflow execution, triggers
- E2E tests: Meeting→Tasks→KB workflow, RBAC, egress policies, sandbox isolation

## 📖 API Documentation

### Authentication

All API endpoints require authentication via JWT or API key:

```bash
# Login
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "password"}'

# Use token
curl http://localhost:3000/api/v1/workflows \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Workflows

```bash
# Create workflow
POST /api/v1/workflows

# List workflows
GET /api/v1/workflows?page=1&per_page=20&status=active

# Get workflow
GET /api/v1/workflows/:id

# Update workflow
PUT /api/v1/workflows/:id

# Execute workflow
POST /api/v1/workflows/:id/execute
```

### Executions

```bash
# List executions
GET /api/v1/executions?workflow_id=xxx&status=running

# Get execution with nodes
GET /api/v1/executions/:id

# Cancel execution
POST /api/v1/executions/:id/cancel

# WebSocket for real-time updates
ws://localhost:3000/ws/executions/:id
```

### Triggers

```bash
# Create webhook trigger
POST /api/v1/workflows/:id/triggers
{
  "trigger_type": "webhook",
  "config": { "secret": "your-hmac-secret" }
}

# Webhook endpoint
POST /webhooks/:trigger_id
```

## 🏭 Deployment

### Core Tier (Single Instance)

```bash
# Build Docker images
docker build -t loop-app:latest -f docker/Dockerfile.app .
docker build -t loop-sandbox:latest -f docker/Dockerfile.sandbox .

# Start with Docker Compose
docker-compose up -d
```

### Scale Tier (Kubernetes)

```bash
# Add Helm repo
helm repo add loop ./helm

# Install with custom values
helm install loop ./helm/loop \
  --set global.encryptionKey=your-key \
  --set global.jwtSecret=your-secret \
  --set postgresql.auth.password=your-db-password
```

## 🔒 Security Features

- **Encryption at Rest:** AES-256-GCM with HKDF key derivation
- **Egress Policies:** Domain/IP/region-based network controls
- **RBAC:** Role-based access control (read/write/admin)
- **Audit Logging:** Complete audit trail for all operations
- **Webhook Verification:** HMAC-SHA256 signature validation
- **Sandbox Isolation:** Code execution in isolated containers

## 📊 Monitoring

Prometheus metrics available at `/metrics`:

- `loop_executions_total` - Execution count by status
- `loop_execution_duration_seconds` - Execution duration histogram
- `loop_connector_calls_total` - Connector API calls
- `loop_circuit_breaker_state` - Circuit breaker states
- And 11 more metrics...

## 🤝 Contributing

See [DEVELOPMENT.md](DEVELOPMENT.md) for detailed development guidelines.

```bash
# Development workflow
pnpm install
pnpm dev          # Start dev server with hot reload
pnpm typecheck    # Type check all packages
pnpm lint         # Run ESLint
pnpm build        # Build all packages
pnpm test         # Run all tests
```

## 📚 Documentation

- [DEVELOPMENT.md](DEVELOPMENT.md) - Development status and decisions
- [prd.md](prd.md) - Product Requirements Document
- [tsd.md](tsd.md) - Technical Specification Document
- [tbk.md](tbk.md) - Task Breakdown Document
- [sad.md](sad.md) - System Architecture Document
- [research.md](research.md) - Competitive landscape analysis

## 🔮 Future Improvements

### High Priority
- [ ] Real-time collaborative editing (multi-user workflow editing)
- [ ] Workflow marketplace (share and discover workflows)
- [ ] Natural language workflow generation (AI-assisted workflow creation)
- [ ] Advanced scheduling (timezones, business hours, dependencies)
- [ ] Workflow versioning UI (visual diff, rollback)

### Medium Priority
- [ ] Multi-tenancy support (isolate workflows by organization)
- [ ] Workflow templates library (pre-built workflows)
- [ ] Advanced monitoring (distributed tracing, performance profiling)
- [ ] Custom connector SDK (third-party integrations)
- [ ] Mobile app (iOS/Android for monitoring and approvals)

### Low Priority
- [ ] Workflow simulation (test execution without side effects)
- [ ] A/B testing for workflows (compare variants)
- [ ] Workflow analytics (usage patterns, optimization suggestions)
- [ ] Integration with external CI/CD (GitHub Actions, Jenkins)
- [ ] Workflow import/export (JSON, YAML, visual formats)

### Technical Debt
- [ ] Migrate to TypeScript 5.5+ for improved type inference
- [ ] Upgrade to React 19 for concurrent features
- [ ] Implement Redis-backed distributed state (Scale tier)
- [ ] Add GraphQL API alternative to REST
- [ ] Implement OAuth2/OIDC authentication providers

## 🤖 AI Agent Continuation Guide

This repository is designed for AI-assisted development. Key guidelines:

### Architecture Principles
1. **Modular Monolith:** Clean separation between packages, shared interfaces
2. **State Store Abstraction:** SQLite for Core, PostgreSQL for Scale (same interface)
3. **Type Safety:** Strict TypeScript with Zod runtime validation
4. **Test-Driven:** Comprehensive test coverage (unit, integration, E2E)

### Development Workflow
1. Read `DEVELOPMENT.md` for current status and decisions
2. Check `tbk.md` for task breakdown and dependencies
3. Follow existing patterns in `packages/` and `apps/`
4. Write tests for all new functionality
5. Update documentation after changes

### Key Interfaces
- `StateStore` (packages/state/src/interface.ts) - Database abstraction
- `ConnectorAdapter` (packages/connectors/src/interface.ts) - Connector pattern
- `LLMProvider` (packages/llm/src/interface.ts) - LLM abstraction
- `TriggerHandler` (packages/triggers/src/) - Trigger pattern

### Testing Strategy
- Unit tests: `tests/unit/[package]/`
- Integration tests: `tests/integration/[feature]/`
- E2E tests: `tests/e2e/[scenario]/`
- Run: `pnpm test`

### Common Tasks
```bash
# Add new connector
# 1. Create packages/connectors/src/[name]/adapter.ts
# 2. Implement ConnectorAdapter interface
# 3. Register in packages/connectors/src/registry.ts
# 4. Add tests in tests/unit/connectors/

# Add new trigger type
# 1. Create packages/triggers/src/[name].ts
# 2. Implement trigger handler
# 3. Register in packages/triggers/src/dispatcher.ts
# 4. Add tests in tests/unit/triggers/

# Add API endpoint
# 1. Add route in apps/api/src/routes/[resource].ts
# 2. Add validation with Zod
# 3. Add tests in tests/integration/api/
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

Built with inspiration from:
- [n8n](https://n8n.io/) - Workflow automation
- [Activepieces](https://www.activepieces.com/) - Open-source automation
- [Trigger.dev](https://trigger.dev/) - Background jobs
- [React Flow](https://reactflow.dev/) - Node-based UI

## 📞 Support

- **Issues:** [GitHub Issues](https://github.com/OnDemandWorld/odw-loop/issues)
- **Discussions:** [GitHub Discussions](https://github.com/OnDemandWorld/odw-loop/discussions)
- **Documentation:** [Wiki](https://github.com/OnDemandWorld/odw-loop/wiki)

---

**Built with ❤️ by the ODW.ai team**
