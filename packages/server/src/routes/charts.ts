/**
 * /api/charts/*. P2.md 8.
 *
 * 저장소는 주입받는다 (SQL 은 이 패키지에 없다 — 2절 grep 게이트).
 * `seq` 는 쿼리 문자열이므로 `decodeURIComponent` 로 직접 읽는다: Hono 의 `c.req.query()`
 * 는 form-urlencoded 규칙이라 리터럴 `+` 를 공백으로 바꾼다 (D13). 프리플랍 문법에 `+` 는
 * 없지만 같은 함정을 두 번 밟지 않으려고 규칙을 통일한다.
 */

import { parseActionSequence } from '@ggto/core';
import { MissingNodeError, type ChartRepository, type ChartSetMeta, type NodeData } from '@ggto/preflop';
import type {
  ChartDetailResponse,
  ChartListResponse,
  ChartNodeResponse,
  ChartRangeResponse,
  ChartSetDto,
} from '@ggto/protocol';
import { Hono } from 'hono';
import { HttpError, badRequest, missingNode, notFound } from '../errors.js';

// 프로토콜 DTO 와 저장소 타입이 갈라지면 여기서 타입체크가 깨진다 (프로토콜에 core 를
// import 하지 않기로 한 대가를 컴파일 타임에 치른다).
type _AssertSetAssignable = ChartSetMeta extends ChartSetDto ? true : never;
const _assertSetAssignable: _AssertSetAssignable = true;
void _assertSetAssignable;

/**
 * 쿼리 문자열에서 키 하나를 읽는다. 첫 번째 값이 이긴다 (P1.md 4.1 과 같은 규칙).
 *
 * 깨진 퍼센트 시퀀스(`?seq=%zz`)는 `decodeURIComponent` 가 `URIError` 를 던진다. 그것은
 * 사용자 입력 결함이므로 400 이다 (P2.md 8 R2) — 그냥 흘려보내면 500 Internal + 스택 로그가 된다.
 * 웹의 `urlParam` 은 같은 경우에 null(기본값 사용)을 주지만, API 는 조용히 다른 노드를 보여
 * 주는 것보다 거절하는 편이 낫다.
 */
export function queryParam(url: string, key: string): string | null {
  const qIndex = url.indexOf('?');
  if (qIndex < 0) return null;
  const hash = url.indexOf('#', qIndex);
  const query = url.slice(qIndex + 1, hash < 0 ? undefined : hash);
  for (const part of query.split('&')) {
    const eq = part.indexOf('=');
    if (eq === -1 || part.slice(0, eq) !== key) continue;
    const raw = part.slice(eq + 1);
    try {
      return decodeURIComponent(raw);
    } catch (e) {
      // URIError 만 입력 결함이다. 그 외 예외는 삼키지 않는다.
      if (e instanceof URIError) {
        throw badRequest(`query parameter ${JSON.stringify(key)} is not valid percent-encoding: ${JSON.stringify(raw)}`);
      }
      throw e;
    }
  }
  return null;
}

function toRows(rows: readonly Float32Array[]): number[][] {
  return rows.map((r) => Array.from(r));
}

/**
 * seq 형식 검증. 저장소 조회는 문자열 일치라 문법이 틀려도 "없는 노드"(404)가 되어 버린다 —
 * 오타와 부분 트리를 구분해 주려면 여기서 한 번 파싱해야 한다 (P2.md 8: 파싱 실패 → 400).
 */
function assertSeqSyntax(seq: string): void {
  if (seq === '') return;
  parseActionSequence(seq); // ActionSyntaxError → errors.ts 가 400 으로 매핑
}

/**
 * `?seq=R10` 류 (풀스택 레이즈를 `R<stack>` 으로 쓴 것) 는 문법은 맞지만 차트에 절대 없다:
 * 임포터는 D10 에 따라 올인을 `A` 로만 기록한다. 결과가 404 인 것은 맞지만 "없다" 보다
 * "`A` 로 쓰라" 가 사용자에게 훨씬 쓸모 있다 (P2 R1 MINOR 8).
 */
function allInHint(seq: string, stack: number): string {
  if (seq === '') return '';
  for (const token of seq.split('-')) {
    if (token[0] !== 'R' && token[0] !== 'B') continue;
    const amount = Number(token.slice(1));
    if (Number.isFinite(amount) && amount >= stack) {
      return ` — ${JSON.stringify(token)} is a full-stack raise (stack ${String(stack)}bb); use "A" for all-in (D10)`;
    }
  }
  return '';
}

/** 404 MissingNode + (있으면) 올인 표기 힌트. */
function missingNodeWithHint(seq: string, stack: number): HttpError {
  const hint = allInHint(seq, stack);
  if (hint === '') return missingNode(seq);
  return new HttpError(404, 'MissingNode', `no chart node for action sequence ${JSON.stringify(seq)}${hint}`);
}

function parseId(raw: string | undefined): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) throw badRequest(`chart set id must be a positive integer, got ${JSON.stringify(raw)}`);
  return id;
}

export function chartRoutes(repo: ChartRepository | null): Hono {
  const app = new Hono();

  app.get('/charts', (c) => {
    // 저장소가 없다 = 아직 시드하지 않았다. 빈 목록이지 장애가 아니다 (P2.md 8).
    const body: ChartListResponse = { sets: repo === null ? [] : repo.listSets() };
    return c.json(body);
  });

  app.get('/charts/:id', (c) => {
    const id = parseId(c.req.param('id'));
    const set = repo === null ? null : repo.getSet(id);
    if (set === null) throw notFound(`no chart set with id ${String(id)}`);
    const body: ChartDetailResponse = { ...set, nodes: repo?.listNodes(id) ?? [] };
    return c.json(body);
  });

  app.get('/charts/:id/node', (c) => {
    const id = parseId(c.req.param('id'));
    const set = repo === null ? null : repo.getSet(id);
    if (set === null || repo === null) throw notFound(`no chart set with id ${String(id)}`);
    const seq = queryParam(c.req.url, 'seq') ?? '';
    assertSeqSyntax(seq);
    const node: NodeData | null = repo.getNode(id, seq);
    if (node === null) throw missingNodeWithHint(seq, set.config.stack);
    const body: ChartNodeResponse = {
      seq: node.seq,
      heroPos: node.heroPos,
      potBb: node.potBb,
      actions: node.actions,
      hasEv: node.hasEv,
      strategy: toRows(node.strategy),
      ev: node.ev === null ? null : toRows(node.ev),
      reach: Array.from(repo.reach(id, seq, node.heroPos)),
    };
    return c.json(body);
  });

  app.get('/charts/:id/range', (c) => {
    const id = parseId(c.req.param('id'));
    const set = repo === null ? null : repo.getSet(id);
    if (set === null || repo === null) throw notFound(`no chart set with id ${String(id)}`);
    const seq = queryParam(c.req.url, 'seq') ?? '';
    assertSeqSyntax(seq);
    const pos = queryParam(c.req.url, 'pos');
    if (pos === null) throw badRequest('query parameter "pos" is required');
    try {
      const body: ChartRangeResponse = { pos, seq, weights: Array.from(repo.reach(id, seq, pos)) };
      return c.json(body);
    } catch (e) {
      // 경로 노드가 없으면 저장소가 MissingNodeError 를 던진다. 같은 힌트를 붙여 준다.
      if (e instanceof MissingNodeError) throw missingNodeWithHint(seq, set.config.stack);
      throw e;
    }
  });

  return app;
}
