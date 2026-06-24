import type { ConnectorCapabilities } from '@loop/types';

export interface ExecuteParams {
  operation: string;
  input: Record<string, unknown>;
  /** Resolved secrets for this connector instance. */
  secrets?: Record<string, string>;
  /** Connector instance configuration. */
  config?: Record<string, unknown>;
}

export interface ExecuteResult {
  output: Record<string, unknown>;
}

/** Every connector implements this interface (§2.2, §9). */
export interface ConnectorAdapter {
  /** Machine-readable type identifier (e.g. 'vault', 'desk'). */
  readonly type: string;

  /** Execute an operation on this connector. */
  execute(params: ExecuteParams): Promise<ExecuteResult>;

  /** Check if the connector is reachable and healthy. */
  healthCheck(): Promise<boolean>;

  /** Discover what node types this connector provides. */
  getCapabilities(): ConnectorCapabilities;
}
