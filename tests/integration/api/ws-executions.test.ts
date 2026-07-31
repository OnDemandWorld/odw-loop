/**
 * Integration tests — real-time execution WebSocket (V1.1 M2, W3).
 *
 * Boots the real Fastify app (in-memory SQLite) with the WS route registered,
 * connects a native WebSocket client to `GET /ws/executions/:id`, runs an
 * execution through the real executor, and asserts the client receives live
 * node-status events pushed via the engine EventBus. Also verifies the
 * LOOP_REQUIRE_AUTH gate rejects token-less upgrades.
 *
 * A single EventBus instance is shared explicitly between the executor and the
 * WS route so the test never depends on which module copy a singleton came from.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, type TestApp } from '../_helpers/app.js';
import { registerExecutionWebSocket } from '../../../apps/api/src/routes/ws.js';
import { ExecutionExecutor } from '../../../packages/engine/src/index.js';
import { EventBus } from '../../../packages/engine/src/eventBus.js';
import type { WorkflowDefinition } from '../../../packages/types/src/index.js';

/** A single passing node — `transform` has no adapter, so it passes input through. */
const ONE_NODE_DEFINITION: WorkflowDefinition = {
  version: '1.0',
  nodes: [{ id: 'node_a', type: 'transform', position: { x: 0, y: 0 }, config: { value: 1 } }],
  edges: [],
  variables: {},
  metadata: { name: 'ws-test-workflow', tags: ['ws'] },
};

interface WsMessage {
  type: string;
  executionId?: string;
  nodeId?: string;
  status?: string;
  nodes?: unknown;
  [key: string]: unknown;
}

/** Open a WebSocket and resolve once it is connected. */
function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error(`WS connection error: ${url}`));
  });
}

/**
 * Collect messages until `predicate` matches one of them (or timeout).
 * Resolves with the full list gathered; rejects on timeout.
 */
function collectUntil(
  ws: WebSocket,
  predicate: (m: WsMessage) => boolean,
  timeoutMs = 8_000,
): Promise<WsMessage[]> {
  return new Promise((resolve, reject) => {
    const received: WsMessage[] = [];
    const onMessage = (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data)) as WsMessage;
      received.push(msg);
      if (predicate(msg)) {
        cleanup();
        resolve(received);
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for WS message. Received: ${JSON.stringify(received)}`));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
    };
    ws.addEventListener('message', onMessage);
  });
}

async function seedExecution(ctx: TestApp, definition: WorkflowDefinition): Promise<string> {
  const workflowId = crypto.randomUUID();
  await ctx.store.workflows.create({
    id: workflowId,
    name: 'WS test workflow',
    description: '',
    definition,
    created_by: 'system',
  });
  const executionId = crypto.randomUUID();
  await ctx.store.executions.create({
    id: executionId,
    workflow_id: workflowId,
    workflow_version: 1,
    trigger_type: 'manual',
    trigger_payload: {},
  });
  return executionId;
}

describe('WebSocket /ws/executions/:id — live node status push', () => {
  let ctx: TestApp;
  let app: FastifyInstance;
  let baseUrl: string;
  let bus: EventBus;
  let executor: ExecutionExecutor;

  beforeAll(async () => {
    ctx = await buildTestApp();
    app = ctx.app;
    bus = new EventBus();
    executor = new ExecutionExecutor(ctx.store, ctx.connectors, 10, 1_000, 5_000, bus);
    // Register the WS route on the test app (buildTestApp wires REST only),
    // sharing the exact bus the executor publishes to.
    await registerExecutionWebSocket(app, { config: ctx.config, store: ctx.store, eventBus: bus });
    baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await app.close();
    ctx.conn.close();
  });

  it('pushes node status events to a subscribed client during execution', async () => {
    const executionId = await seedExecution(ctx, ONE_NODE_DEFINITION);
    const wsUrl = `${baseUrl.replace('http', 'ws')}/ws/executions/${executionId}`;

    const ws = await connect(wsUrl);
    try {
      // Start collecting, then drive a real execution through the executor.
      const collected = collectUntil(ws, (m) => m.type === 'node_succeeded');
      await executor.execute(executionId, ONE_NODE_DEFINITION, {});
      const messages = await collected;

      // A node_started (running) event was pushed…
      const started = messages.find((m) => m.type === 'node_started');
      expect(started).toBeDefined();
      expect(started?.executionId).toBe(executionId);
      expect(started?.nodeId).toBe('node_a');
      expect(started?.status).toBe('running');

      // …followed by a node_succeeded event for the same node.
      const succeeded = messages.find((m) => m.type === 'node_succeeded');
      expect(succeeded).toBeDefined();
      expect(succeeded?.nodeId).toBe('node_a');
      expect(succeeded?.status).toBe('succeeded');
    } finally {
      ws.close();
    }
  });

  it('sends an initial snapshot message on connect', async () => {
    const executionId = await seedExecution(ctx, ONE_NODE_DEFINITION);
    const wsUrl = `${baseUrl.replace('http', 'ws')}/ws/executions/${executionId}`;

    const ws = await connect(wsUrl);
    try {
      const messages = await collectUntil(ws, (m) => m.type === 'snapshot');
      const snapshot = messages.find((m) => m.type === 'snapshot');
      expect(snapshot?.executionId).toBe(executionId);
      expect(Array.isArray(snapshot?.nodes)).toBe(true);
    } finally {
      ws.close();
    }
  });
});

describe('WebSocket /ws/executions/:id — auth gate (LOOP_REQUIRE_AUTH)', () => {
  const API_KEY = 'ws-test-secret-key';
  let ctx: TestApp;
  let app: FastifyInstance;
  let baseUrl: string;
  let bus: EventBus;
  let executor: ExecutionExecutor;

  beforeAll(async () => {
    ctx = await buildTestApp({ LOOP_REQUIRE_AUTH: true, LOOP_API_KEY: API_KEY });
    app = ctx.app;
    bus = new EventBus();
    executor = new ExecutionExecutor(ctx.store, ctx.connectors, 10, 1_000, 5_000, bus);
    await registerExecutionWebSocket(app, { config: ctx.config, store: ctx.store, eventBus: bus });
    baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await app.close();
    ctx.conn.close();
  });

  it('rejects a token-less upgrade with close code 4401', async () => {
    const executionId = crypto.randomUUID();
    const wsUrl = `${baseUrl.replace('http', 'ws')}/ws/executions/${executionId}`;

    const closeInfo = await new Promise<{ code: number }>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => reject(new Error('Timed out waiting for close')), 8_000);
      ws.onclose = (ev: CloseEvent) => {
        clearTimeout(timer);
        resolve({ code: ev.code });
      };
      ws.onerror = () => {
        /* the rejection surfaces via onclose */
      };
    });

    expect(closeInfo.code).toBe(4401);
  });

  it('accepts an upgrade authenticated via ?token=<api-key>', async () => {
    const executionId = await seedExecution(ctx, ONE_NODE_DEFINITION);
    const wsUrl = `${baseUrl.replace('http', 'ws')}/ws/executions/${executionId}?token=${API_KEY}`;

    const ws = await connect(wsUrl);
    try {
      const collected = collectUntil(ws, (m) => m.type === 'node_succeeded');
      await executor.execute(executionId, ONE_NODE_DEFINITION, {});
      const messages = await collected;
      expect(messages.some((m) => m.type === 'node_started')).toBe(true);
      expect(messages.some((m) => m.type === 'node_succeeded')).toBe(true);
    } finally {
      ws.close();
    }
  });
});
