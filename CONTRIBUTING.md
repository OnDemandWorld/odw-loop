# Contributing to Loop

Thank you for your interest in contributing to Loop! This guide will help you get started.

## 🚀 Getting Started

### Prerequisites

- Node.js 20+ and pnpm 9+
- Git
- Docker (optional, for containerized testing)

### Development Setup

```bash
# Clone the repository
git clone git@github.com:OnDemandWorld/odw-loop.git
cd loop

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run development server
pnpm dev

# Run tests
pnpm test
```

## 🏗️ Architecture Overview

Loop is a TypeScript monorepo with the following structure:

- **apps/**: Deployable applications
  - `api`: Fastify HTTP/WebSocket server
  - `canvas`: React Flow frontend
  - `sandbox`: Code execution sandbox
  - `control-plane`: Multi-instance management (Scale tier)

- **packages/**: Shared libraries
  - `types`: Zod schemas and type definitions
  - `state`: Database abstraction (SQLite/PostgreSQL)
  - `engine`: DAG execution engine
  - `connectors`: ODW agent adapters
  - `triggers`: Trigger handlers (cron, webhook, event)
  - `workflow-authoring`: Workflow CRUD operations
  - `versioning`: Git-based version control
  - `secrets`: Encryption and secrets management
  - `egress`: Network egress policies
  - `observability`: Metrics and logging
  - `llm`: LLM provider abstraction

## 📝 Development Workflow

### 1. Create a Feature Branch

```bash
git checkout -b feature/your-feature-name
```

### 2. Make Your Changes

Follow these guidelines:

- **Type Safety:** Use strict TypeScript, avoid `any`
- **Validation:** Use Zod schemas for all inputs
- **Testing:** Write tests for all new functionality
- **Documentation:** Update relevant docs
- **Error Handling:** Use custom error types from `@loop/types`

### 3. Code Style

```bash
# Format code
pnpm format

# Lint code
pnpm lint

# Type check
pnpm typecheck
```

**Style Guidelines:**
- Use functional components in React
- Prefer composition over inheritance
- Use meaningful variable names
- Add JSDoc comments for public APIs
- Keep functions small and focused

### 4. Testing

```bash
# Run all tests
pnpm test

# Run specific test suites
pnpm test:unit        # Unit tests
pnpm test:integration # Integration tests
pnpm test:e2e         # E2E tests

# Run with coverage
pnpm test:coverage
```

**Testing Guidelines:**
- Unit tests: Test individual functions/classes
- Integration tests: Test module interactions
- E2E tests: Test complete workflows
- Aim for 80%+ coverage
- Use descriptive test names
- Mock external dependencies

### 5. Commit Your Changes

```bash
git add .
git commit -m "feat: add your feature description"
```

**Commit Message Format:**
```
type: description

[optional body]

[optional footer]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

### 6. Push and Create Pull Request

```bash
git push origin feature/your-feature-name
```

Then create a Pull Request on GitHub.

## 🔧 Common Development Tasks

### Adding a New Connector

1. Create adapter file: `packages/connectors/src/[name]/adapter.ts`
2. Implement `ConnectorAdapter` interface:

```typescript
import { ConnectorAdapter, ExecuteParams, ExecuteResult } from '../interface.js';

export class MyConnector implements ConnectorAdapter {
  readonly type = 'my-connector';

  async execute(params: ExecuteParams): Promise<ExecuteResult> {
    // Implementation
  }

  async healthCheck(): Promise<boolean> {
    // Health check logic
  }

  getCapabilities() {
    return {
      node_types: ['my-connector.action'],
      input_types: ['string'],
      output_types: ['string'],
    };
  }
}
```

3. Register in `packages/connectors/src/registry.ts`
4. Add tests in `tests/unit/connectors/[name].test.ts`
5. Update documentation

### Adding a New Trigger Type

1. Create handler: `packages/triggers/src/[name].ts`
2. Implement trigger handler:

```typescript
export class MyTriggerHandler {
  constructor(private store: StateStore) {}

  async handle(params: MyTriggerParams): Promise<string> {
    // Create execution
    const executionId = randomUUID();
    await this.store.executions.create({
      id: executionId,
      workflow_id: params.workflowId,
      workflow_version: 1,
      trigger_type: 'my-trigger',
      trigger_payload: params.payload,
    });
    return executionId;
  }
}
```

3. Register in `packages/triggers/src/dispatcher.ts`
4. Add API route in `apps/api/src/routes/triggers.ts`
5. Add tests in `tests/unit/triggers/[name].test.ts`

### Adding a New API Endpoint

1. Create route file: `apps/api/src/routes/[resource].ts`
2. Define schema with Zod:

```typescript
import { z } from 'zod';

const createSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
});
```

3. Implement handler:

```typescript
export function registerRoutes(app: FastifyInstance, deps: RouteDeps) {
  app.post('/api/v1/resources', async (request, reply) => {
    const body = createSchema.parse(request.body);
    const resource = await deps.service.create(body);
    return reply.status(201).send({ success: true, data: resource });
  });
}
```

4. Register in `apps/api/src/routes/index.ts`
5. Add tests in `tests/integration/api/[resource].test.ts`

### Adding Database Migration

1. Create migration: `packages/state/src/migrations/[number]_[name].ts`

```typescript
import { Migration } from '../migrate.js';

export const migration: Migration = {
  version: '002',
  name: 'add_new_table',
  up: async (db) => {
    await db.execute(sql`
      CREATE TABLE new_table (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
      )
    `);
  },
  down: async (db) => {
    await db.execute(sql`DROP TABLE new_table`);
  },
};
```

2. Register in `packages/state/src/migrations/index.ts`
3. Add tests in `tests/integration/state/migration.test.ts`

## 🐛 Reporting Bugs

Create an issue on GitHub with:

- **Description:** Clear description of the bug
- **Steps to Reproduce:** Step-by-step instructions
- **Expected Behavior:** What should happen
- **Actual Behavior:** What actually happens
- **Environment:** OS, Node.js version, browser (if applicable)
- **Logs:** Relevant error messages or logs

## 💡 Suggesting Features

Create an issue on GitHub with:

- **Title:** Clear, descriptive title
- **Description:** Detailed description of the feature
- **Use Case:** Why this feature is needed
- **Proposed Solution:** How it should work (optional)
- **Alternatives:** Other approaches considered (optional)

## 📚 Documentation

When making changes, update relevant documentation:

- **README.md:** User-facing documentation
- **DEVELOPMENT.md:** Development status and decisions
- **Code comments:** JSDoc for public APIs
- **API docs:** Update API examples

## 🔄 Pull Request Process

1. **Fork** the repository (if external contributor)
2. **Create** a feature branch
3. **Make** your changes
4. **Test** thoroughly
5. **Document** your changes
6. **Submit** pull request
7. **Respond** to review feedback
8. **Merge** after approval

### Pull Request Checklist

- [ ] Code follows style guidelines
- [ ] Tests pass (`pnpm test`)
- [ ] Type check passes (`pnpm typecheck`)
- [ ] Lint passes (`pnpm lint`)
- [ ] Documentation updated
- [ ] Commit messages follow convention
- [ ] No breaking changes (or documented)
- [ ] Added tests for new functionality

## 🎯 Code Review Guidelines

When reviewing PRs:

- **Correctness:** Does the code do what it's supposed to?
- **Tests:** Are there adequate tests?
- **Documentation:** Is it well documented?
- **Performance:** Any performance concerns?
- **Security:** Any security issues?
- **Style:** Does it follow project conventions?

## 🏆 Recognition

Contributors will be recognized in:

- GitHub contributors graph
- Release notes
- Project documentation

## 📞 Getting Help

- **Questions:** [GitHub Discussions](https://github.com/OnDemandWorld/odw-loop/discussions)
- **Issues:** [GitHub Issues](https://github.com/OnDemandWorld/odw-loop/issues)
- **Email:** [contact@odw.ai](mailto:contact@odw.ai)

## 📄 License

By contributing, you agree that your contributions will be licensed under the Apache 2.0 License.

---

Thank you for contributing to Loop! 🎉
