/**
 * Generic REST connector for arbitrary APIs (§9 — generic pattern).
 */

import { request } from 'undici';
import type { ConnectorAdapter, ExecuteParams, ExecuteResult } from '../interface.js';
import type { ConnectorCapabilities } from '@loop/types';

export class GenericAdapter implements ConnectorAdapter {
  readonly type = 'generic';

  async execute(params: ExecuteParams): Promise<ExecuteResult> {
    const baseUrl = (params.config?.['base_url'] as string) ?? '';
    const method = (params.config?.['method'] as string) ?? (params.input['method'] as string) ?? 'POST';
    const path = (params.input['path'] as string) ?? '/';
    const headers = (params.config?.['headers'] as Record<string, string>) ?? {};
    const body = params.input['body'] as Record<string, unknown> | undefined;

    const response = await request(`${baseUrl}${path}`, {
      method: method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      headers: { 'content-type': 'application/json', ...headers },
      body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(body ?? {}),
    });

    const data = await response.body.json() as Record<string, unknown>;
    return { output: { status: response.statusCode, data } };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  getCapabilities(): ConnectorCapabilities {
    return {
      node_types: ['generic.rest_call'],
      input_types: ['any'],
      output_types: ['any'],
    };
  }
}
