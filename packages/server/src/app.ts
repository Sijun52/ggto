/**
 * 라우터 조립. 포트 바인딩은 여기 없다 (테스트가 app.request() 로 인프로세스 호출한다).
 * P1.md 3.1-3.2.
 */

import type { ChartRepository } from '@ggto/preflop';
import type { TrainerService } from '@ggto/trainer';
import { Hono } from 'hono';
import { HttpError, mapError, notFound } from './errors.js';
import { chartRoutes } from './routes/charts.js';
import { healthRoutes } from './routes/health.js';
import { rangeRoutes } from './routes/range.js';
import { trainerRoutes } from './routes/trainer.js';
import { createStaticHandler } from './static.js';
import { serverVersion } from './version.js';

export interface AppOptions {
  /** web/dist 절대 경로. null 이면 정적 경로는 전부 503 WebNotBuilt */
  webDist?: string | null;
  /** 기본값은 packages/server/package.json 의 version */
  version?: string;
  /** 500 매핑 확인용 라우트를 등록한다. 프로덕션 경로에서는 절대 켜지 않는다 */
  testRoutes?: boolean;
  /**
   * 차트 저장소 (P2). null 이면 /api/charts 는 빈 목록을 준다 — 아직 시드하지 않은 것은
   * 장애가 아니다 (P2.md 8). SQL 은 이 패키지에 없고 전부 이 인터페이스 뒤에 있다.
   */
  repo?: ChartRepository | null;
  /**
   * 트레이너 (P3). null 이면 `/api/trainer/*` 는 503 이다 — 차트와 달리 "없음 = 빈 목록"
   * 이 아니다 (세션을 만들 수 없는 것은 장애다).
   */
  trainer?: TrainerService | null;
}

export function createApp(opts: AppOptions = {}): Hono {
  const app = new Hono();
  const version = opts.version ?? serverVersion();
  const webDist = opts.webDist ?? null;

  app.onError((err, c) => {
    const mapped = mapError(err);
    if (mapped.log) console.error('[ggto] unhandled error', err);
    return c.json(mapped.body, mapped.status);
  });

  app.route('/api', healthRoutes(version));
  app.route('/api', rangeRoutes());
  app.route('/api', chartRoutes(opts.repo ?? null));
  app.route('/api', trainerRoutes(opts.trainer ?? null));

  if (opts.testRoutes === true) {
    app.get('/api/__boom', () => {
      throw new Error('boom: secret path /etc/passwd');
    });
    app.get('/api/__http-error', () => {
      throw new HttpError(418, 'Teapot', 'short and stout');
    });
  }

  // /api 아래의 미등록 경로는 SPA 폴백으로 새지 않고 404 JSON 이어야 한다.
  app.all('/api', () => {
    throw notFound('no such API route');
  });
  app.all('/api/*', () => {
    throw notFound('no such API route');
  });

  const serveStatic = createStaticHandler(webDist);
  app.get('*', serveStatic);
  app.on('HEAD', '*', serveStatic);

  app.notFound(() => {
    throw notFound('not found');
  });

  return app;
}
