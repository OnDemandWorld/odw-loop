/**
 * Tiny in-process HTTP server used to exercise the real connector adapters
 * against a programmable upstream. Captures every request so tests can assert
 * method / URL / headers / body, and returns a programmed response.
 */

import { createServer, type Server, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

export interface MockResponse {
  status?: number;
  /** JSON-serialisable body (sent as application/json). */
  body?: unknown;
  /** Raw string body (takes precedence over `body`). */
  raw?: string;
  contentType?: string;
}

export interface MockServer {
  baseUrl: string;
  requests: RecordedRequest[];
  setHandler(handler: (req: RecordedRequest) => MockResponse): void;
  close(): Promise<void>;
}

export async function startMockServer(defaultResponse: MockResponse = { body: { ok: true } }): Promise<MockServer> {
  const requests: RecordedRequest[] = [];
  let handler: (req: RecordedRequest) => MockResponse = () => defaultResponse;

  const server: Server = createServer((req, res) => {
    let data = '';
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString('utf8');
    });
    req.on('end', () => {
      const recorded: RecordedRequest = {
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        headers: req.headers,
        body: data,
      };
      requests.push(recorded);

      const result = handler(recorded);
      const status = result.status ?? 200;
      if (result.raw !== undefined) {
        res.writeHead(status, { 'content-type': result.contentType ?? 'text/plain' });
        res.end(result.raw);
      } else {
        res.writeHead(status, { 'content-type': result.contentType ?? 'application/json' });
        res.end(JSON.stringify(result.body ?? {}));
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    setHandler: (h) => {
      handler = h;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
