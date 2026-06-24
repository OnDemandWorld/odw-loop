# AI Agent Development Guide

This document provides guidelines for AI agents working on the Loop codebase. It's designed to help AI assistants understand the project structure, conventions, and workflows.

## 🎯 Project Overview

**Loop** is a workflow orchestration engine for the ODW.ai sovereign agent suite. It connects AI agents (Vault, Desk, Recap) into automated workflows with visual building, DAG-based execution, and enterprise security.

**Key Characteristics:**
- TypeScript monorepo with strict typing
- Modular architecture with clean separation
- Comprehensive test coverage (244 tests)
- Production-ready with Docker/Helm deployment
- Apache 2.0 licensed

## 📚 Essential Documentation

Read these documents in order:

1. **README.md** - Project overview, quick start, API docs
2. **DEVELOPMENT.md** - Current status, decisions, next steps
3. **tsd.md** - Technical specification (detailed)
4. **tbk.md** - Task breakdown with dependencies
5. **sad.md** - System architecture

## 🏗️ Architecture Principles

### 1. Modular Monolith
- Clean separation between packages
- Shared interfaces for extensibility
- Single deployable unit (Core tier)
- Can decompose to microservices (Scale tier)

### 2. State Store Abstraction
```typescript
// Interface: packages/state/src/interface.ts
interface StateStore {
  workflows: WorkflowOperations;
  executions: ExecutionOperations;
  triggers: TriggerOperations;
  // ...
}

// Implementations:
// - SQLite: packages/state/src/sqlite/
// - PostgreSQL: packages/state/src/postgres/
```

### 3. Connector Pattern
```typescript
// Interface: packages/connectors/src/interface.ts
interface ConnectorAdapter {
  execute(params: ExecuteParams): Promise<ExecuteResult>;
  healthCheck(): Promise<boolean>;
  getCapabilities(): ConnectorCapabilities;
}

// Implementations:
// - Vault: packages/connectors/src/vault/
// - Desk: packages/connectors/src/desk/
// - Recap: packages/connectors/src/recap/
```

### 4. Type Safety
- Strict TypeScript (no `any` unless absolutely necessary)
- Zod schemas for runtime validation
- Shared types in `@loop/types`

### 5. Test-Driven Development
- Unit tests for all business logic
- Integration tests for module interactions
- E2E tests for complete workflows
- Target: 80%+ coverage

## 🔧 Development Workflow

### 1. Understanding Context
Before making changes:
```bash
# Check current status
cat DEVELOPMENT.md

# Review recent changes
git log --oneline -20

# Check for open issues
# (GitHub Issues)
```

### 2. Planning Changes
For any feature or fix:
1. Identify affected packages
2. Check dependencies (tbk.md §4)
3. Plan test coverage
4. Consider backwards compatibility
5. Update documentation

### 3. Implementation Pattern

**Step 1: Define Interface (if new module)**
```typescript
// packages/[module]/src/interface.ts
export interface MyModule {
  // Define public API
}
```

**Step 2: Implement Logic**
```typescript
// packages/[module]/src/[feature].ts
import { createLogger } from '@loop/observability';

const logger = createLogger({ name: 'loop:[module]', component: '[feature]' });

export class MyFeature {
  // Implementation
}
```

**Step 3: Write Tests**
```typescript
// tests/unit/[module]/[feature].test.ts
import { describe, it, expect } from 'vitest';

describe('MyFeature', () => {
  it('should do something', () => {
    // Test
  });
});
```

**Step 4: Export and Integrate**
```typescript
// packages/[module]/src/index.ts
export * from './[feature].js';
```

**Step 5: Update Documentation**
- Code comments (JSDoc)
- README.md (if user-facing)
- DEVELOPMENT.md (if architectural decision)

### 4. Testing Strategy

**Unit Tests** (`tests/unit/`)
- Test individual functions/classes
- Mock external dependencies
- Fast execution (< 1ms per test)
- High coverage (80%+)

**Integration Tests** (`tests/integration/`)
- Test module interactions
- Use in-memory SQLite
- Test API endpoints
- Test database operations

