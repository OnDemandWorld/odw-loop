/**
 * ODW Desk connector — customer-support inbox operations.
 *
 * Targets the real Desk HTTP API (see INTEGRATION_CONTRACT.md §2):
 *   - GET  /api/v1/agents/conversations
 *   - GET  /api/v1/agents/conversations/{id}
 *   - POST /api/v1/agents/conversations/{id}/respond?agent_id=&content=
 *   - POST /api/v1/agents/conversations/{id}/takeover
 *   - POST /api/v1/agents/conversations/{id}/resolve
 *   - GET  /health
 *
 * Desk has no auth by default; an Authorization header is sent only when an
 * api_key is explicitly configured.
 */

import { request } from 'undici';
import type { ConnectorAdapter, ExecuteParams, ExecuteResult } from '../interface.js';
import type { ConnectorCapabilities } from '@loop/types';
import { UpstreamError, LoopError } from '@loop/types';
import { createLogger } from '@loop/observability';
import { traceHeaders } from '../trace.js';

const logger = createLogger({ name: 'loop:connectors:desk', component: 'connectors' });

const DEFAULT_BASE_URL = 'http://localhost:8000';
const PREFIX = '/api/v1/agents/conversations';

function query_set(q: URLSearchParams, key: string, value: unknown): void {
  q.set(key, String(value));
}

export class DeskAdapter implements ConnectorAdapter {
  readonly type = 'desk';

  async execute(params: ExecuteParams): Promise<ExecuteResult> {
    const baseUrl = (params.config?.['base_url'] as string) || DEFAULT_BASE_URL;
    const apiKey = params.secrets?.['api_key'] ?? (params.config?.['api_key'] as string) ?? '';
    // V1.1 M1 (F2): best-effort idempotency key forwarded as an upstream header.
    const idemKey = params.idempotencyKey;

    switch (params.operation) {
      case 'list_conversations':
        return this.callDesk(baseUrl, apiKey, 'GET', PREFIX, undefined, idemKey, params);
      case 'get_conversation':
        return this.callDesk(baseUrl, apiKey, 'GET', `${PREFIX}/${encodeURIComponent(String(params.input['id']))}`, undefined, idemKey, params);
      case 'send_response': {
        const id = String(params.input['id'] ?? params.input['conversation_id'] ?? '');
        const query = new URLSearchParams();
        if (params.input['agent_id'] !== undefined) query.set('agent_id', String(params.input['agent_id']));
        // agent_id stays a query parameter (FastAPI Query(...)), but the reply
        // body moves to the JSON payload: long replies exceed URL/header
        // limits (~16KB) with a 431/400, and query strings leak into every
        // access log. Desk accepts {"content": "…"} since 2026-09 (kept the
        // legacy ?content= for compatibility — not sent anymore).
        const body: Record<string, unknown> = {};
        if (params.input['content'] !== undefined) body['content'] = String(params.input['content']);
        return this.callDesk(baseUrl, apiKey, 'POST', `${PREFIX}/${encodeURIComponent(id)}/respond?${query.toString()}`, body, idemKey, params);
      }
      case 'takeover':
      case 'resolve': {
        // Desk API takes agent_id as a QUERY parameter (FastAPI Query(...)) —
        // sending it in a JSON body yields 422 and broke the Loop→Desk chain
        // (found by combo testing, case C-B07).
        const convId = String(params.input['id'] ?? params.input['conversation_id'] ?? '');
        const q = new URLSearchParams();
        if (params.input['agent_id'] !== undefined) query_set(q, 'agent_id', params.input['agent_id']);
        const action = params.operation === 'takeover' ? 'takeover' : 'resolve';
        return this.callDesk(baseUrl, apiKey, 'POST', `${PREFIX}/${encodeURIComponent(convId)}/${action}?${q.toString()}`, undefined, idemKey, params);
      }
      default:
        throw new Error(`Unknown Desk operation: ${params.operation}`);
    }
  }

  async healthCheck(baseUrl: string = DEFAULT_BASE_URL): Promise<boolean> {
    try {
      const response = await request(`${baseUrl}/health`, { method: 'GET' });
      await response.body.text();
      return response.statusCode === 200;
    } catch (err) {
      logger.warn({ error: String(err) }, 'Desk health check failed');
      return false;
    }
  }

  getCapabilities(): ConnectorCapabilities {
    return {
      node_types: [
        'desk.list_conversations',
        'desk.get_conversation',
        'desk.send_response',
        'desk.takeover',
        'desk.resolve',
      ],
      input_types: ['Conversation', 'string'],
      output_types: ['Conversation', 'Conversation[]'],
    };
  }

  private async callDesk(
    baseUrl: string,
    apiKey: string,
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
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
          ...traceHeaders(),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: io?.signal,
      });
      if (response.statusCode >= 400) {
        // Consume the body so undici can release the socket back to the pool.
        await response.body.text().catch(() => {});
        throw new UpstreamError('UPSTREAM_DESK_UNAVAILABLE', `Desk returned ${response.statusCode}`);
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
      // Audit #41: propagate product errors (e.g. NODE_EGRESS_BLOCKED) unchanged.
      if (err instanceof LoopError) throw err;
      logger.error({ error: String(err) }, 'Desk call failed');
      throw new UpstreamError('UPSTREAM_DESK_UNAVAILABLE', String(err));
    }
  }
}
