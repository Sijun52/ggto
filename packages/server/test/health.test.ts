import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('3.4 GET /api/health', () => {
  it('3.4 health → 200, ok:true, node === process.version', async () => {
    const app = createApp();
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; version: string; node: string };
    expect(body.ok).toBe(true);
    expect(body.node).toBe(process.version);
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
