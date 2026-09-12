/**
 * 벤치 공유 하네스 (P2.md 10절 R3). core / preflop 벤치가 이 파일 하나를 쓴다.
 *
 * 왜 부하 인지형인가 (P2 R2 리뷰 2·4절):
 * 같은 코드의 preflop getNode 가 CPU LoadPercentage 9 에서 137ms, 55~85 에서 162~186ms,
 * 90~100 에서 304~510ms 로 측정됐다. 부하가 wall-clock 을 3.7배까지 늘리므로
 * **포화 상태에서는 어떤 유한 예산도 플레이키**하다. 예산을 올리는 것은 게이트의 목적을
 * 없애므로(유휴 137ms 대비 300ms 는 이미 2.2배 여유라 2배 회귀조차 못 잡는다) 기각됐고,
 * 대신 예산 *집행* 을 부하로 조건화한다:
 *   - 정확성 check 실패 → 부하와 무관하게 exit 1
 *   - 예산 초과 → 외부 부하 <= LOAD_EXTERNAL_ENFORCE_MAX 이거나 --strict 일 때만 exit 1
 *
 * JSON 의 `ok` 와 exit 코드는 다른 것을 말한다: `ok` 는 "예산·정확성이 통과했는가" 라는
 * 사실이고 exit 코드는 "집행했는가" 의 결과다. 고부하에서 `ok:false` + exit 0 은 정상이다.
 *
 * 부하 측정에 `process.cpuUsage()` 를 쓰지 않는 이유: Windows 에서 15.6ms 스케줄러 틱으로
 * 양자화돼 같은 작업이 94/110/141ms 로 튄다 (R2 실측). `os.cpus()[i].times` 델타는
 * 전 코어·인프로세스·포터블이고 벤치 실행 구간 자체를 잰다.
 */

import os from 'node:os';

/**
 * 예산을 집행할 최대 **외부** 부하 (P2 R3 MINOR 1).
 *
 * R2 의 임계 0.60 은 벤치 자신의 기여를 포함한 측정치였다. 벤치는 단일 스레드이므로
 * 자기 기여의 상한은 정확히 `1/ncpu` 이고, 그 상수가 임계 안에 녹아 있으면 유효 외부 임계가
 * 코어 수에 따라 달라진다 (6코어 43% / 4코어 35% / 2코어 10% / 1코어 −7% = 영원히 미집행).
 * 그래서 임계를 **외부 부하** 기준으로 다시 쓴다: 0.43 = 6코어에서의 기존 0.60 과 동치.
 */
export const LOAD_EXTERNAL_ENFORCE_MAX = 0.43;

/** 벤치 자신의 기여 상한 (단일 스레드이므로 코어 하나). */
export function selfLoadShare() {
  return 1 / Math.max(1, os.cpus().length);
}

/** 이 머신에서 위 외부 임계에 해당하는 전체 부하 (사람용 줄과 하위 호환 필드에 쓴다). */
export function totalLoadThreshold() {
  return LOAD_EXTERNAL_ENFORCE_MAX + selfLoadShare();
}

/** 전 코어 times 합산. `busy` 는 idle 을 뺀 전부 (user+nice+sys+irq). */
function snapshotCpu() {
  let busy = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const t = cpu.times;
    busy += t.user + t.nice + t.sys + t.irq;
    total += t.user + t.nice + t.sys + t.irq + t.idle;
  }
  return { busy, total };
}

/**
 * 모듈 로드 시점 = 벤치 스크립트의 첫 줄. 여기서 `runCases` 종료까지가 "실행 구간" 이다.
 * 벤치 자신의 기여도 포함된다 (6코어에서 단일 스레드 벤치는 ≈17%p 를 스스로 보탠다).
 */
const SPAN_START = snapshotCpu();

/** 스냅샷 이후의 전 코어 평균 부하 (0~1). 벤치 자신의 CPU 도 포함된다. */
export function sampleLoad(from = SPAN_START) {
  const now = snapshotCpu();
  const dTotal = now.total - from.total;
  // 경과 틱이 0 이면 잴 것이 없다 = 예산을 넘길 시간도 없었다. 집행 쪽(0)으로 둔다.
  if (dTotal <= 0) return 0;
  const load = (now.busy - from.busy) / dTotal;
  return load < 0 ? 0 : load > 1 ? 1 : load;
}

/**
 * best-of-N: JIT 워밍업과 GC 노이즈를 걷어내고 하한을 본다.
 * 최솟값이 "예산 안에 들어갈 수 있는가" 라는 질문에 맞는 통계량이다 (R3: runs 3 → 5).
 */
