import { describe, expect, it } from 'vitest';
import { ChartValidationError, parseGgtoJson, validateChart, type ChartIssue } from '../src/index.js';
import { doc169, withPatch } from './helpers.js';

/** 텍스트를 파싱+검증하고 나온 결함 목록을 돌려준다. 통과하면 빈 배열. */
function issuesOf(text: string, opts: { strict?: boolean } = {}): ChartIssue[] {
  try {
    validateChart(parseGgtoJson(text), opts);
    return [];
  } catch (e) {
    if (e instanceof ChartValidationError) return [...e.issues];
    throw e;
  }
}

function issuesOfDoc(mutate: (d: Record<string, unknown>) => void): ChartIssue[] {
  return issuesOf(withPatch(doc169(), mutate));
}

/** nodes[i] 를 Record 로 꺼내는 헬퍼 (패치 함수 안에서만 쓴다) */
function nodeOf(d: Record<string, unknown>, i: number): Record<string, unknown> {
  return (d['nodes'] as Record<string, unknown>[])[i] as Record<string, unknown>;
}

describe('6.2 검증 — 정상 문서', () => {
  it('6.2 픽스처는 통과하고 트리가 닫혀 있어 경고도 없다', () => {
    const v = validateChart(parseGgtoJson(JSON.stringify(doc169())));
    expect(v.nodes.length).toBe(2);
    expect(v.hasEv).toBe(true);
    expect(v.warnings).toEqual([]);
    // 상태 기계가 정한 값 (파일이 주지 않는다): HU 10bb 루트는 SB, 팟 1.5
    expect(v.nodes[0]).toMatchObject({ seq: '', heroPos: 'SB', potBb: 1.5 });
    // 잼 이후 BB 차례, 팟 = 10(SB 올인) + 1(BB 블라인드)
    expect(v.nodes[1]).toMatchObject({ seq: 'A', heroPos: 'BB', potBb: 11 });
  });
});

