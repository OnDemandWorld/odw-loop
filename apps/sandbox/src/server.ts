/**
 * Loop Sandbox server — isolated code execution for Python/TypeScript (§2.3).
 *
 * This is a stub entry point. Full sandbox implementation requires gVisor/Firecracker
 * and is a developer task (§SEC-004).
 */

import Fastify from 'fastify';
import { createLogger } from '@loop/observability';

const logger = createLogger({ name: 'loop:sandbox', component: 'sandbox' });

const app = Fastify({ logger: false });

app.get('/health', async () => ({ status: 'ok' }));

app.post('/execute', async (request) => {
  const body = request.body as {
    language: 'python' | 'javascript';
    code: string;
    input: Record<string, unknown>;
    timeout_ms?: number;
    memory_mb?: number;
  };

  // Stub: in production, this dispatches to a gVisor/Firecracker container
  logger.info({ language: body.language, timeout_ms: body.timeout_ms }, 'Code execution requested');

  return {
    output: {},
    stdout: '',
    stderr: '',
    duration_ms: 0,
    status: 'stub',
  };
});

const port = parseInt(process.env['LOOP_SANDBOX_PORT'] ?? '4000', 10);
app.listen({ port, host: '0.0.0.0' }).then(() => {
  logger.info({ port }, 'Sandbox server started (stub)');
}).catch((err) => {
  logger.fatal({ error: String(err) }, 'Sandbox server failed');
  process.exit(1);
});