**E2E Tests** (`tests/e2e/`)
- Test complete workflows
- Mock external services
- Test security features
- Test deployment scenarios

**Running Tests:**
```bash
pnpm test              # All tests
pnpm test:unit         # Unit only
pnpm test:integration  # Integration only
pnpm test:e2e          # E2E only
```

## 📦 Package Structure

Each package follows this structure:
```
packages/[name]/
├── src/
│   ├── index.ts          # Public API exports
│   ├── interface.ts      # Core interfaces (if applicable)
│   └── [feature].ts      # Feature implementations
├── tests/                # Package-specific tests (optional)
├── package.json          # Dependencies
└── tsconfig.json         # TypeScript config
```

**Dependencies:**
- Use `workspace:*` for internal packages
- Pin major versions for external deps
- Keep dependencies minimal

## 🎨 Code Conventions

### Naming
- **Files:** kebab-case (`my-feature.ts`)
- **Classes:** PascalCase (`MyFeature`)
- **Functions:** camelCase (`myFunction`)
- **Constants:** UPPER_SNAKE_CASE (`MY_CONSTANT`)
- **Types:** PascalCase (`MyType`)

### Imports
```typescript
// 1. Node built-ins
import { randomUUID } from 'node:crypto';

// 2. External packages
import { z } from 'zod';

// 3. Internal packages
import { createLogger } from '@loop/observability';

// 4. Relative imports
import { MyType } from './types.js';
```

### Error Handling
```typescript
import { LoopError, NotFoundError, ValidationError } from '@loop/types';

// Use custom error types
throw new NotFoundError('workflow', id);
throw new ValidationError('Invalid input', details);
throw new LoopError('CUSTOM_ERROR', 'Message', 400);
```

### Logging
```typescript
import { createLogger } from '@loop/observability';

const logger = createLogger({ 
  name: 'loop:[module]', 
  component: '[feature]' 
});

logger.info({ workflowId: id }, 'Workflow created');
logger.error({ error: String(err) }, 'Operation failed');
```

## 🔄 Common Tasks

### Adding a New Package

1. Create directory structure:
```bash
mkdir -p packages/[name]/src
```

2. Create `package.json`:
```json
{
  "name": "@loop/[name]",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc --build",
    "test": "vitest run"
  },
  "dependencies": {
    "@loop/types": "workspace:*"
  }
}
```

3. Create `tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

4. Create `src/index.ts`:
```typescript
export * from './[feature].js';
```

5. Add to workspace in `pnpm-workspace.yaml` (if not auto-detected)

6. Add tests in `tests/unit/[name]/`

### Adding a New Connector

1. Create adapter: `packages/connectors/src/[name]/adapter.ts`
2. Implement `ConnectorAdapter` interface
3. Register in `packages/connectors/src/registry.ts`
4. Add tests in `tests/unit/connectors/[name].test.ts`
5. Update README.md connector list

### Adding a New Trigger

1. Create handler: `packages/triggers/src/[name].ts`
2. Implement trigger logic
3. Register in `packages/triggers/src/dispatcher.ts`
4. Add API route in `apps/api/src/routes/triggers.ts`
5. Add tests in `tests/unit/triggers/[name].test.ts`

### Adding a New API Endpoint

1. Create route: `apps/api/src/routes/[resource].ts`
2. Define Zod schema for validation
3. Implement handler with proper error handling
4. Register in `apps/api/src/routes/index.ts`
5. Add tests in `tests/integration/api/[resource].test.ts`
6. Update API documentation in README.md

### Adding Database Migration

1. Create migration: `packages/state/src/migrations/[number]_[name].ts`
2. Implement `up` and `down` methods
3. Register in `packages/state/src/migrations/index.ts`
4. Add tests in `tests/integration/state/migration.test.ts`

## 🐛 Debugging

### Common Issues

**TypeScript errors:**
```bash
pnpm typecheck  # Check all packages
cd packages/[name] && pnpm typecheck  # Check specific package
```

**Test failures:**
```bash
pnpm test  # Run all tests
npx vitest run tests/unit/[name]  # Run specific test file
```

**Build errors:**
```bash
pnpm build  # Build all packages
cd packages/[name] && pnpm build  # Build specific package
```

### Debug Mode
```bash
# Enable debug logging
LOOP_LOG_LEVEL=debug pnpm dev

