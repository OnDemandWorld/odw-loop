import { createLogger } from '@loop/observability';
import type { ConnectorAdapter } from './interface.js';

const logger = createLogger({ name: 'loop:connectors:registry', component: 'connectors' });

/**
 * Connector registry — manages adapter instances and provides lookup.
 * Adapters are registered by type.  Instances are keyed by a unique instance ID.
 */
export class ConnectorRegistry {
  private adapters = new Map<string, ConnectorAdapter>();
  private instances = new Map<string, { adapterType: string; config: Record<string, unknown> }>();
  private capabilitiesCache = new Map<string, { caps: Awaited<ReturnType<ConnectorAdapter['getCapabilities']>>; expiresAt: number }>();

  /** Register an adapter type. */
  registerAdapter(adapter: ConnectorAdapter): void {
    this.adapters.set(adapter.type, adapter);
    logger.info({ type: adapter.type }, 'Adapter registered');
  }

  /** Register a connector instance (a configured adapter). */
  registerInstance(instanceId: string, adapterType: string, config: Record<string, unknown>): void {
    if (!this.adapters.has(adapterType)) {
      throw new Error(`Unknown adapter type: ${adapterType}`);
    }
    this.instances.set(instanceId, { adapterType, config });
  }

  /** Get an adapter by type. */
  getAdapter(type: string): ConnectorAdapter | undefined {
    return this.adapters.get(type);
  }

  /** Get the adapter type for an instance. */
  getInstanceAdapterType(instanceId: string): string | undefined {
    return this.instances.get(instanceId)?.adapterType;
  }

  /** Get instance config. */
  getInstanceConfig(instanceId: string): Record<string, unknown> | undefined {
    return this.instances.get(instanceId)?.config;
  }

  /** List all registered instances. */
  listInstances(): string[] {
    return [...this.instances.keys()];
  }

  /** Get capabilities for a connector type (cached 5 min — §7.2). */
  async getCapabilities(type: string) {
    const cached = this.capabilitiesCache.get(type);
    if (cached && cached.expiresAt > Date.now()) return cached.caps;

    const adapter = this.adapters.get(type);
    if (!adapter) return undefined;

    const caps = adapter.getCapabilities();
    this.capabilitiesCache.set(type, { caps, expiresAt: Date.now() + 5 * 60 * 1000 });
    return caps;
  }

  /** Run health check on all instances. */
  async healthCheckAll(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    for (const [id, inst] of this.instances) {
      const adapter = this.adapters.get(inst.adapterType);
      if (!adapter) {
        results.set(id, false);
        continue;
      }
      try {
        results.set(id, await adapter.healthCheck());
      } catch {
        results.set(id, false);
      }
    }
    return results;
  }
}
