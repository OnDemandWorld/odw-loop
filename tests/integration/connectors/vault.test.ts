/**
 * Integration tests — Vault connector (real adapter against a mock upstream).
 *
 * Exercises the real VaultAdapter's operation → endpoint mapping and response
 * parsing against an in-process HTTP server that mimics the real Vault API
 * (INTEGRATION_CONTRACT.md §1).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { VaultAdapter } from '../../../packages/connectors/src/vault/adapter.js';
import { startMockServer, type MockServer } from './_mock-server.js';

describe('Vault connector integration', () => {
  let server: MockServer;
  let adapter: VaultAdapter;
  let config: Record<string, unknown>;

  beforeAll(async () => {
    server = await startMockServer();
    adapter = new VaultAdapter();
    config = { base_url: server.baseUrl };
  });

  beforeEach(() => {
    server.requests.length = 0;
    server.setHandler(() => ({ body: { ok: true } }));
  });

  afterAll(async () => {
    await server.close();
  });

  it('rag_query → POST /query and parses the typed response', async () => {
    server.setHandler(() => ({
      body: {
        answer: 'The budget is due Friday.',
        citations: [{ marker: '[1]', file_id: 1, snippet: 'budget' }],
        retrieved_chunks: [{ rank: 1, chunk_id: 1, text: 'budget chunk' }],
        query_log_id: 42,
      },
    }));

    const result = await adapter.execute({
      operation: 'rag_query',
      input: { query: 'when is the budget due?', top_k_chunks: 4 },
      config,
    });

    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.method).toBe('POST');
    expect(server.requests[0]?.url).toBe('/query');
    const sent = JSON.parse(server.requests[0]?.body ?? '{}') as Record<string, unknown>;
    expect(sent['query']).toBe('when is the budget due?');
    expect(sent['top_k_chunks']).toBe(4);

    expect(result.output['answer']).toBe('The budget is due Friday.');
    expect(result.output['query_log_id']).toBe(42);
    expect(result.output['citations']).toHaveLength(1);
    expect(result.output['retrieved_chunks']).toHaveLength(1);
  });

  it('search → POST /query and returns retrieved_chunks', async () => {
    server.setHandler(() => ({
      body: {
        answer: 'ignored',
        retrieved_chunks: [
          { rank: 1, text: 'a' },
          { rank: 2, text: 'b' },
        ],
      },
    }));

    const result = await adapter.execute({
      operation: 'search',
      input: { query: 'find things' },
      config,
    });

    expect(server.requests[0]?.url).toBe('/query');
    expect(result.output['count']).toBe(2);
    expect(result.output['retrieved_chunks']).toHaveLength(2);
  });

  it('create_document → POST /files/upload as multipart "files"', async () => {
    server.setHandler(() => ({ body: { uploaded: 1, failed: [] } }));

    const result = await adapter.execute({
      operation: 'create_document',
      input: { title: 'Meeting Notes', content: '# Hello world' },
      config,
    });

    const req = server.requests[0];
    expect(req?.method).toBe('POST');
    expect(req?.url).toBe('/files/upload');
    expect(req?.headers['content-type']).toMatch(/multipart\/form-data/);
    expect(req?.body).toContain('# Hello world');
    expect(req?.body).toContain('Meeting Notes.md');

    expect(result.output['uploaded']).toBe(1);
    expect(result.output['filename']).toBe('Meeting Notes.md');
  });

  it('get_document → GET /files/{id}', async () => {
    server.setHandler(() => ({ body: { id: 7, rel_path: 'docs/a.md' } }));

    const result = await adapter.execute({ operation: 'get_document', input: { id: 7 }, config });

    expect(server.requests[0]?.method).toBe('GET');
    expect(server.requests[0]?.url).toBe('/files/7');
    expect(result.output['id']).toBe(7);
  });

  it('get_text → GET /files/{id}/text and wraps raw text', async () => {
    server.setHandler(() => ({ raw: 'plain extracted text' }));

    const result = await adapter.execute({ operation: 'get_text', input: { id: 9 }, config });

    expect(server.requests[0]?.url).toBe('/files/9/text');
    expect(result.output['text']).toBe('plain extracted text');
  });

  it('delete_document → DELETE /files/{id}', async () => {
    server.setHandler(() => ({ status: 200, body: {} }));

    await adapter.execute({ operation: 'delete_document', input: { id: 3 }, config });

    expect(server.requests[0]?.method).toBe('DELETE');
    expect(server.requests[0]?.url).toBe('/files/3');
  });

  it('sends Authorization only when api_key is provided', async () => {
    server.setHandler(() => ({ body: {} }));

    await adapter.execute({ operation: 'get_document', input: { id: 1 }, config });
    expect(server.requests[0]?.headers['authorization']).toBeUndefined();

    server.requests.length = 0;
    await adapter.execute({
      operation: 'get_document',
      input: { id: 1 },
      config: { base_url: server.baseUrl, api_key: 'secret' },
    });
    expect(server.requests[0]?.headers['authorization']).toBe('Bearer secret');
  });

  it('throws UpstreamError on non-2xx responses', async () => {
    server.setHandler(() => ({ status: 503, body: { detail: 'chroma down' } }));

    await expect(
      adapter.execute({ operation: 'rag_query', input: { query: 'x' }, config }),
    ).rejects.toThrow(/Vault returned 503/);
  });

  it('healthCheck returns true on 200 and false otherwise', async () => {
    server.setHandler(() => ({ body: { ollama: true, chroma: true, database: true, fasttext: true } }));
    expect(await adapter.healthCheck(server.baseUrl)).toBe(true);

    server.setHandler(() => ({ status: 500, body: {} }));
    expect(await adapter.healthCheck(server.baseUrl)).toBe(false);

    // Unreachable host → false (wrapped in try/catch).
    expect(await adapter.healthCheck('http://127.0.0.1:1')).toBe(false);
  });

  it('advertises the real Vault node types', () => {
    const caps = adapter.getCapabilities();
    expect(caps.node_types).toEqual(
      expect.arrayContaining([
        'vault.rag_query',
        'vault.search',
        'vault.create_document',
        'vault.get_document',
        'vault.get_text',
        'vault.delete_document',
      ]),
    );
    expect(caps.node_types).not.toContain('vault.manage_tags');
  });
});
