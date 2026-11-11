#!/usr/bin/env node
/**
 * Mock upstream services for runtime verification of the Loop API.
 *
 * Simulates the ODW sibling products (Vault / Desk / Recap), a generic REST
 * upstream and an OpenAI-compatible LLM endpoint. Every request is appended to
 * <logDir>/upstream.jsonl so the verifier can assert side effects (auth
 * headers, idempotency keys, retry counts, egress blocking).
 *
 * Usage: node mock-services.mjs <logDir>
 */
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const logDir = process.argv[2] ?? '/tmp/loop-runtime-verify';
mkdirSync(logDir, { recursive: true });
const logFile = join(logDir, 'upstream.jsonl');

const flakyCounters = new Map();

function logRequest(service, req, body) {
  const entry = {
    ts: Date.now(),
    service,
    method: req.method,
    path: req.url,
    authorization: req.headers['authorization'] ?? null,
    idempotency_key: req.headers['idempotency-key'] ?? null,
    content_type: req.headers['content-type'] ?? null,
    body: typeof body === 'string' ? body.slice(0, 4000) : body,
  };
  appendFileSync(logFile, JSON.stringify(entry) + '\n');
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function json(res, code, obj) {
  const text = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(text);
}

async function handler(service, req, res) {
  const bodyText = await readBody(req);
  let body = bodyText;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    /* keep raw text (multipart etc.) */
  }
  logRequest(service, req, body);
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  // ── Vault (:18765) ──────────────────────────────────────────────────────
  if (service === 'vault') {
    if (p === '/health') return json(res, 200, { status: 'ok' });
    if (p === '/query' && req.method === 'POST') {
      return json(res, 200, {
        answer: `Vault answer to: ${body?.query ?? ''}`,
        citations: [{ file_id: 'f-1', title: 'loop-docs.md' }],
        retrieved_chunks: [{ id: 'c1', text: 'Loop orchestrates agents.', score: 0.9 }],
        query_log_id: 'ql-1',
      });
    }
    if (p === '/files/upload' && req.method === 'POST') {
      return json(res, 200, { uploaded: 1, failed: [] });
    }
    if (p.startsWith('/files/') && p.endsWith('/text')) {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('Extracted document text.');
    }
    if (p.startsWith('/files/')) {
      if (req.method === 'DELETE') return json(res, 200, { deleted: true });
      return json(res, 200, { id: p.split('/')[2], name: 'loop-docs.md', size: 1024 });
    }
    return json(res, 404, { error: 'not found' });
  }

  // ── Desk (:18766) ───────────────────────────────────────────────────────
  if (service === 'desk') {
    if (p === '/health') return json(res, 200, { status: 'ok' });
    const m = p.match(/^\/api\/v1\/agents\/conversations(?:\/([^/]+))?(?:\/(respond|takeover|resolve))?$/);
    if (m) {
      const [, id, action] = m;
      if (!id && req.method === 'GET') {
        return json(res, 200, { conversations: [{ id: 'conv-1', subject: 'Billing question', status: 'open' }] });
      }
      if (id && !action && req.method === 'GET') {
        return json(res, 200, { id, subject: 'Billing question', status: 'open', messages: [] });
      }
      if (action === 'respond' && req.method === 'POST') {
        return json(res, 200, { ok: true, conversation_id: id, content: body?.content ?? null, agent_id: url.searchParams.get('agent_id') });
      }
      if ((action === 'takeover' || action === 'resolve') && req.method === 'POST') {
        return json(res, 200, { ok: true, conversation_id: id, action, agent_id: url.searchParams.get('agent_id') });
      }
    }
    return json(res, 404, { error: 'not found' });
  }

  // ── Recap (:18767) ──────────────────────────────────────────────────────
  if (service === 'recap') {
    if (p === '/health') return json(res, 200, { status: 'ok' });
    if (p === '/auth/login' && req.method === 'POST') {
      return json(res, 200, { token: 'recap-mock-jwt' });
    }
    if (p === '/meetings/' && req.method === 'GET') {
      return json(res, 200, { meetings: [{ id: 'mtg-1', title: 'Sprint planning' }] });
    }
    if (p === '/meetings/' && req.method === 'POST') {
      return json(res, 201, { id: 'mtg-new', ...body });
    }
    if (p.startsWith('/meetings/') && req.method === 'GET') {
      return json(res, 200, { id: p.split('/')[2], title: 'Sprint planning', transcript: '…' });
    }
    if (p === '/sync' && req.method === 'POST') return json(res, 200, { synced: true });
    return json(res, 404, { error: 'not found' });
  }

  // ── Generic REST (:18768) ───────────────────────────────────────────────
  if (service === 'rest') {
    if (p === '/health') return json(res, 200, { status: 'ok' });
    if (p === '/echo') {
      return json(res, 200, {
        method: req.method,
        path: p,
        query: Object.fromEntries(url.searchParams),
        headers: { authorization: req.headers['authorization'] ?? null },
        body,
      });
    }
    if (p === '/fail500') return json(res, 500, { error: 'boom' });
    if (p === '/flaky') {
      const n = (flakyCounters.get('flaky') ?? 0) + 1;
      flakyCounters.set('flaky', n);
      if (n <= 2) return json(res, 503, { error: `flaky failure #${n}` });
      return json(res, 200, { ok: true, attempts: n });
    }
    if (p === '/slow') {
      await new Promise((r) => setTimeout(r, 3000));
      return json(res, 200, { ok: true, slow: true });
    }
    return json(res, 404, { error: 'not found' });
  }

  // ── LLM OpenAI-compatible (:18769) ──────────────────────────────────────
  if (service === 'llm') {
    if (p === '/v1/models') return json(res, 200, { data: [{ id: 'mock-model' }] });
    if (p === '/v1/chat/completions' && req.method === 'POST') {
      const lastUser = [...(body?.messages ?? [])].reverse().find((m) => m.role === 'user');
      return json(res, 200, {
        id: 'chatcmpl-mock',
        object: 'chat.completion',
        model: body?.model ?? 'mock-model',
        choices: [
          { index: 0, message: { role: 'assistant', content: `MOCK_LLM_REPLY: ${lastUser?.content ?? ''}` }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      });
    }
    return json(res, 404, { error: 'not found' });
  }

  json(res, 404, { error: 'unknown service' });
}

const ports = { vault: 18765, desk: 18766, recap: 18767, rest: 18768, llm: 18769 };
for (const [service, port] of Object.entries(ports)) {
  createServer((req, res) => {
    handler(service, req, res).catch((err) => {
      console.error(`[mock:${service}]`, err);
      json(res, 500, { error: String(err) });
    });
  }).listen(port, '127.0.0.1', () => console.log(`[mock:${service}] listening on 127.0.0.1:${port}`));
}