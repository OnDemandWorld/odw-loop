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
import { UpstreamError, LoopError } from '@loop/types';
import { createLogger } from '@loop/observability';
import { traceHeaders } from '../trace.js';

const logger = createLogger({ name: 'loop:connectors:vault', component: 'connectors' });

const DEFAULT_BASE_URL = 'http://localhost:8765';

export class VaultAdapter implements ConnectorAdapter {
  readonly type = 'vault';

  async execute(params: ExecuteParams): Promise<ExecuteResult> {
    const baseUrl = (params.config?.['base_url'] as string) || DEFAULT_BASE_URL;
    const apiKey = params.secrets?.['api_key'] ?? (params.config?.['api_key'] as string) ?? '';

    // V1.1 M1 (F2): best-effort idempotency key forwarded as an upstream header.
    const idemKey = params.idempotencyKey;

    switch (params.operation) {
      case 'rag_query':
        return this.ragQuery(baseUrl, apiKey, params.input, idemKey, params);
      case 'search':
        return this.search(baseUrl, apiKey, params.input, idemKey, params);
      case 'create_document':
        return this.uploadDocument(baseUrl, apiKey, params.input, idemKey, params);
      case 'get_document':
        return { output: await this.callVault(baseUrl, apiKey, 'GET', `/files/${encodeURIComponent(String(params.input['id']))}`, undefined, idemKey, params) };
      case 'get_text':
        return { output: await this.callVault(baseUrl, apiKey, 'GET', `/files/${encodeURIComponent(String(params.input['id']))}/text`, undefined, idemKey, params) };
      case 'delete_document':
        return { output: await this.callVault(baseUrl, apiKey, 'DELETE', `/files/${encodeURIComponent(String(params.input['id']))}`, undefined, idemKey, params) };
      default:
        throw new Error(`Unknown Vault operation: ${params.operation}`);
    }
  }

  async healthCheck(baseUrl: string = DEFAULT_BASE_URL, signal?: AbortSignal): Promise<boolean> {
    try {
      const response = await request(`${baseUrl}/health`, { method: 'GET', signal: signal ?? AbortSignal.timeout(3000) });
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
    idempotencyKey?: string,
    io?: Pick<ExecuteParams, 'egress' | 'signal'>,
  ): Promise<ExecuteResult> {
    const data = await this.postQuery(baseUrl, apiKey, input, idempotencyKey, io);
    // Audit #114: a non-JSON 200 (proxy login page, wrong port) comes back as
    // {text} from callVault's lenient path — mapping that to an empty answer
    // let the workflow continue on garbage. /query must answer JSON.
    if (data['answer'] === undefined && data['text'] !== undefined) {
      throw new UpstreamError(
        'UPSTREAM_VAULT_BAD_RESPONSE',
        `Vault /query returned a non-JSON response: ${String(data['text']).slice(0, 200)}`,
      );
    }
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
    idempotencyKey?: string,
    io?: Pick<ExecuteParams, 'egress' | 'signal'>,
  ): Promise<ExecuteResult> {
    const data = await this.postQuery(baseUrl, apiKey, input, idempotencyKey, io);
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
    idempotencyKey?: string,
    io?: Pick<ExecuteParams, 'egress' | 'signal'>,
  ): Promise<Record<string, unknown>> {
    // Audit #40: accept the canvas field names as aliases — the editor form
    // sends question/limit/filters, which previously arrived as an empty query.
    const body: Record<string, unknown> = {
      query: input['query'] ?? input['question'] ?? '',
      top_k_chunks: input['top_k_chunks'] ?? input['top_k'] ?? input['limit'] ?? 8,
    };
    const folderFilter = input['folder_filter'] ?? input['filters'];
    if (folderFilter !== undefined) body['folder_filter'] = folderFilter;
    if (input['conversation_id'] !== undefined) body['conversation_id'] = input['conversation_id'];
    return this.callVault(baseUrl, apiKey, 'POST', '/query', body, idempotencyKey, io);
  }

  /** Upload a document built from input.content + input.title/name. */
  private async uploadDocument(
    baseUrl: string,
    apiKey: string,
    input: Record<string, unknown>,
    idempotencyKey?: string,
    io?: Pick<ExecuteParams, 'egress' | 'signal'>,
  ): Promise<ExecuteResult> {
    const content = String(input['content'] ?? '');
    const title = String(input['title'] ?? input['name'] ?? 'document');
    const filename = title.endsWith('.md') || title.includes('.') ? title : `${title}.md`;

    const form = new FormData();
    form.append('files', new File([content], filename, { type: 'text/markdown' }));
    // Audit #40: forward the canvas tags/folder fields (previously dropped).
    if (input['tags'] !== undefined) form.append('tags', JSON.stringify(input['tags']));
    if (input['folder'] !== undefined) form.append('folder', String(input['folder']));

    try {
      const url = `${baseUrl}/files/upload`;
      await io?.egress?.check(url);
      const response = await request(url, {
        method: 'POST',
        headers: {
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
          ...traceHeaders(),
        },
        body: form,
        signal: io?.signal,
      });

      if (response.statusCode >= 400) {
        // Consume the body so undici can release the socket back to the pool.
        await response.body.text().catch(() => {});
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
    idempotencyKey?: string,
    io?: Pick<ExecuteParams, 'egress' | 'signal'>,
  ): Promise<Record<string, unknown>> {
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
      // Audit #41: product errors (e.g. the egress gate's NODE_EGRESS_BLOCKED)
      // must propagate unchanged — wrapping them as UPSTREAM_VAULT_UNAVAILABLE
      // masked policy blocks as outages and made the executor retry them.
      if (err instanceof LoopError) throw err;
      // Include the target URL and underlying cause — bare "AggregateError"
      // gave no clue which host was unreachable (found via combo testing).
      const detail =
        err instanceof Error
          ? err.cause
            ? `${err.message} (${String(err.cause)})`
            : err.message
          : String(err);
      logger.error({ error: detail, url: `${baseUrl}${path}`, method }, 'Vault call failed');
      throw new UpstreamError('UPSTREAM_VAULT_UNAVAILABLE', `${method} ${baseUrl}${path}: ${detail}`);
    }
  }
}