export function measure(fn, { warmup = 2, runs = 5 } = {}) {
  for (let i = 0; i < warmup; i++) fn();
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    const ms = performance.now() - t0;
    if (ms < best) best = ms;
  }
  return best;
}

/**
 * 케이스 목록을 돌리고 JSON(stdout) + 사람용 줄(stderr) 을 찍은 뒤 exit 코드를 정한다.
 *
 * @param {{name: string, budgetMs: number, run: () => unknown, check?: (v: unknown) => true | string, warmup?: number, runs?: number}[]} cases
 * @param {{ suite: string, argv?: string[], gateNote?: string, teardown?: () => void }} opts
 */
export function runCases(cases, { suite, argv = process.argv.slice(2), gateNote, teardown } = {}) {
  const strict = argv.includes('--strict');

  const results = [];
  let wrong = 0; // 정확성 실패 — 항상 치명적
  let over = 0; // 예산 초과 — 부하에 따라 집행
  for (const c of cases) {
    let value;
    const ms = measure(
      () => {
        value = c.run();
      },
      { warmup: c.warmup, runs: c.runs },
    );
    // 결과가 틀리면 빠른 코드는 의미가 없다. 예산과 함께 정답도 검사한다.
    let correct = true;
    if (c.check) {
      const verdict = c.check(value);
      if (verdict !== true) {
        console.error(`WRONG RESULT: ${c.name}: ${String(verdict)}`);
        correct = false;
        wrong++;
      }
    }
    const withinBudget = ms < c.budgetMs;
    if (!withinBudget) over++;
    results.push({
      name: c.name,
      ms: Math.round(ms * 10) / 10,
      budgetMs: c.budgetMs,
      ok: withinBudget && correct,
      withinBudget,
      correct,
    });
  }

  if (teardown) teardown();

  // 부하는 모든 케이스가 끝난 뒤에 확정한다 (실행 구간 전체의 평균).
  const load = sampleLoad();
  // 벤치 자신의 기여(단일 스레드 = 최대 1코어)를 빼서 외부 부하만 남긴다 (P2 R3 MINOR 1).
  const loadExternal = Math.max(0, load - selfLoadShare());
  const enforced = strict || loadExternal <= LOAD_EXTERNAL_ENFORCE_MAX;
  const loadPct = Math.round(load * 100);
  const loadExternalPct = Math.round(loadExternal * 100);

  console.log(
    JSON.stringify({
      suite,
      node: process.version,
      load: Math.round(load * 1000) / 1000,
      loadExternal: Math.round(loadExternal * 1000) / 1000,
      cpus: os.cpus().length,
      // 하위 호환: 기존 `loadThreshold` 는 "전체 부하" 축의 임계였다. 이 머신에서의 동치값을 준다.
      loadThreshold: Math.round(totalLoadThreshold() * 1000) / 1000,
      loadExternalThreshold: LOAD_EXTERNAL_ENFORCE_MAX,
      enforced,
      strict,
      results,
      // `ok` 는 **사실**이다: 예산·정확성이 전부 통과했는가. 집행 여부와 무관하다.
      // 그래서 고부하에서는 `ok:false` 인데 exit 0 인 조합이 정상적으로 나온다
      // (exit 코드는 집행 결과, `ok` 는 측정 결과 — P2.md 10.7).
      ok: wrong === 0 && over === 0,
    }),
  );
  for (const r of results) {
    const tag = r.withinBudget ? 'PASS' : enforced ? 'FAIL' : `OVER (not enforced: external load ${String(loadExternalPct)}%)`;
    console.error(`${tag}  ${r.ms.toFixed(1).padStart(8)}ms / ${String(r.budgetMs).padStart(5)}ms  ${r.name}`);
  }
  console.error(
    `load ${String(loadPct)}% (self <= ${String(Math.round(selfLoadShare() * 100))}%, ` +
      `external ${String(loadExternalPct)}%, enforce external <= ${String(Math.round(LOAD_EXTERNAL_ENFORCE_MAX * 100))}%)` +
      `  budgets ${enforced ? 'ENFORCED' : 'NOT ENFORCED'}${strict ? ' (--strict)' : ''}`,
  );
  // 게이트의 실제 민감도를 매 실행 로그에 남긴다 — "왜 회귀를 못 잡았나" 를 나중에 묻지 않도록.
  if (gateNote) console.error(gateNote);

  if (wrong > 0) {
    console.error(`${String(wrong)} correctness failure(s) — always fatal`);
    process.exit(1);
  }
  if (over > 0 && enforced) {
    console.error(`${String(over)} budget failure(s)`);
    process.exit(1);
  }
  if (over > 0) {
    console.error(
      `${String(over)} budget overage(s) not enforced at external load ${String(loadExternalPct)}% — rerun with --strict on an idle machine`,
    );
  }
}
