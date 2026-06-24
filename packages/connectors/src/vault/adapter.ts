/**
 * ODW Vault connector — knowledge-base operations (§9.1).
 */

import { request } from 'undici';
import type { ConnectorAdapter, ExecuteParams, ExecuteResult } from '../interface.js';
import type { ConnectorCapabilities } from '@loop/types';
import { UpstreamError } from '@loop/types';
import { createLogger } from '@loop/observability';

const logger = createLogger({ name: 'loop:connectors:vault', component: 'connectors' });

export class VaultAdapter implements ConnectorAdapter {
  readonly type = 'vault';

  async execute(params: ExecuteParams): Promise<ExecuteResult> {
    const baseUrl = (params.config?.['base_url'] as string) ?? '';
    const apiKey = params.secrets?.['api_key'] ?? (params.config?.['api_key'] as string) ?? '';

    switch (params.operation) {
      case 'create_document':
        return this.callVault(baseUrl, apiKey, 'POST', '/documents', params.input);
      case 'update_document':
        return this.callVault(baseUrl, apiKey, 'PUT', `/documents/${params.input['id']}`, params.input);
      case 'delete_document':
        return this.callVault(baseUrl, apiKey, 'DELETE', `/documents/${params.input['id']}`, {});
      case 'search':
        return this.callVault(baseUrl, apiKey, 'POST', '/search', params.input);
      case 'rag_query':
        return this.callVault(baseUrl, apiKey, 'POST', '/rag/query', params.input);
      case 'manage_tags':
        return this.callVault(baseUrl, apiKey, 'POST', '/tags', params.input);
      default:
        throw new Error(`Unknown Vault operation: ${params.operation}`);
    }
  }

  async healthCheck(): Promise<boolean> {
    // In production, call a real health endpoint.
    return true;
  }

  getCapabilities(): ConnectorCapabilities {
    return {
      node_types: [
        'vault.create_document',
        'vault.update_document',
        'vault.delete_document',
        'vault.search',
        'vault.rag_query',
        'vault.manage_tags',
      ],
      input_types: ['Document', 'string'],
      output_types: ['Document', 'Document[]'],
    };
  }

  private async callVault(
    baseUrl: string,
    apiKey: string,
    method: string,
    path: string,
    body: Record<string, unknown>,
  ): Promise<ExecuteResult> {
    try {
      const response = await request(`${baseUrl}${path}`, {
        method: method as 'GET' | 'POST' | 'PUT' | 'DELETE',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(body),
      });

      if (response.statusCode >= 400) {
        throw new UpstreamError('UPSTREAM_VAULT_UNAVAILABLE', `Vault returned ${response.statusCode}`);
      }

      const data = await response.body.json() as Record<string, unknown>;
      return { output: data };
    } catch (err) {
      if (err instanceof UpstreamError) throw err;
      logger.error({ error: String(err) }, 'Vault call failed');
      throw new UpstreamError('UPSTREAM_VAULT_UNAVAILABLE', String(err));
    }
  }
}
