/**
 * ODW Recap connector — meeting intelligence (§9.3).
 */

import { request } from 'undici';
import type { ConnectorAdapter, ExecuteParams, ExecuteResult } from '../interface.js';
import type { ConnectorCapabilities } from '@loop/types';
import { UpstreamError } from '@loop/types';
import { createLogger } from '@loop/observability';

const logger = createLogger({ name: 'loop:connectors:recap', component: 'connectors' });

export class RecapAdapter implements ConnectorAdapter {
  readonly type = 'recap';

  async execute(params: ExecuteParams): Promise<ExecuteResult> {
    const baseUrl = (params.config?.['base_url'] as string) ?? '';
    const apiKey = params.secrets?.['api_key'] ?? (params.config?.['api_key'] as string) ?? '';

    const ops: Record<string, [string, string]> = {
      ingest_transcript: ['POST', '/transcripts'],
      extract_action_items: ['POST', '/transcripts/extract'],
      summarize: ['POST', '/transcripts/summarize'],
      classify: ['POST', '/transcripts/classify'],
      get_transcript: ['GET', `/transcripts/${params.input['id']}`],
    };

    const op = ops[params.operation];
    if (!op) throw new Error(`Unknown Recap operation: ${params.operation}`);

    return this.callRecap(baseUrl, apiKey, op[0], op[1], params.input);
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  getCapabilities(): ConnectorCapabilities {
    return {
      node_types: [
        'recap.ingest_transcript',
        'recap.extract_action_items',
        'recap.summarize',
        'recap.classify',
        'recap.get_transcript',
      ],
      input_types: ['Transcript', 'string'],
      output_types: ['ActionItem[]', 'Transcript', 'string'],
    };
  }

  private async callRecap(
    baseUrl: string,
    apiKey: string,
    method: string,
    path: string,
    body: Record<string, unknown>,
  ): Promise<ExecuteResult> {
    try {
      const response = await request(`${baseUrl}${path}`, {
        method: method as 'GET' | 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: method === 'GET' ? undefined : JSON.stringify(body),
      });
      if (response.statusCode >= 400) {
        throw new UpstreamError('UPSTREAM_RECAP_UNAVAILABLE', `Recap returned ${response.statusCode}`);
      }
      const data = await response.body.json() as Record<string, unknown>;
      return { output: data };
    } catch (err) {
      if (err instanceof UpstreamError) throw err;
      logger.error({ error: String(err) }, 'Recap call failed');
      throw new UpstreamError('UPSTREAM_RECAP_UNAVAILABLE', String(err));
    }
  }
}
