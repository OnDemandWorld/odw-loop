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
import { UpstreamError, LoopError } from '@loop/types';
import { createLogger } from '@loop/observability';
import { traceHeaders } from '../trace.js';

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
    // V1.1 M1 (F2): best-effort idempotency key forwarded as an upstream header.
    const idemKey = params.idempotencyKey;

    switch (params.operation) {
      case 'login':
        return this.login(baseUrl, params.input, idemKey, params);
      case 'list_meetings':
        return this.callRecap(baseUrl, token, 'GET', '/meetings/', undefined, idemKey, params);
      case 'get_meeting':
        // Audit #38: encode the id like the sibling adapters — a raw '..' or
        // '?' in a trigger-supplied id redirected the request (with the
        // instance JWT) to an unintended Recap endpoint.
        return this.callRecap(baseUrl, token, 'GET', `/meetings/${encodeURIComponent(String(params.input['id']))}`, undefined, idemKey, params);
      case 'create_meeting':
        // Audit #112: never echo the JWT into the request body — it already
        // travels in the Authorization header; duplicating it widens exposure
        // in the sibling service's body logs.
        return this.callRecap(baseUrl, token, 'POST', '/meetings/', stripToken(params.input), idemKey, params);
      case 'sync':
        return this.callRecap(baseUrl, token, 'POST', '/sync', stripToken(params.input), idemKey, params);
      default:
        throw new Error(`Unknown Recap operation: ${params.operation}`);
    }
  }

  async healthCheck(baseUrl: string = DEFAULT_BASE_URL, signal?: AbortSignal): Promise<boolean> {
    try {
      const response = await request(`${baseUrl}/health`, { method: 'GET', signal: signal ?? AbortSignal.timeout(3000) });
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
  private async login(baseUrl: string, input: Record<string, unknown>, idempotencyKey?: string, io?: Pick<ExecuteParams, 'egress' | 'signal'>): Promise<ExecuteResult> {
    const data = await this.callRecap(baseUrl, '', 'POST', '/auth/login', {
      email: input['email'] ?? '',
      password: input['password'] ?? '',
    }, idempotencyKey, io);
    return { output: { token: data.output['token'] ?? '' } };
  }

  private async callRecap(
    baseUrl: string,
    token: string,
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
    idempotencyKey?: string,
    io?: Pick<ExecuteParams, 'egress' | 'signal'>,
  ): Promise<ExecuteResult> {
    try {
      const url = `${baseUrl}${path}`;
      await io?.egress?.check(url);
      const response = await request(url, {
        method,
        headers: {
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
          ...traceHeaders(),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: io?.signal,
      });
      if (response.statusCode >= 400) {
        // Consume the body so undici can release the socket back to the pool.
        await response.body.text().catch(() => {});
        throw new UpstreamError('UPSTREAM_RECAP_UNAVAILABLE', `Recap returned ${response.statusCode}`);
      }
      const text = await response.body.text();
      if (!text) return { output: {} };
      try {
        return { output: JSON.parse(text) as Record<string, unknown> };
      } catch {
        // Non-JSON from the sibling service almost always means the URL points
        // at the wrong host/port — fail loudly instead of smuggling garbage
        // into workflow outputs as `{ text }`.
        throw new UpstreamError(
          'UPSTREAM_RECAP_BAD_RESPONSE',
          `Recap at ${baseUrl} returned non-JSON content (check LOOP_RECAP_URL)`,
        );
      }
    } catch (err) {
      if (err instanceof UpstreamError) throw err;
      // Audit #41: propagate product errors (e.g. NODE_EGRESS_BLOCKED) unchanged.
      if (err instanceof LoopError) throw err;
      logger.error({ error: String(err) }, 'Recap call failed');
      throw new UpstreamError('UPSTREAM_RECAP_UNAVAILABLE', String(err));
    }
  }
}

/** Audit #112: remove auth material from outgoing request bodies. */
function stripToken(input: Record<string, unknown>): Record<string, unknown> {
  const { token: _token, ...rest } = input;
  return rest;
}
