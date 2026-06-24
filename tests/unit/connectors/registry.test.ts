import { describe, it, expect, vi } from 'vitest';
import { ConnectorRegistry } from '../../../packages/connectors/src/registry';
import type { ConnectorAdapter } from '../../../packages/connectors/src/interface';

describe('ConnectorRegistry', () => {
  it('registers adapter type', () => {
    const registry = new ConnectorRegistry();
    const mockAdapter: ConnectorAdapter = {
      type: 'test-adapter',
      execute: vi.fn(),
      healthCheck: vi.fn(),
      getCapabilities: vi.fn().mockReturnValue({ nodes: [] }),
    };

    registry.registerAdapter(mockAdapter);
    expect(registry.getAdapter('test-adapter')).toBe(mockAdapter);
  });

  it('registers instance', () => {
    const registry = new ConnectorRegistry();
    const mockAdapter: ConnectorAdapter = {
      type: 'test-adapter',
      execute: vi.fn(),
      healthCheck: vi.fn(),
      getCapabilities: vi.fn().mockReturnValue({ nodes: [] }),
    };

    registry.registerAdapter(mockAdapter);
    registry.registerInstance('instance-1', 'test-adapter', { key: 'value' });

    expect(registry.getInstanceAdapterType('instance-1')).toBe('test-adapter');
    expect(registry.getInstanceConfig('instance-1')).toEqual({ key: 'value' });
  });

  it('gets adapter by type', () => {
    const registry = new ConnectorRegistry();
    const mockAdapter: ConnectorAdapter = {
      type: 'test-adapter',
      execute: vi.fn(),
      healthCheck: vi.fn(),
      getCapabilities: vi.fn().mockReturnValue({ nodes: [] }),
    };

    registry.registerAdapter(mockAdapter);
    const retrieved = registry.getAdapter('test-adapter');

    expect(retrieved).toBe(mockAdapter);
  });

  it('caches capabilities for 5 minutes', async () => {
    const registry = new ConnectorRegistry();
    const getCapabilitiesMock = vi.fn().mockReturnValue({ nodes: ['test-node'] });
    const mockAdapter: ConnectorAdapter = {
      type: 'test-adapter',
      execute: vi.fn(),
      healthCheck: vi.fn(),
      getCapabilities: getCapabilitiesMock,
    };

    registry.registerAdapter(mockAdapter);

    // First call should invoke getCapabilities
    await registry.getCapabilities('test-adapter');
    expect(getCapabilitiesMock).toHaveBeenCalledTimes(1);

    // Second call within 5 minutes should use cache
    await registry.getCapabilities('test-adapter');
    expect(getCapabilitiesMock).toHaveBeenCalledTimes(1);

    // Advance time by 6 minutes
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6 * 60 * 1000);

    // Third call should invoke getCapabilities again
    await registry.getCapabilities('test-adapter');
    expect(getCapabilitiesMock).toHaveBeenCalledTimes(2);
  });

  it('health checks all instances', async () => {
    const registry = new ConnectorRegistry();
    const healthCheckMock = vi.fn().mockResolvedValue(true);
    const mockAdapter: ConnectorAdapter = {
      type: 'test-adapter',
      execute: vi.fn(),
      healthCheck: healthCheckMock,
      getCapabilities: vi.fn().mockReturnValue({ nodes: [] }),
    };

    registry.registerAdapter(mockAdapter);
    registry.registerInstance('instance-1', 'test-adapter', {});
    registry.registerInstance('instance-2', 'test-adapter', {});

    const results = await registry.healthCheckAll();

    expect(results.size).toBe(2);
    expect(results.get('instance-1')).toBe(true);
    expect(results.get('instance-2')).toBe(true);
    expect(healthCheckMock).toHaveBeenCalledTimes(2);
  });
});
