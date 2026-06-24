/**
 * ODW Desk connector — workspace operations (§9.2).
 */

import { request } from 'undici';
import type { ConnectorAdapter, ExecuteParams, ExecuteResult } from '../interface.js';
import type { ConnectorCapabilities } from '@loop/types';
import { UpstreamError } from '@loop/types';
import { createLogger } from '@loop/observability';

const logger = createLogger({ name: 'loop:connectors:desk', component: 'connectors' });

export class DeskAdapter implements ConnectorAdapter {
  readonly type = 'desk';

  async execute(params: ExecuteParams): Promise<ExecuteResult> {
    const baseUrl = (params.config?.['base_url'] as string) ?? '';
    const apiKey = params.secrets?.['api_key'] ?? (params.config?.['api_key'] as string) ?? '';

    const ops: Record<string, [string, string]> = {
      create_task: ['POST', '/tasks'],
      update_task: ['PUT', `/tasks/${params.input['id']}`],
      complete_task: ['PATCH', `/tasks/${params.input['id']}/complete`],
      create_project: ['POST', '/projects'],
      create_calendar_event: ['POST', '/calendar/events'],
      send_notification: ['POST', '/notifications'],
    };

    const op = ops[params.operation];
    if (!op) throw new Error(`Unknown Desk operation: ${params.operation}`);

    return this.callDesk(baseUrl, apiKey, op[0], op[1], params.input);
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  getCapabilities(): ConnectorCapabilities {
    return {
      node_types: [
        'desk.create_task',
        'desk.update_task',
        'desk.complete_task',
        'desk.create_project',
        'desk.create_calendar_event',
        'desk.send_notification',
      ],
      input_types: ['Task', 'CalendarEvent', 'string'],
      output_types: ['Task', 'Project', 'CalendarEvent'],
    };
  }

  private async callDesk(
    baseUrl: string,
    apiKey: string,
    method: string,
    path: string,
    body: Record<string, unknown>,
  ): Promise<ExecuteResult> {
    try {
      const response = await request(`${baseUrl}${path}`, {
        method: method as 'GET' | 'POST' | 'PUT' | 'PATCH',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: method === 'GET' ? null : JSON.stringify(body),
      } as never);
      if (response.statusCode >= 400) {
        throw new UpstreamError('UPSTREAM_DESK_UNAVAILABLE', `Desk returned ${response.statusCode}`);
      }
      const data = await response.body.json() as Record<string, unknown>;
      return { output: data };
    } catch (err) {
      if (err instanceof UpstreamError) throw err;
      logger.error({ error: String(err) }, 'Desk call failed');
      throw new UpstreamError('UPSTREAM_DESK_UNAVAILABLE', String(err));
    }
  }
}
