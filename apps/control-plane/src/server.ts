/**
 * Loop Control Plane server — multi-instance management (Scale tier only).
 * Stub entry point.
 */

import Fastify from 'fastify';
import { createLogger } from '@loop/observability';

const logger = createLogger({ name: 'loop:control-plane', component: 'control-plane' });

const app = Fastify({ logger: false });

app.get('/health', async () => ({ status: 'ok' }));
app.get('/api/v1/fleet', async () => ({ instances: [] }));

const port = parseInt(process.env['LOOP_CONTROL_PLANE_PORT'] ?? '3001', 10);
app.listen({ port, host: '0.0.0.0' }).then(() => {
  logger.info({ port }, 'Control plane started (stub)');
}).catch((err) => {
  logger.fatal({ error: String(err) }, 'Control plane failed');
  process.exit(1);
});
