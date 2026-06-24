# Deprecated Features

This document tracks deprecated features in Loop, their replacement, and removal timeline.

## Deprecation Policy

- Features are deprecated for **at least 2 minor versions** before removal
- Deprecation warnings are logged at runtime when deprecated features are used
- Migration guides are provided for each deprecated feature
- Deprecated features are documented in release notes

## Currently Deprecated

_No features are currently deprecated._

## Deprecation Process

### 1. Mark as Deprecated
```typescript
/**
 * @deprecated Since v1.2.0. Use `newFunction()` instead. Will be removed in v2.0.0.
 */
export function oldFunction() {
  logger.warn('oldFunction is deprecated. Use newFunction instead.');
  // Implementation
}
```

### 2. Log Deprecation Warning
```typescript
import { createLogger } from '@loop/observability';

const logger = createLogger({ name: 'loop:deprecation' });

export function deprecatedFeature() {
  logger.warn({
    feature: 'deprecated_feature',
    replacement: 'new_feature',
    removalVersion: '2.0.0',
  }, 'Deprecated feature used');
}
```

### 3. Document in CHANGELOG
```markdown
## [1.2.0] - 2026-07-01

### Deprecated
- `oldFunction()` - Use `newFunction()` instead. Will be removed in v2.0.0.
  - Migration: Replace `oldFunction(x)` with `newFunction(x, { legacy: true })`
```

### 4. Update Documentation
- Add to DEPRECATED.md (this file)
- Update API documentation
- Add migration guide

## Migration Guides

### Example: Migrating from oldFunction to newFunction

**Before (deprecated):**
```typescript
import { oldFunction } from '@loop/utils';

const result = oldFunction(data);
```

**After (recommended):**
```typescript
import { newFunction } from '@loop/utils';

const result = newFunction(data, { legacy: false });
```

**Changes:**
- Function name changed from `oldFunction` to `newFunction`
- Added options parameter for backward compatibility
- Improved performance by 50%
- Better error handling

## Removal Timeline

| Feature | Deprecated In | Removal Version | Status |
|---------|---------------|-----------------|--------|
| _None currently_ | - | - | - |

## Past Removals

### v1.0.0 (Initial Release)
_No features removed in initial release._

## Reporting Issues

If you encounter issues with deprecated features:
1. Check this document for migration guide
2. Update your code to use the replacement
3. If no replacement exists, create an issue on GitHub
4. Provide context about your use case

## Questions?

- **Migration help:** [GitHub Discussions](https://github.com/OnDemandWorld/odw-loop/discussions)
- **Issues:** [GitHub Issues](https://github.com/OnDemandWorld/odw-loop/issues)

---

**Last Updated:** 2026-06-24
