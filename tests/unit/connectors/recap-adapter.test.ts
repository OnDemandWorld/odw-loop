import { describe, it, expect, afterAll } from 'vitest';
import * as http from 'node:http';
import { RecapAdapter } from '../../../packages/connectors/src/recap/adapter';
import { UpstreamError } from '@loop/types';

describe('RecapAdapter — non-JSON response handling', () => {
  const server = http.createServer((_req, res) => {
    // Simulates a wrong host/port: an unrelated HTML web app answering on the
    // configured port (e.g. a default-port collision).
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!DOCTYPE html><html><body>not recap</body></html>');
  });
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('fails loudly instead of wrapping HTML into { text } output', async () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const adapter = new RecapAdapter();
    const promise = adapter.execute({
      operation: 'list_meetings',
      input: {},
      config: { base_url: `http://127.0.0.1:${port}` },
    } as never);
    await expect(promise).rejects.toBeInstanceOf(UpstreamError);
    await expect(promise).rejects.toMatchObject({ code: 'UPSTREAM_RECAP_BAD_RESPONSE' });
  });
});