# Enable source maps
NODE_OPTIONS="--enable-source-maps" pnpm dev
```

## 📊 Metrics and Observability

**Prometheus Metrics:**
- Available at `/metrics` endpoint
- 15 core metrics defined in `packages/observability/src/metrics.ts`
- Add new metrics using prom-client

**Structured Logging:**
- All logs are JSON format
- Include correlation IDs (request_id, execution_id)
- Use appropriate log levels (debug, info, warn, error)

## 🔒 Security Checklist

When implementing features:
- [ ] Validate all inputs with Zod schemas
- [ ] Use parameterized queries (no SQL injection)
- [ ] Encrypt sensitive data at rest
- [ ] Implement proper RBAC checks
- [ ] Log security-relevant events
- [ ] Use HMAC for webhook verification
- [ ] Apply egress policies to outbound calls
- [ ] Sanitize user-generated content

## 🚀 Performance Guidelines

- Use connection pooling for databases
- Cache expensive computations
- Implement circuit breakers for external calls
- Use async/await for I/O operations
- Avoid blocking the event loop
- Profile before optimizing

## 📝 Documentation Standards

**Code Comments:**
```typescript
/**
 * Brief description of what this function/class does.
 * 
 * @param param1 - Description of parameter
 * @param param2 - Description of parameter
 * @returns Description of return value
 * @throws {ErrorType} When this error occurs
 * 
 * @example
 * // Usage example
 * const result = myFunction(param1, param2);
 */
```

**README Sections:**
- Overview (what it does)
- Installation (how to use)
- API (if applicable)
- Examples (common use cases)
- Configuration (options)

## 🎯 Quality Gates

Before submitting changes:
- [ ] All tests pass (`pnpm test`)
- [ ] Type check passes (`pnpm typecheck`)
- [ ] Lint passes (`pnpm lint`)
- [ ] No `any` types (unless justified)
- [ ] Documentation updated
- [ ] CHANGELOG.md updated (if user-facing)
- [ ] No breaking changes (or documented)

## 🤝 Working with Existing Code

### Reading Code
1. Start with `index.ts` to understand public API
2. Check `interface.ts` for core contracts
3. Look at tests for usage examples
4. Read JSDoc comments for details

### Modifying Code
1. Understand the context (why it exists)
2. Check dependencies (what depends on it)
3. Make minimal changes
4. Add tests for new behavior
5. Update documentation

### Refactoring
1. Ensure tests pass before changes
2. Make small, incremental changes
3. Run tests after each change
4. Update affected documentation
5. Verify no performance regression

## 📞 Getting Help

**Internal Resources:**
- DEVELOPMENT.md - Current status and decisions
- tbk.md - Task breakdown with context
- Code comments - Inline documentation

**External Resources:**
- TypeScript docs: https://www.typescriptlang.org/docs/
- Fastify docs: https://www.fastify.io/docs/
- Drizzle docs: https://orm.drizzle.team/
- React Flow docs: https://reactflow.dev/

## 🎓 Learning Path

For AI agents new to this codebase:

1. **Week 1:** Read all documentation, run tests, explore structure
2. **Week 2:** Fix small bugs, add tests, improve docs
3. **Week 3:** Implement small features, refactor code
4. **Week 4:** Implement larger features, optimize performance

## ✅ Best Practices

1. **Start small:** Make incremental changes
2. **Test thoroughly:** Write tests before code
3. **Document everything:** Code, APIs, decisions
4. **Think modular:** Clean separation of concerns
5. **Plan ahead:** Consider future extensibility
6. **Stay consistent:** Follow existing patterns
7. **Review carefully:** Check edge cases
8. **Communicate clearly:** Write good commit messages

---

**Remember:** The goal is to build production-ready, maintainable software. Take your time, test thoroughly, and document everything.

Happy coding! 🚀
