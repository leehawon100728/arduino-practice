import type { Difficulty, DifficultyDef } from '../types'

export const DIFFICULTIES: Record<Difficulty, DifficultyDef> = {
  1: {
    level: 1,
    name: 'Lv1 연습',
    tagline: '센서 2개 + LED 1개, 조건 자유. 배선 가이드와 힌트를 열어볼 수 있어요.',
    ledCount: 1,
    showWiringGuide: true,
    allowHints: true,
    hintPenalty: 0,
    cardCount: [0, 0],
    requireSerial: false,
    randomPins: false,
    examMinutes: 40,
  },
  2: {
    level: 2,
    name: 'Lv2 시험 수준',
    tagline: '배선 가이드 없음, 힌트는 감점. 두 센서 값을 시리얼 모니터로 출력해야 해요.',
    ledCount: 1,
    showWiringGuide: false,
    allowHints: true,
    hintPenalty: 3,
    cardCount: [0, 1],
    requireSerial: true,
    randomPins: false,
    examMinutes: 40,
  },
  3: {
    level: 3,
    name: 'Lv3 지옥 모드',
    tagline: 'LED 2개 + 추가 요구 카드 1~2장, 힌트 없음, 30분. 핀 번호가 기본과 다를 수 있어요.',
    ledCount: 2,
    showWiringGuide: false,
    allowHints: false,
    hintPenalty: 0,
    cardCount: [1, 2],
    requireSerial: true,
    randomPins: true,
    examMinutes: 30,
  },
}

/** 실전 모드는 선택한 난이도 위에 카드 0~2장을 붙인다 (Lv3 는 1~2장 유지) */
export const EXAM_CARD_COUNT: Record<Difficulty, [number, number]> = {
  1: [0, 2],
  2: [0, 2],
  3: [1, 2],
}
