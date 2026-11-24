/**
 * Unit tests — Vault adapter field contracts (audit #40).
 *
 * The canvas form sends question/limit/filters for RAG queries and tags/folder
 * for uploads; the adapter previously read only query/top_k/folder_filter and
 * dropped tags/folder, so editor-built nodes queried with an empty string.
 *
 * undici's request is mocked (multipart streaming against a raw node:http
 * server is unreliable on this Node version — see the pre-existing vault
 * integration failure); the assertions pin the outgoing request contract.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { request, type FormData } from 'undici';
import { VaultAdapter } from '../../../packages/connectors/src/vault/adapter';

vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, request: vi.fn() };
});

const requestMock = request as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue({
    statusCode: 200,
    body: {
      text: async () => '{"answer":"ok","citations":[]}',
      json: async () => ({ answer: 'ok', citations: [] }),
    },
  });
});

describe('VaultAdapter — canvas field aliases (audit #40)', () => {
  it('maps question/limit/filters onto the Vault /query contract', async () => {
    const adapter = new VaultAdapter();
    await adapter.execute({
      operation: 'rag_query',
      input: { question: 'what is X?', limit: 5, filters: 'finance' },
      config: { base_url: 'http://vault.test' },
    } as never);
    const [url, opts] = requestMock.mock.calls[0]!;
    expect(url).toBe('http://vault.test/query');
    const body = JSON.parse(opts.body as string);
    expect(body.query).toBe('what is X?');
    expect(body.top_k_chunks).toBe(5);
    expect(body.folder_filter).toBe('finance');
  });

  it('still honors the native query/top_k_chunks/folder_filter keys', async () => {
    const adapter = new VaultAdapter();
    await adapter.execute({
      operation: 'rag_query',
      input: { query: 'native', top_k_chunks: 3, folder_filter: 'ops' },
      config: { base_url: 'http://vault.test' },
    } as never);
    const body = JSON.parse(requestMock.mock.calls[0]![1].body as string);
    expect(body.query).toBe('native');
    expect(body.top_k_chunks).toBe(3);
    expect(body.folder_filter).toBe('ops');
  });

  it('forwards tags and folder in the upload form', async () => {
    const adapter = new VaultAdapter();
    await adapter.execute({
      operation: 'create_document',
      input: { content: '# hi', title: 'note', tags: ['finance', 'prod'], folder: 'invoices' },
      config: { base_url: 'http://vault.test' },
    } as never);
    const [url, opts] = requestMock.mock.calls[0]!;
    expect(url).toBe('http://vault.test/files/upload');
    const form = opts.body as FormData;
    expect(form.get('tags')).toBe('["finance","prod"]');
    expect(form.get('folder')).toBe('invoices');
    expect(form.get('files')).toBeTruthy();
  });
});

describe('VaultAdapter — /query non-JSON guard (audit #114)', () => {
  it('fails loudly when /query answers with a non-JSON 200', async () => {
    requestMock.mockResolvedValue({
      statusCode: 200,
      body: { text: async () => '<!DOCTYPE html><html>login</html>' },
    });
    const adapter = new VaultAdapter();
    await expect(
      adapter.execute({
        operation: 'rag_query',
        input: { query: 'x' },
        config: { base_url: 'http://vault.test' },
      } as never),
    ).rejects.toMatchObject({ code: 'UPSTREAM_VAULT_BAD_RESPONSE' });
  });
});
