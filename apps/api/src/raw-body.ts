/**
 * Raw-body capture for byte-exact webhook HMAC verification (tsd §11.6).
 *
 * Fastify v4's content-type parser receives a wrapper object whose `.raw` is
 * the Node IncomingMessage the route handler sees as `request.raw` — attaching
 * the buffer to the wrapper itself is invisible to handlers (found via a live
 * probe: the previous attach left `request.raw.rawBody` undefined and every
 * non-canonical JSON signature failed). Both the API server and the
 * integration test helper must register THIS parser so tests exercise the same
 * byte-exact path as production.
 */
import type { FastifyInstance } from 'fastify';

export function attachRawBodyParser(app: Pick<FastifyInstance, 'addContentTypeParser'>): void {
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    // The parser's first arg is typed as the raw IncomingMessage but is
    // actually the Fastify request wrapper at runtime; `.raw` exists on the
    // wrapper, so cover both shapes.
    const wrapper = req as { raw?: { rawBody?: Buffer }; rawBody?: Buffer };
    const target = wrapper.raw ?? wrapper;
    target.rawBody = body as Buffer;
    const text = (body as Buffer).toString('utf8');
    if (text.length === 0) {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch (err) {
      (err as { statusCode?: number }).statusCode = 400;
      done(err as Error, undefined);
    }
  });
}
