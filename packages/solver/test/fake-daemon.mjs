/**
 * 프로토콜 클라이언트 테스트용 가짜 데몬 (P4.md 6절).
 *
 * 진짜 데몬과 **같은 JSON-lines** 를 말하되, 클라이언트가 다뤄야 하는 실패 모드를
 * 인자로 골라서 재현한다. Rust 없이 `npm run ci` 가 클라이언트를 검사하는 수단이다.
 *
 * node test/fake-daemon.mjs --serve [--scenario <name>]
 *   normal        : 정상 응답
 *   split         : 한 줄을 세 청크로 쪼개서 쓴다
 *   batched       : 두 응답을 한 청크에 붙여 쓴다
 *   protocol2     : hello 가 protocol 2 를 준다
 *   crash         : 첫 요청을 받으면 stderr 를 뱉고 exit 3
 *   silent        : solve 를 받으면 progress 하나만 보내고 영원히 조용하다
 *   noisy-stderr  : stderr 에 큰 덩어리를 뱉는다 (절단 검사)
 *   junk-line     : 파싱 불가 줄을 먼저 보내고 정상 응답을 이어 보낸다
 */

import { setTimeout as delay } from 'node:timers/promises';

const args = process.argv.slice(2);
const scenario = args[args.indexOf('--scenario') + 1] ?? 'normal';

function writeRaw(text) {
  process.stdout.write(text);
}

async function emit(obj) {
  const line = `${JSON.stringify(obj)}\n`;
  if (scenario === 'split') {
    // 한 줄을 세 조각으로. 클라이언트의 줄 버퍼가 없으면 여기서 깨진다.
    const a = Math.floor(line.length / 3);
    const b = Math.floor((2 * line.length) / 3);
    writeRaw(line.slice(0, a));
    await delay(5);
    writeRaw(line.slice(a, b));
    await delay(5);
    writeRaw(line.slice(b));
    return;
  }
  writeRaw(line);
}

function hello() {
  return {
    protocol: scenario === 'protocol2' ? 2 : 1,
    solver: 'fake-daemon@test',
    build: 'test',
    features: ['compressed'],
  };
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  for (;;) {
    const nl = buf.indexOf('\n');
    if (nl < 0) break;
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (line.trim() === '') continue;
    void handle(JSON.parse(line));
  }
});
process.stdin.on('end', () => {
  process.exit(0);
});

async function handle(req) {
  if (scenario === 'crash') {
    process.stderr.write('fake daemon is going down\nstack line 1\nstack line 2\n');
    process.exit(3);
  }
  if (scenario === 'noisy-stderr') {
    process.stderr.write(`${'x'.repeat(40_000)}\n`);
  }
  if (scenario === 'junk-line') {
    writeRaw('this is not json\n');
  }
  if (req.method === 'hello') {
    await emit({ id: req.id, result: hello() });
    return;
  }
  if (req.method === 'solve') {
    await emit({ method: 'progress', params: { iter: 10, exploitabilityPct: 3, pct: 0.1 } });
    if (scenario === 'silent') return; // 영원히 조용 — 클라이언트가 Stalled 로 끊어야 한다
    await emit({ method: 'progress', params: { iter: 20, exploitabilityPct: 1, pct: 0.5 } });
    await emit({ id: req.id, result: { iterations: 20, exploitabilityPct: 0.4, elapsedMs: 12, bytes: 1024 } });
    return;
  }
  if (req.method === 'cancel') {
    await emit({ id: req.id, result: { ok: true } });
    return;
  }
  if (req.method === 'boom') {
    await emit({ id: req.id, error: { code: 'NoSuchLine', message: 'no such line' } });
    return;
  }
  if (scenario === 'batched') {
    // 두 프레임을 한 청크에 붙여서 쓴다 (알림 + 응답).
    writeRaw(
      `${JSON.stringify({ method: 'progress', params: { iter: 1, exploitabilityPct: 9, pct: 0.01 } })}\n` +
        `${JSON.stringify({ id: req.id, result: { echoed: req.method } })}\n`,
    );
    return;
  }
  await emit({ id: req.id, result: { echoed: req.method, params: req.params ?? null } });
}
