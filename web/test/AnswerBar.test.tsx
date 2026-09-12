/**
 * 하단 액션 바 (P3M 4절 / 8.1).
 *
 * 검사하는 것은 **동작 계약**이다: 버튼 순서, 답 후 잠금, "다음" 의 500ms 오탭 방지,
 * 그리고 D8 (바 문구에 "정답/오답" 이 없다). 픽셀은 `check:mobile` 이 브라우저에서 잰다.
 */

import type { GradeDto } from '@ggto/protocol';
import { fireEvent, render, screen, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnswerBar, NEXT_ARM_MS } from '../src/components/AnswerBar';
import { actionColors } from '../src/lib/chartGrid';
import { bestTextOn, contrastRatio } from '../src/lib/palette';

const ACTIONS = ['F', 'A'];
const COLORS = actionColors(ACTIONS);

function gradeDto(overrides: Partial<GradeDto> = {}): GradeDto {
  return {
    gradedBy: 'ev',
    verdict: 'Perfect',
    evLossBb: 0,
    chosenAction: 'A',
    chosenFreq: 1,
    bestAction: 'A',
    bestEvBb: 1.23,
    mixed: false,
    actions: ACTIONS.map((a) => ({ action: a, freq: a === 'A' ? 1 : 0, evBb: a === 'A' ? 1.23 : 0 })),
    ...overrides,
  };
}

function renderBar(props: Partial<React.ComponentProps<typeof AnswerBar>> = {}) {
  const onAnswer = vi.fn();
  const onNext = vi.fn();
  render(
    <AnswerBar
      actions={ACTIONS}
      colors={COLORS}
      grade={null}
      pending={false}
      onAnswer={onAnswer}
      onNext={onNext}
      nextLabel="다음 →"
      {...props}
    />,
  );
  return { onAnswer, onNext };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('P3M 4 AnswerBar — 출제 중', () => {
  it('P3M 4 버튼은 노드 actions 순서 그대로이고 바를 균등 분할한다', () => {
    renderBar();
    const bar = screen.getByTestId('answer-buttons');
    const ids = [...bar.querySelectorAll('button')].map((b) => b.getAttribute('data-testid'));
    expect(ids).toEqual(['answer-F', 'answer-A']);
    for (const b of bar.querySelectorAll('button')) {
      expect(b.className).toContain('flex-1');
      expect(b.className).toContain('min-h-12');
    }
  });

  it('P3M 4 버튼 글자색은 액션 색에서 유도돼 AA 를 넘는다', () => {
    renderBar();
    for (const a of ACTIONS) {
      const btn = screen.getByTestId(`answer-${a}`) as HTMLButtonElement;
      const bg = COLORS[a] as string;
      expect(btn.style.backgroundColor).not.toBe('');
      expect(btn.style.color.toLowerCase()).toBe(bestTextOn(bg) === '#000000' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)');
      expect(contrastRatio(bestTextOn(bg), bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('P3M 4 탭하면 그 액션이 올라간다. 제출 중에는 잠긴다', () => {
    const { onAnswer } = renderBar();
    fireEvent.click(screen.getByTestId('answer-F'));
    expect(onAnswer).toHaveBeenCalledWith('F');

    renderBar({ pending: true });
    const btns = screen.getAllByTestId('answer-F') as HTMLButtonElement[];
    expect((btns[btns.length - 1] as HTMLButtonElement).disabled).toBe(true);
  });

  it('P3M 4 출제 중에는 verdict 도 "다음" 도 없다', () => {
    renderBar();
    expect(screen.queryByTestId('grade-box')).toBeNull();
    expect(screen.queryByTestId('next-spot')).toBeNull();
  });
});

describe('P3M 4 AnswerBar — 답 후', () => {
  it('P3M 4 verdict 칩 + EV loss 가 뜨고 답 버튼은 비활성이다', () => {
    renderBar({ grade: gradeDto({ verdict: 'Minor', evLossBb: 0.12 }) });
    expect(screen.getByTestId('grade-verdict').textContent).toBe('Minor');
    expect(screen.getByTestId('grade-evloss').textContent).toBe('EV loss 0.12bb');
    for (const a of ACTIONS) {
      expect((screen.getByTestId(`answer-${a}`) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('P3M 4 (오탭 방지) "다음" 은 공개 후 500ms 동안 눌리지 않는다', () => {
    vi.useFakeTimers();
    const { onNext } = renderBar({ grade: gradeDto() });

    const next = () => screen.getByTestId('next-spot') as HTMLButtonElement;
    expect(next().disabled).toBe(true);
    fireEvent.click(next());
    expect(onNext).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(NEXT_ARM_MS - 1);
    });
    expect(next().disabled).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(next().disabled).toBe(false);
    fireEvent.click(next());
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(NEXT_ARM_MS).toBe(500);
  });

  it('P3M 4 / D8 바 어디에도 "정답/오답/맞았/틀렸" 이 없다 (Blunder 에서도)', () => {
    renderBar({ grade: gradeDto({ verdict: 'Blunder', evLossBb: 3, chosenAction: 'F' }) });
    const text = document.body.textContent ?? '';
    for (const word of ['정답', '오답', '맞았', '틀렸']) expect(text).not.toContain(word);
    // 빈 화면 통과 방지: verdict 는 실제로 렌더돼 있다
    expect(text).toContain('Blunder');
  });

  it('P3M 4 고른 액션만 색이 남고 나머지는 명시 비활성 색이다 (opacity 아님)', () => {
    renderBar({ grade: gradeDto({ chosenAction: 'A' }) });
    const chosen = screen.getByTestId('answer-A') as HTMLButtonElement;
    const other = screen.getByTestId('answer-F') as HTMLButtonElement;
    expect(chosen.style.backgroundColor).not.toBe('');
    expect(other.style.backgroundColor).toBe('');
    expect(other.className).toContain('bg-[#1e293b]');
    expect(other.className).not.toContain('opacity');
  });
});
