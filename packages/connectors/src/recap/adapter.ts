/**
 * ODW Recap connector — meeting intelligence (team-server).
 *
 * Targets the real Recap team-server HTTP API (see INTEGRATION_CONTRACT.md §3):
 *   - POST /auth/login   {email,password} → {token}
 *   - GET  /meetings/    (Bearer JWT)
 *   - GET  /meetings/{id}
 *   - POST /meetings/
 *   - POST /sync
 *   - GET  /health
 *
 * Auth is JWT Bearer. The token is resolved (in priority order) from the
 * operation input (`token`), the resolved secrets (`api_key`), or the instance
 * config (`api_key`).
 */

import { request } from 'undici';
import type { ConnectorAdapter, ExecuteParams, ExecuteResult } from '../interface.js';
import type { ConnectorCapabilities } from '@loop/types';
import { UpstreamError } from '@loop/types';
import { createLogger } from '@loop/observability';

const logger = createLogger({ name: 'loop:connectors:recap', component: 'connectors' });

const DEFAULT_BASE_URL = 'http://localhost:8080';

export class RecapAdapter implements ConnectorAdapter {
  readonly type = 'recap';

  async execute(params: ExecuteParams): Promise<ExecuteResult> {
    const baseUrl = (params.config?.['base_url'] as string) || DEFAULT_BASE_URL;
    const token =
      (params.input['token'] as string | undefined) ??
      params.secrets?.['api_key'] ??
      (params.config?.['api_key'] as string | undefined) ??
      '';

    switch (params.operation) {
      case 'login':
        return this.login(baseUrl, params.input);
      case 'list_meetings':
        return this.callRecap(baseUrl, token, 'GET', '/meetings/');
      case 'get_meeting':
        return this.callRecap(baseUrl, token, 'GET', `/meetings/${String(params.input['id'])}`);
      case 'create_meeting':
        return this.callRecap(baseUrl, token, 'POST', '/meetings/', params.input);
      case 'sync':
        return this.callRecap(baseUrl, token, 'POST', '/sync', params.input);
      default:
        throw new Error(`Unknown Recap operation: ${params.operation}`);
    }
  }

  async healthCheck(baseUrl: string = DEFAULT_BASE_URL): Promise<boolean> {
    try {
      const response = await request(`${baseUrl}/health`, { method: 'GET' });
      await response.body.text();
      return response.statusCode === 200;
    } catch (err) {
      logger.warn({ error: String(err) }, 'Recap health check failed');
      return false;
    }
  }

  getCapabilities(): ConnectorCapabilities {
    return {
      node_types: [
        'recap.login',
        'recap.list_meetings',
        'recap.get_meeting',
        'recap.create_meeting',
        'recap.sync',
      ],
      input_types: ['Meeting', 'string'],
      output_types: ['Meeting', 'Meeting[]', 'string'],
    };
  }

  /** POST /auth/login → {token}. No Bearer required. */
  private async login(baseUrl: string, input: Record<string, unknown>): Promise<ExecuteResult> {
    const data = await this.callRecap(baseUrl, '', 'POST', '/auth/login', {
      email: input['email'] ?? '',
      password: input['password'] ?? '',
    });
    return { output: { token: data.output['token'] ?? '' } };
  }

  private async callRecap(
    baseUrl: string,
    token: string,
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<ExecuteResult> {
    try {
      const response = await request(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (response.statusCode >= 400) {
        throw new UpstreamError('UPSTREAM_RECAP_UNAVAILABLE', `Recap returned ${response.statusCode}`);
      }
      const text = await response.body.text();
      if (!text) return { output: {} };
      try {
        return { output: JSON.parse(text) as Record<string, unknown> };
      } catch {
        return { output: { text } };
      }
    } catch (err) {
      if (err instanceof UpstreamError) throw err;
      logger.error({ error: String(err) }, 'Recap call failed');
      throw new UpstreamError('UPSTREAM_RECAP_UNAVAILABLE', String(err));
    }
  }
}
