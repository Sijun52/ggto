/**
 * P5.md 7절 — 프론트의 프리셋 표가 서버의 것과 같은가 (드리프트 게이트).
 *
 * `web/src` 는 `@ggto/solver` 를 import 할 수 없으므로 (2절) 표를 복사했다. 복사본은
 * 반드시 대조해야 한다 — 서버가 `standard` 의 사이즈를 바꾸면 목록이 **조용히** 그 솔브를
 * "커스텀" 으로 부르고, 탐색기는 표기 모드로 열지 못하게 된다.
 *
 * **테스트는** `@ggto/solver` 를 import 해도 된다 (node 에서 돈다). `web/src` 만 금지다.
 */

import { describe, expect, it } from 'vitest';
import { SIZING_PRESETS as SERVER_PRESETS } from '@ggto/solver';
import { PRESET_NAMES, SIZING_PRESETS, presetNameOf } from '../src/lib/sizingPresets';

describe('P5 7 사이징 프리셋 표', () => {
  it('P5 7 프론트 표 == 서버 표 (이름·사이즈 전부)', () => {
    expect(Object.keys(SIZING_PRESETS).sort()).toEqual(Object.keys(SERVER_PRESETS).sort());
    for (const name of PRESET_NAMES) {
      expect(SIZING_PRESETS[name], name).toEqual(SERVER_PRESETS[name]);
    }
  });

  it('P5 7 목록 행의 JSON 에서 프리셋 이름을 되찾는다', () => {
    for (const name of PRESET_NAMES) {
      // 서버는 정규화된 객체를 `JSON.stringify` 해서 행에 넣는다.
      expect(presetNameOf(JSON.stringify(SERVER_PRESETS[name])), name).toBe(name);
    }
  });

  it('P5 1.1 프리셋이 아니면 null 이다 (= 커스텀, 정규 모드로만 연다)', () => {
    const custom = {
      flop: { bet: '20%,40%,60%,80%', raise: '2x' },
      turn: { bet: '20%', raise: '2x' },
      river: { bet: '20%', raise: '2x' },
    };
    expect(presetNameOf(JSON.stringify(custom))).toBeNull();
    expect(presetNameOf('{not json')).toBeNull();
    expect(presetNameOf('null')).toBeNull();
  });

  it('P5 7 사이즈 순서·공백이 달라도 같은 프리셋으로 읽는다 (서버 정규화 규칙)', () => {
    const shuffled = {
      flop: { bet: '75%, 33%', raise: '2.5x' },
      turn: { bet: '75%', raise: '2.5x' },
      river: { bet: '75%', raise: '2.5x' },
    };
    expect(presetNameOf(JSON.stringify(shuffled))).toBe('simple');
  });
});