describe('6.2 검증 실패 11종 (6.4)', () => {
  it('6.2-4 행 합이 0.98 이면 거부한다', () => {
    const issues = issuesOfDoc((d) => {
      (nodeOf(d, 0)['strategy'] as Record<string, number[]>)['AKs'] = [0.98, 0];
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('nodes[0].strategy.AKs');
    expect(issues[0]?.reason).toMatch(/sums to 0\.98/);
  });

  it('6.2-4 값이 1.2 면 거부한다 (합도 같이 깨진다)', () => {
    const issues = issuesOfDoc((d) => {
      (nodeOf(d, 0)['strategy'] as Record<string, number[]>)['AA'] = [0, 1.2];
    });
    expect(issues.some((i) => i.path === 'nodes[0].strategy.AA[1]' && /outside \[0,1\]/.test(i.reason))).toBe(true);
  });

  it('6.2-4 키가 누락되면(72o 없음) 거부한다', () => {
    const issues = issuesOfDoc((d) => {
      delete (nodeOf(d, 0)['strategy'] as Record<string, number[]>)['72o'];
    });
    expect(issues).toEqual([{ path: 'nodes[0].strategy.72o', reason: 'missing key' }]);
  });

  it('6.2-4 여분 키(AKx)는 거부한다', () => {
    const issues = issuesOfDoc((d) => {
      (nodeOf(d, 0)['strategy'] as Record<string, number[]>)['AKx'] = [1, 0];
    });
    expect(issues).toEqual([
      { path: 'nodes[0].strategy.AKx', reason: 'not a valid 169-resolution key' },
    ]);
  });

  it('6.2-3 불법 시퀀스(R2.50 — 비정규 소수)는 거부한다', () => {
    const issues = issuesOfDoc((d) => {
      nodeOf(d, 1)['seq'] = 'R2.50';
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('nodes[1].seq');
    expect(issues[0]?.reason).toMatch(/canonical/);
  });

  it('6.2-3 불법 시퀀스(HU 10bb 루트에서 R25 = 스택 초과)는 거부한다', () => {
    const issues = issuesOfDoc((d) => {
      nodeOf(d, 1)['seq'] = 'R25';
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('nodes[1].seq');
    expect(issues[0]?.reason).toMatch(/exceeds stack/);
  });

  it('6.2-3 actions 에 합법 아닌 토큰(루트에서 X)이 있으면 거부한다', () => {
    const issues = issuesOfDoc((d) => {
      nodeOf(d, 0)['actions'] = ['X', 'A'];
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('nodes[0].actions[0]');
    expect(issues[0]?.reason).toMatch(/not a legal action for "SB"/);
  });

  it('6.2-3 터미널 노드(F)는 전략을 가질 수 없다', () => {
    const issues = issuesOfDoc((d) => {
      nodeOf(d, 1)['seq'] = 'F';
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.reason).toMatch(/terminal/);
  });

  it('6.2-5 F 열의 EV 가 0 이 아니면 거부한다 (3.3 기준점 위반)', () => {
    const issues = issuesOfDoc((d) => {
      (nodeOf(d, 0)['ev'] as Record<string, number[]>)['AA'] = [-0.5, 2];
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('nodes[0].ev.AA[0]');
    expect(issues[0]?.reason).toMatch(/fold EV must be exactly 0/);
  });

  it('6.2-1 source.name 이 빈 문자열이면 거부한다', () => {
    const issues = issuesOfDoc((d) => {
      (d['source'] as Record<string, unknown>)['name'] = '';
    });
    expect(issues).toEqual([{ path: 'source.name', reason: 'must not be empty' }]);
  });

  it('6.2-1 알 수 없는 최상위 필드는 거부한다 (오타가 조용히 무시되면 안 된다)', () => {
    const issues = issuesOfDoc((d) => {
      d['resolutoin'] = '169';
    });
    expect(issues).toEqual([{ path: '$.resolutoin', reason: 'unknown field' }]);
  });

  it('6.2-1 version 이 1 이 아니면 거부한다', () => {
    expect(issuesOfDoc((d) => { d['version'] = 2; })[0]?.path).toBe('version');
  });

  it('6.2-7 루트 노드가 없으면 거부한다', () => {
    const issues = issuesOfDoc((d) => {
      d['nodes'] = [(d['nodes'] as unknown[])[1]];
    });
    expect(issues.some((i) => i.reason.includes('root node'))).toBe(true);
  });

  it('6.2-3 seq 가 중복이면 거부한다', () => {
    const issues = issuesOfDoc((d) => {
      nodeOf(d, 1)['seq'] = '';
    });
    expect(issues.some((i) => i.reason.includes('duplicate action sequence'))).toBe(true);
  });

  it('6.2-5 일부 노드에만 ev 가 있으면 거부한다', () => {
    const issues = issuesOfDoc((d) => {
      delete nodeOf(d, 1)['ev'];
    });
    expect(issues.some((i) => /ev is present on 1 of 2 nodes/.test(i.reason))).toBe(true);
  });
});

describe('6.2 결함은 전부 모여서 한 번에 온다', () => {
  it('6.2 결함 2개짜리 파일은 에러 2개를 준다 (첫 에러에서 멈추지 않는다)', () => {
    const issues = issuesOfDoc((d) => {
      (nodeOf(d, 0)['strategy'] as Record<string, number[]>)['AKs'] = [0.98, 0];
      (nodeOf(d, 1)['strategy'] as Record<string, number[]>)['72o'] = [0.5, 0.7];
    });
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.path).sort()).toEqual([
      'nodes[0].strategy.AKs',
      'nodes[1].strategy.72o',
    ]);
  });

  it('6.2 구조 결함 2개도 함께 온다', () => {
    const issues = issuesOfDoc((d) => {
      d['junk'] = 1;
      (d['source'] as Record<string, unknown>)['name'] = '';
    });
    expect(issues.map((i) => i.path).sort()).toEqual(['$.junk', 'source.name']);
  });
});

describe('6.2-6 트리 폐쇄성은 경고다', () => {
  it('6.2-6 비터미널 자식이 없으면 warnings 에 들어가고 --strict 면 거부', () => {
    const text = withPatch(doc169(), (d) => {
      d['nodes'] = [(d['nodes'] as unknown[])[0]];
    });
    const v = validateChart(parseGgtoJson(text));
    expect(v.warnings).toHaveLength(1);
    expect(v.warnings[0]?.reason).toMatch(/child node "A" is missing/);
    expect(issuesOf(text, { strict: true }).some((i) => /child node "A" is missing/.test(i.reason))).toBe(true);
  });
});
