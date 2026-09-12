import type { HealthResponse } from '@ggto/protocol';
import { Hono } from 'hono';

export function healthRoutes(version: string): Hono {
  const app = new Hono();
  app.get('/health', (c) => {
    const body: HealthResponse = { ok: true, version, node: process.version };
    return c.json(body);
  });
  return app;
}
