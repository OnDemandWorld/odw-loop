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
import { UpstreamError } from '@loop/types';
import { createLogger } from '@loop/observability';
import { traceHeaders } from '../trace.js';

const logger = createLogger({ name: 'loop:connectors:desk', component: 'connectors' });

const DEFAULT_BASE_URL = 'http://localhost:8000';
const PREFIX = '/api/v1/agents/conversations';

export class DeskAdapter implements ConnectorAdapter {
  readonly type = 'desk';

  async execute(params: ExecuteParams): Promise<ExecuteResult> {
    const baseUrl = (params.config?.['base_url'] as string) || DEFAULT_BASE_URL;
    const apiKey = params.secrets?.['api_key'] ?? (params.config?.['api_key'] as string) ?? '';
    // V1.1 M1 (F2): best-effort idempotency key forwarded as an upstream header.
    const idemKey = params.idempotencyKey;

    switch (params.operation) {
      case 'list_conversations':
        return this.callDesk(baseUrl, apiKey, 'GET', PREFIX, undefined, idemKey);
      case 'get_conversation':
        return this.callDesk(baseUrl, apiKey, 'GET', `${PREFIX}/${String(params.input['id'])}`, undefined, idemKey);
      case 'send_response': {
        const id = String(params.input['id'] ?? params.input['conversation_id'] ?? '');
        const query = new URLSearchParams();
        if (params.input['agent_id'] !== undefined) query.set('agent_id', String(params.input['agent_id']));
        if (params.input['content'] !== undefined) query.set('content', String(params.input['content']));
        return this.callDesk(baseUrl, apiKey, 'POST', `${PREFIX}/${id}/respond?${query.toString()}`, undefined, idemKey);
      }
      case 'takeover':
        return this.callDesk(
          baseUrl,
          apiKey,
          'POST',
          `${PREFIX}/${String(params.input['id'])}/takeover`,
          params.input['agent_id'] !== undefined ? { agent_id: params.input['agent_id'] } : {},
          idemKey,
        );
      case 'resolve':
        return this.callDesk(
          baseUrl,
          apiKey,
          'POST',
          `${PREFIX}/${String(params.input['id'])}/resolve`,
          params.input['agent_id'] !== undefined ? { agent_id: params.input['agent_id'] } : {},
          idemKey,
        );
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
  ): Promise<ExecuteResult> {
    try {
      const response = await request(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
          ...traceHeaders(),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (response.statusCode >= 400) {
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
      logger.error({ error: String(err) }, 'Desk call failed');
      throw new UpstreamError('UPSTREAM_DESK_UNAVAILABLE', String(err));
    }
  }
}
