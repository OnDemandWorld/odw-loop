/**
 * Generic REST connector for arbitrary APIs (§9 — generic pattern).
 */

import { request } from 'undici';
import type { ConnectorAdapter, ExecuteParams, ExecuteResult } from '../interface.js';
import type { ConnectorCapabilities } from '@loop/types';
import { UpstreamError } from '@loop/types';

export class GenericAdapter implements ConnectorAdapter {
  readonly type = 'generic';

  async execute(params: ExecuteParams): Promise<ExecuteResult> {
    const baseUrl = (params.config?.['base_url'] as string) ?? '';
    const method = (params.config?.['method'] as string) ?? (params.input['method'] as string) ?? 'POST';
    // Path segments from workflow input are sanitized before use: ".."/"."
    // segments are resolved per URL semantics (clamped at the base path —
    // traversal cannot escape), and every remaining segment is percent-encoded.
    const rawPath = (params.input['path'] as string) ?? '/';
    const qIndex = rawPath.indexOf('?');
    const pathOnly = qIndex === -1 ? rawPath : rawPath.slice(0, qIndex);
    const segments: string[] = [];
    for (const segment of pathOnly.split('/')) {
      if (segment === '..') {
        segments.pop();
        continue;
      }
      if (segment === '.') continue;
      segments.push(encodeURIComponent(segment));
    }
    const path = segments.join('/');
    const query = qIndex === -1 ? '' : `?${rawPath.slice(qIndex + 1)}`;
    const headers = (params.config?.['headers'] as Record<string, string>) ?? {};
    const body = params.input['body'] as Record<string, unknown> | undefined;

    // V1.7 (L-7): honour the `url` and `params` fields the canvas form offers.
    // An absolute `url` overrides base_url+path (still egress-gated); `params`
    // (object) is merged as query parameters after any inline ?query.
    let target: string;
    const inputUrl = params.input['url'];
    if (typeof inputUrl === 'string' && /^[a-z][a-z0-9+.-]*:\/\//i.test(inputUrl)) {
      target = inputUrl;
    } else {
      target = `${baseUrl}${path}${query}`;
    }
    const inputParams = params.input['params'];
    if (inputParams !== null && typeof inputParams === 'object' && !Array.isArray(inputParams)) {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(inputParams as Record<string, unknown>)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          for (const item of value) search.append(key, String(item));
        } else {
          search.append(key, String(value));
        }
      }
      const extra = search.toString();
      if (extra.length > 0) {
        target += target.includes('?') ? `&${extra}` : `?${extra}`;
      }
    }

    // The generic connector takes arbitrary targets from workflow input —
    // exactly the shape an SSRF needs. Enforce the egress gate when wired.
    await params.egress?.check(target);

    const response = await request(target, {
      method: method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      headers: { 'content-type': 'application/json', ...headers },
      body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(body ?? {}),
      signal: params.signal,
    });

    // Read as text first: html/plain upstreams (proxy error pages, portals)
    // made body.json() throw a bare SyntaxError — not an UpstreamError, so
    // retry/error classification and reporting lost the failure context.
    // >=400 is an UpstreamError, never "data".
    // Audit #34: cap the buffered size — the target is arbitrary workflow
    // input, and an unbounded .text() on a multi-GB export OOM-crashes the
    // whole monolith (every in-flight execution dies with it).
    const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of response.body) {
      const buf = Buffer.from(chunk as Uint8Array);
      totalBytes += buf.length;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        // Release the socket without draining the (huge) remainder.
        response.body.destroy();
        throw new UpstreamError(
          'UPSTREAM_GENERIC_HTTP_ERROR',
          `Upstream response exceeds the ${MAX_RESPONSE_BYTES} byte cap`,
        );
      }
      chunks.push(buf);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    if (response.statusCode >= 400) {
      throw new UpstreamError(
        'UPSTREAM_GENERIC_HTTP_ERROR',
        `Upstream returned ${response.statusCode}: ${text.slice(0, 200)}`,
      );
    }
    let data: Record<string, unknown> = { text };
    if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        // keep { text } representation
      }
    }
    return { output: { status: response.statusCode, data } };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  getCapabilities(): ConnectorCapabilities {
    return {
      node_types: ['generic.rest_call'],
      input_types: ['any'],
      output_types: ['any'],
    };
  }
}
