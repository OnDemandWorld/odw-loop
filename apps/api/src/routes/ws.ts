/**
 * WebSocket route — real-time execution monitoring (V1.1 M2, F5).
 *
 * `GET /ws/executions/:id` subscribes the connecting client to the engine's
 * in-process EventBus for a single execution and forwards every status event
 * (node_started / node_succeeded / node_failed / node_skipped / execution_*)
 * as a JSON message. On disconnect the subscription is torn down so subscribers
 * never leak. Auth mirrors the REST API: enforced only when LOOP_REQUIRE_AUTH is
 * set, in which case the upgrade must present a valid API key / JWT (via
 * `?token=`, `Authorization: Bearer`, or `x-api-key`).
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { SqliteStateStore } from '@loop/state';
import type { EventBus, ExecutionBusEvent } from '@loop/engine';
import { createLogger } from '@loop/observability';
import type { LoopConfig } from '../config.js';
import { resolveTokenPrincipal } from '../middleware/auth.js';

const logger = createLogger({ name: 'loop:api:ws', component: 'api' });

/**
 * Minimal structural view of the underlying ws socket. @fastify/websocket types
 * the socket via the `ws` package (no bundled types here), so we describe only
 * the surface we use to keep this module strictly typed without `any`.
 */
interface RealtimeSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'close' | 'error', listener: (err?: Error) => void): void;
  readyState: number;
}

export interface WsRouteDeps {
  config: LoopConfig;
  store: SqliteStateStore;
  /**
   * The bus the executor publishes to. Required (not defaulted) so the caller
   * wires the exact same instance the executor uses — avoiding any ambiguity
   * about which singleton is shared across module boundaries.
   */
  eventBus: EventBus;
}

/** Extract a single auth token from the upgrade request (query → bearer → key). */
function presentedToken(request: FastifyRequest): string | undefined {
  const query = request.query as Record<string, unknown>;
  const q = query['token'];
  if (typeof q === 'string' && q.length > 0) return q;

  const auth = request.headers['authorization'];
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    if (token.length > 0) return token;
  }

  const key = request.headers['x-api-key'];
  if (typeof key === 'string' && key.length > 0) return key;

  return undefined;
}

/** ws `readyState` value meaning the socket is open. */
const WS_OPEN = 1;

export async function registerExecutionWebSocket(app: FastifyInstance, deps: WsRouteDeps): Promise<void> {
  const bus = deps.eventBus;

  await app.register(import('@fastify/websocket'));

  app.get('/ws/executions/:id', { websocket: true }, (connection, request) => {
    const socket = connection.socket as unknown as RealtimeSocket;
    const { id: executionId } = request.params as { id: string };

    // ── Auth (V1.0 parity): enforce only when LOOP_REQUIRE_AUTH is on ──────
    if (deps.config.LOOP_REQUIRE_AUTH) {
      // Resolve synchronously-ish: verify then either proceed or reject. The
      // subscription is only attached once auth succeeds.
      void resolveTokenPrincipal(presentedToken(request), deps.config).then((principal) => {
        if (!principal) {
          logger.warn({ executionId }, 'WS upgrade rejected — missing/invalid credentials');
          socket.close(4401, 'Unauthorized');
          return;
        }
        attach(socket, executionId);
      });
      return;
    }

    attach(socket, executionId);

    /** Subscribe to the bus and forward events until the socket closes. */
    function attach(sock: RealtimeSocket, execId: string): void {
      const unsubscribe = bus.subscribe(execId, (event: ExecutionBusEvent) => {
        if (sock.readyState !== WS_OPEN) return;
        try {
          sock.send(JSON.stringify(event));
        } catch (err) {
          logger.warn({ execId, error: String(err) }, 'Failed to send WS event');
        }
      });

      // Best-effort initial snapshot so a client joining mid-run sees prior
      // node statuses immediately (it need not wait for the next transition).
      void (async () => {
        try {
          const [execution, nodeExecs] = await Promise.all([
            deps.store.executions.getById(execId),
            deps.store.nodeExecutions.listByExecution(execId),
          ]);
          if (sock.readyState !== WS_OPEN) return;
          sock.send(
            JSON.stringify({
              type: 'snapshot',
              executionId: execId,
              status: execution?.status ?? 'pending',
              nodes: nodeExecs.map((n) => ({
                nodeId: n.node_id,
                nodeType: n.node_type,
                status: n.status,
                output: n.output,
                error: n.error,
              })),
            }),
          );
        } catch (err) {
          logger.warn({ execId, error: String(err) }, 'Failed to send WS snapshot');
        }
      })();

      // Per-connection cleanup: drop exactly this subscription on disconnect.
      sock.on('close', () => unsubscribe());
      sock.on('error', () => unsubscribe());
    }
  });
}
