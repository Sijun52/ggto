/**
 * `npm run solve` — 서버 없이 `@ggto/solver` 의 큐·캐시를 직접 쓴다 (P4.md 10절).
 *
 * 같은 `data/solves` 를 쓰므로 CLI 로 만든 결과를 서버가 그대로 조회한다 (캐시가 진실이다).
 *
 * exit: 0 완료/캐시 · 2 설정 오류 · 3 TooLarge · 4 솔버 없음 · 130 Ctrl-C.
 */

import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = join(REPO_ROOT, 'packages/solver/dist/index.js');

const USAGE = `usage: npm run solve -- --board Ks7h2h --oop "<range>" --ip "<range>" --pot 20 --stack 80
  [--sizings simple|standard|river-heavy]   기본 simple
  [--sizings-flop "33%,75%"] [--sizings-turn ...] [--sizings-river ...]
  [--raise-flop "2.5x"] [--raise-turn ...] [--raise-river ...]
  [--target 0.5] [--max-iter 1000] [--compressed] [--yes] [--line B6.6-C] [--json]

line 문법은 core 액션 문자열이다 (D3): 액션 구분자 '-', 스트리트 구분자 '/',
카드 세그먼트는 그 스트리트에 깔린 카드 ("B6.6-C/Qc/X"). 금액 단위는 bb.`;

