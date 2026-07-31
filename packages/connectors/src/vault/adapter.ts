/**
 * ODW Vault connector — knowledge-base (RAG) operations.
 *
 * Targets the real Vault HTTP API (see INTEGRATION_CONTRACT.md §1):
 *   - POST /query            → RAG query / retrieval
 *   - POST /files/upload     → multipart document upload (field "files")
 *   - GET  /files/{id}       → file metadata
 *   - GET  /files/{id}/text  → extracted file text
 *   - DELETE /files/{id}     → remove a file
 *   - GET  /health           → component health
 *
 * Vault has NO auth by default; an Authorization header is sent only when an
 * api_key is explicitly configured.
 */

import { request, FormData, File } from 'undici';
import type { ConnectorAdapter, ExecuteParams, ExecuteResult } from '../interface.js';
import type { ConnectorCapabilities } from '@loop/types';
import { UpstreamError } from '@loop/types';
import { createLogger } from '@loop/observability';

const logger = createLogger({ name: 'loop:connectors:vault', component: 'connectors' });

const DEFAULT_BASE_URL = 'http://localhost:8765';

export class VaultAdapter implements ConnectorAdapter {
  readonly type = 'vault';

  async execute(params: ExecuteParams): Promise<ExecuteResult> {
    const baseUrl = (params.config?.['base_url'] as string) || DEFAULT_BASE_URL;
    const apiKey = params.secrets?.['api_key'] ?? (params.config?.['api_key'] as string) ?? '';

    switch (params.operation) {
      case 'rag_query':
        return this.ragQuery(baseUrl, apiKey, params.input);
      case 'search':
        return this.search(baseUrl, apiKey, params.input);
      case 'create_document':
        return this.uploadDocument(baseUrl, apiKey, params.input);
      case 'get_document':
        return { output: await this.callVault(baseUrl, apiKey, 'GET', `/files/${String(params.input['id'])}`) };
      case 'get_text':
        return { output: await this.callVault(baseUrl, apiKey, 'GET', `/files/${String(params.input['id'])}/text`) };
      case 'delete_document':
        return { output: await this.callVault(baseUrl, apiKey, 'DELETE', `/files/${String(params.input['id'])}`) };
      default:
        throw new Error(`Unknown Vault operation: ${params.operation}`);
    }
  }

  async healthCheck(baseUrl: string = DEFAULT_BASE_URL): Promise<boolean> {
    try {
      const response = await request(`${baseUrl}/health`, { method: 'GET' });
      // Drain the body so the socket can be released.
      await response.body.text();
      return response.statusCode === 200;
    } catch (err) {
      logger.warn({ error: String(err) }, 'Vault health check failed');
      return false;
    }
  }

  getCapabilities(): ConnectorCapabilities {
    return {
      node_types: [
        'vault.rag_query',
        'vault.search',
        'vault.create_document',
        'vault.get_document',
        'vault.get_text',
        'vault.delete_document',
      ],
      input_types: ['Document', 'string'],
      output_types: ['Document', 'Document[]', 'string'],
    };
  }

  /** RAG query — POST /query, parsed into a typed shape. */
  private async ragQuery(
    baseUrl: string,
    apiKey: string,
    input: Record<string, unknown>,
  ): Promise<ExecuteResult> {
    const data = await this.postQuery(baseUrl, apiKey, input);
    return {
      output: {
        answer: data['answer'] ?? '',
        citations: data['citations'] ?? [],
        retrieved_chunks: data['retrieved_chunks'] ?? [],
        query_log_id: data['query_log_id'] ?? null,
      },
    };
  }

  /** Retrieval-focused query — POST /query, returns the retrieved chunks. */
  private async search(
    baseUrl: string,
    apiKey: string,
    input: Record<string, unknown>,
  ): Promise<ExecuteResult> {
    const data = await this.postQuery(baseUrl, apiKey, input);
    const chunks = (data['retrieved_chunks'] as unknown[] | undefined) ?? [];
    return {
      output: {
        retrieved_chunks: chunks,
        count: chunks.length,
      },
    };
  }

  private async postQuery(
    baseUrl: string,
    apiKey: string,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {
      query: input['query'] ?? '',
      top_k_chunks: input['top_k_chunks'] ?? input['top_k'] ?? 8,
    };
    if (input['folder_filter'] !== undefined) body['folder_filter'] = input['folder_filter'];
    if (input['conversation_id'] !== undefined) body['conversation_id'] = input['conversation_id'];
    return this.callVault(baseUrl, apiKey, 'POST', '/query', body);
  }

  /** Upload a document built from input.content + input.title/name. */
  private async uploadDocument(
    baseUrl: string,
    apiKey: string,
    input: Record<string, unknown>,
  ): Promise<ExecuteResult> {
    const content = String(input['content'] ?? '');
    const title = String(input['title'] ?? input['name'] ?? 'document');
    const filename = title.endsWith('.md') || title.includes('.') ? title : `${title}.md`;

    const form = new FormData();
    form.append('files', new File([content], filename, { type: 'text/markdown' }));

    try {
      const response = await request(`${baseUrl}/files/upload`, {
        method: 'POST',
        headers: {
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: form,
      });

      if (response.statusCode >= 400) {
        throw new UpstreamError('UPSTREAM_VAULT_UNAVAILABLE', `Vault returned ${response.statusCode}`);
      }

      const data = (await response.body.json()) as Record<string, unknown>;
      return {
        output: {
          uploaded: data['uploaded'] ?? 0,
          failed: data['failed'] ?? [],
          filename,
        },
      };
    } catch (err) {
      if (err instanceof UpstreamError) throw err;
      logger.error({ error: String(err) }, 'Vault upload failed');
      throw new UpstreamError('UPSTREAM_VAULT_UNAVAILABLE', String(err));
    }
  }

  private async callVault(
    baseUrl: string,
    apiKey: string,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    try {
      const response = await request(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (response.statusCode >= 400) {
        throw new UpstreamError('UPSTREAM_VAULT_UNAVAILABLE', `Vault returned ${response.statusCode}`);
      }

      const text = await response.body.text();
      if (!text) return {};
      try {
        return JSON.parse(text) as Record<string, unknown>;
      } catch {
        // Non-JSON body (e.g. raw file text) — return it verbatim.
        return { text };
      }
    } catch (err) {
      if (err instanceof UpstreamError) throw err;
      logger.error({ error: String(err) }, 'Vault call failed');
      throw new UpstreamError('UPSTREAM_VAULT_UNAVAILABLE', String(err));
    }
  }
}