function parseArgs(argv) {
  const out = { flags: new Set(), values: new Map() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${JSON.stringify(a)}`);
    const key = a.slice(2);
    if (['compressed', 'yes', 'json', 'help'].includes(key)) {
      out.flags.add(key);
      continue;
    }
    const v = argv[++i];
    if (v === undefined) throw new Error(`--${key} needs a value`);
    out.values.set(key, v);
  }
  return out;
}

function need(args, key) {
  const v = args.values.get(key);
  if (v === undefined) throw new Error(`--${key} is required`);
  return v;
}

function bytesGb(n) {
  return `${(n / 1024 ** 3).toFixed(2)}GB`;
}

function progressLine(hash, p, target) {
  const bar = `${String(Math.round(p.pct * 100)).padStart(3)}%`;
  return `\r[${hash.slice(0, 8)}] iter ${String(p.iter).padStart(5)}  expl ${p.exploitabilityPct.toFixed(3)}% pot (target ${target}%)  ${bar}`;
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.flags.has('help') || process.argv.length <= 2) {
    console.log(USAGE);
    return 0;
  }
  if (!existsSync(DIST)) {
    console.error(`@ggto/solver 가 빌드되지 않았다 (${DIST}). npm run build 를 먼저.`);
    return 4;
  }
  const solverLib = await import(`file://${DIST.replace(/\\/g, '/')}`);
  const {
    JobQueue,
    PostflopSolverCli,
    SIZING_PRESETS,
    SOLVER_ID,
    SolveCache,
    SolveConfigError,
    SolverError,
    boardWithDealt,
    buildConfig,
    canonicalConfigJson,
    configHash,
    permuteLine,
    resolveBin,
    toNodeResponse,
  } = solverLib;

  // 169 라벨은 core 가 정본이다 (D14/D4 — 여기서 다시 만들면 규칙이 갈라진다).
  const { handClassName } = await import(pathToFileURL(join(REPO_ROOT, 'packages/core/dist/index.js')).href);

  const bin = resolveBin(REPO_ROOT);
  if (bin === null) {
    console.error('솔버 바이너리가 없다. `npm run build:solver` 를 먼저 (또는 GGTO_SOLVER_BIN).');
    return 4;
  }

  const presetName = args.values.get('sizings') ?? 'simple';
  const preset = SIZING_PRESETS[presetName];
  if (preset === undefined) {
    console.error(`unknown --sizings ${JSON.stringify(presetName)} (simple | standard | river-heavy)`);
    return 2;
  }
  // 커스텀 사이징은 CLI 전용이다 (P4.md 3.2) — API 는 프리셋 이름만 받는다.
  const sizings = {
    flop: {
      bet: args.values.get('sizings-flop') ?? preset.flop.bet,
      raise: args.values.get('raise-flop') ?? preset.flop.raise,
    },
    turn: {
      bet: args.values.get('sizings-turn') ?? preset.turn.bet,
      raise: args.values.get('raise-turn') ?? preset.turn.raise,
    },
    river: {
      bet: args.values.get('sizings-river') ?? preset.river.bet,
      raise: args.values.get('raise-river') ?? preset.river.raise,
    },
  };

  let cfg;
  try {
    cfg = buildConfig({
      board: need(args, 'board'),
      oop: need(args, 'oop'),
      ip: need(args, 'ip'),
      potBb: Number(need(args, 'pot')),
      stackBb: Number(need(args, 'stack')),
      sizings,
      targetExploitabilityPct: args.values.has('target') ? Number(args.values.get('target')) : undefined,
      maxIterations: args.values.has('max-iter') ? Number(args.values.get('max-iter')) : undefined,
      compressed: args.flags.has('compressed'),
    });
  } catch (e) {
    if (e instanceof SolveConfigError) {
      console.error(`설정 오류 [${e.code}] ${e.message}`);
      return 2;
    }
    console.error(String(e instanceof Error ? e.message : e));
    console.error(USAGE);
    return 2;
  }

  const hash = configHash(cfg, SOLVER_ID);
  const dataDir = process.env.GGTO_DATA_DIR ?? join(REPO_ROOT, 'data');
  const solver = new PostflopSolverCli({ bin, onLog: () => undefined });
  // 서버와 같은 훅 (P4 R1 MAJOR 3): 재솔브·삭제 전에 조회 데몬이 낡은 결과를 버린다.
  const cache = new SolveCache({
    dir: join(dataDir, 'solves'),
    onInvalidate: (h) => {
      void solver.invalidate(h).catch((e) => {
        console.error(`unload ${h} 실패: ${e instanceof Error ? e.message : String(e)}`);
      });
    },
  });
  const queue = new JobQueue({ solver });

  const canonicalBoard = cfg.board.map((c) => '23456789TJQKA'[c >> 2] + 'cdhs'[c & 3]).join('');
  console.log(`board      ${need(args, 'board')}  →  정규 ${canonicalBoard}  (perm ${JSON.stringify([...cfg.perm])})`);
  console.log(`hash       ${hash}`);
  console.log(`pot/stack  ${String(cfg.potChips / 100)}bb / ${String(cfg.stackChips / 100)}bb   sizings ${presetName}`);

  let exitCode = 0;
  try {
    const { hit } = cache.lookup(hash, cfg.targetExploitabilityPct);
    if (hit) {
      const row = cache.get(hash);
      cache.touch(hash);
      console.log(
        `cached     expl ${row.exploitability.toFixed(3)}% · ${String(row.iterations)} iter · ${String(row.bytes)} B · ${String(row.elapsedMs)}ms`,
      );
    } else {
      const est = await queue.estimateOnly(cfg);
      const estMemory = cfg.compressed ? est.memoryBytesCompressed : est.memoryBytes;
      console.log(
        `estimate   nodes ${String(est.nodes)} · memory ${bytesGb(estMemory)} (compressed ${bytesGb(est.memoryBytesCompressed)}) · ~${est.estSeconds.toFixed(1)}s`,
      );
      if (estMemory > queue.memoryCap) {
        console.error(`TooLarge: ${bytesGb(estMemory)} > 상한 ${bytesGb(queue.memoryCap)} — 사이징을 줄여라`);
        return 3;
      }
      if (!args.flags.has('yes') && !(await confirm(`${bytesGb(estMemory)} / 약 ${est.estSeconds.toFixed(0)}초 — 실행할까?`))) {
        console.log('취소했다 (--yes 로 물어보지 않게 할 수 있다)');
        return 0;
      }

      const handle = queue.submit({
        hash,
        cfg,
        estimate: est,
        outPath: cache.partPath(hash),
        onSaved: (summary) => {
          cache.evictFor(summary.bytes, queue.activeHashes());
          cache.commit({
            hash,
            // 정규 JSON 전체 (P4.md 4.1). 서버와 같은 행을 쓴다.
            configJson: canonicalConfigJson(cfg, SOLVER_ID),
            boardCanonical: canonicalBoard,
            street: cfg.board.length === 3 ? 'flop' : cfg.board.length === 4 ? 'turn' : 'river',
            potChips: cfg.potChips,
            stackChips: cfg.stackChips,
            sizings: JSON.stringify(cfg.sizings),
            compressed: cfg.compressed,
            exploitability: summary.exploitabilityPct,
            iterations: summary.iterations,
            bytes: summary.bytes,
            solver: solver.id,
            evBasis: 'stack_delta_from_node',
            elapsedMs: summary.elapsedMs,
          });
        },
      });
      const target = String(cfg.targetExploitabilityPct);
      handle.subscribe((e) => {
        if (e.progress !== undefined) process.stderr.write(progressLine(hash, e.progress, target));
      });
      const onSigint = () => {
        process.stderr.write('\n취소 중…\n');
        queue.cancel(handle.id);
        exitCode = 130;
      };
      process.on('SIGINT', onSigint);
      try {
        const summary = await handle.done();
        process.stderr.write('\n');
        console.log(
          `solved     expl ${summary.exploitabilityPct.toFixed(3)}% · ${String(summary.iterations)} iter · ${String(summary.bytes)} B · ${String(summary.elapsedMs)}ms`,
        );
      } catch (e) {
        process.stderr.write('\n');
        if (e instanceof SolverError && e.code === 'Cancelled') {
          // `.part` 가 남지 않게 한다 (P4.md 8.3).
          cache.remove(hash);
          console.error('취소됨 (.part 정리 완료)');
          return 130;
        }
        if (e instanceof SolverError && e.code === 'TooLarge') {
          console.error(`TooLarge: ${e.message}`);
          return 3;
        }
        throw e;
      } finally {
        process.off('SIGINT', onSigint);
      }
    }

    const line = args.values.get('line');
    if (line !== undefined) {
      const handleResult = await solver.openWith(hash, cache.binPath(hash), cfg.chipsPerBb);
      try {
        const node = await handleResult.node(permuteLine(line, cfg.perm));
        const res = toNodeResponse(node, cfg.perm);
        // 역순열은 슈트를 되돌리지만 **순서**는 정규 보드의 정렬 순서다. 사용자가 친 그대로
        // 보여주되 라인에서 딜된 카드는 지운다 (P4 R1 MAJOR 1).
        res.board = boardWithDealt(need(args, 'board'), res.board);
        if (args.flags.has('json')) {
          console.log(JSON.stringify(res));
        } else {
          printNodeTable(res, line, handClassName);
        }
      } finally {
        await handleResult.close();
      }
    }
  } catch (e) {
    if (e instanceof SolverError) {
      console.error(`[${e.code}] ${e.message}`);
      return e.code === 'TooLarge' ? 3 : e.code === 'SolverUnavailable' ? 4 : 1;
    }
    throw e;
  } finally {
    await solver.shutdown();
    cache.close();
  }
  return exitCode;
}

/**
 * 169 집계를 표로. 상위 20 클래스만 (도달 질량 순) — 169줄은 터미널에서 못 읽는다.
 *
 * 마지막 줄이 **3.5 의 항등식 확인**이다: 두 플레이어 평균 EV 의 합 = 그 노드의 팟.
 * 이게 깨지면 EV 기준점이 틀린 것이고, P6 트레이너 채점이 전부 틀어진다.
 */
function printNodeTable(res, requestedLine, handClassName) {
  console.log('');
  console.log(`node       line ${JSON.stringify(requestedLine)} -> ${JSON.stringify(res.line)}  (${res.street})`);
  console.log(`           board ${res.board} · pot ${String(res.potChips / 100)}bb · to act ${res.player}`);
  console.log(`           actions ${res.actions.join(' ')}  · evBasis ${res.evBasis}`);
  const reach = res.aggregate.reach[res.player === 'oop' ? 0 : 1];
  const rows = reach
    .map((mass, h) => ({ h, mass }))
    .filter((r) => r.mass > 0)
    .sort((a, b) => b.mass - a.mass)
    .slice(0, 20);
  const head = ['hand', 'reach', ...res.actions.map((a) => `${a} %`), ...res.actions.map((a) => `${a} EV`)];
  console.log(`           ${head.map((x) => String(x).padStart(9)).join('')}`);
  for (const { h, mass } of rows) {
    const cells = [
      handClassName(h),
      mass.toFixed(2),
      ...res.aggregate.strategy.map((row) => `${(row[h] * 100).toFixed(1)}%`),
      ...res.aggregate.ev.map((row) => row[h].toFixed(2)),
    ];
    console.log(`           ${cells.map((x) => String(x).padStart(9)).join('')}`);
  }
  console.log(`           (도달 질량 상위 ${String(rows.length)}개만. 전체는 --json)`);

  const [evOop, evIp] = res.evAvgBb;
  const potBb = res.potChips / 100;
  const diff = Math.abs(evOop + evIp - potBb);
  console.log('');
  console.log(
    `EV 합 확인  OOP ${evOop.toFixed(4)}bb + IP ${evIp.toFixed(4)}bb = ${(evOop + evIp).toFixed(4)}bb ` +
      `vs 팟 ${potBb.toFixed(4)}bb  (차 ${diff.toFixed(6)}bb — ${diff <= 0.01 ? 'OK' : '틀렸다'})`,
  );
}

process.exit(await main());
