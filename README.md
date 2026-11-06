# 아두이노 수행평가 연습 (팅커캐드 스타일)

고등학교 "사물인터넷과 센서제어" 수행평가 대비용 웹 서비스입니다. 센서 7종 중 2개를 브레드보드에 조립하고, 하나의 스케치로 두 센서 값을 읽어 LED 로 출력하는 연습을 합니다. 백엔드 없는 SPA 이며 진행 기록은 브라우저 localStorage 에 저장됩니다.

## 실행

```bash
npm install
npm run dev      # 개발 서버 (http://localhost:5173)
npm test         # vitest
npm run build    # 정적 빌드 → dist/ (어디에 올려도 동작: HashRouter + base './')
```

## 기술 스택

- React 19 + Vite + TypeScript + Tailwind CSS v4
- 코드 에디터: CodeMirror 6 (`@uiw/react-codemirror`, C++ 하이라이트). Monaco 보다 가볍고 태블릿 터치 입력이 안정적이라 선택했습니다.
- 라우팅: React Router (HashRouter: 정적 호스팅에서 새로고침해도 404 가 나지 않음)
- 테스트: vitest

## 폴더 구조

```
src/
  types.ts            데이터 스키마 (센서, 카드, 문제, 진행 기록)
  data/
    sensors.ts        센서 7종: 핀, 모범답안 조각, 힌트, 실수, 가상 센서 컨트롤
    cards.ts          추가 요구 카드 9장
    difficulty.ts     난이도 3단계 설정
    templates.ts      기본기 모드 템플릿
  lib/
    problem.ts        문제 생성 (시드 난수, 핀 충돌 해결, 카드 선택, 문제 문장)
    storage.ts        진행 기록, 약점 가중치
    wiring.ts         배선 표
  pages/              화면
  components/practice 실습 화면 패널 (에디터, 시리얼 모니터, 센서 컨트롤 등)
  sim/ interp/ grading/   (2~5단계) 회로 시뮬레이터, 해석기, 채점기
```

## 센서 추가하는 방법

1. `src/types.ts` 의 `SensorId` 에 새 id 를 추가합니다.
2. `src/data/sensors.ts` 의 `SENSORS` 배열에 항목을 추가합니다.
   - `signals`: 아두이노에 연결되는 신호선. `defaultPin` 이 다른 센서와 겹치면 `altPins` 순서대로 자동 배정됩니다.
   - `snippet`: 모범답안 조각. `{{신호key}}` 자리에 배정된 핀 번호가 들어갑니다 (예: `{{trig}}` → `9`).
   - `controls`: 가상 센서 조작 패널. `testValues` 는 동작 검사에서 자동으로 바꿔 볼 값입니다.
   - `hints`: ① 개념 ② 의사코드 ③ 거의 정답.
3. `npm test` 로 핀 충돌·플레이스홀더 검사가 통과하는지 확인합니다.

## 추가 요구 카드 추가하는 방법

`src/data/cards.ts` 의 `CARDS` 배열에 항목을 추가합니다.

```ts
{
  id: 'my-card',            // 고유 id
  number: 10,
  title: '카드 제목',
  description: '{A:은는} ... {B:이가} ... {T:을를} ...',
  minDifficulty: 2,         // 이 난이도 이상에서만 출제
  requiresLeds: 2,          // (선택) 필요한 LED 수
  requiresPwmLed: false,    // (선택) LED 가 ~ 핀이어야 하는가
  target: 'continuous',     // (선택) 대상 센서 조건: continuous | digital | any
  conflictsWith: ['blink'], // 함께 붙으면 안 되는 카드
  rules: [{ kind: 'codeCalls', fn: 'analogWrite', where: 'loop' }],
  variants: [...],          // (선택) AND/OR 처럼 랜덤 변형
  tip: '쉬운 해결 팁',
}
```

- 문장 치환: `{A}` `{B}` = 문제의 첫째/둘째 센서, `{T}` = 카드 대상 센서, `{O}` = 대상이 아닌 센서.
  `{A:은는}` `{B:이가}` `{T:을를}` `{A:와과}` `{B:으로로}` 처럼 쓰면 받침에 맞는 조사가 붙습니다.
- `rules` 는 `src/types.ts` 의 `CardRule` 종류를 조합합니다. 새 종류가 필요하면 `CardRule` 에 추가하고 `src/grading` 에 검사 로직을 구현합니다.

## 개발 진행 상황

- [x] 1단계: 프로젝트 세팅, 라우팅, 화면 뼈대, 데이터 스키마
- [ ] 2단계: 브레드보드 + UNO SVG, 부품 배치, 점퍼선, 넷리스트
- [ ] 3단계: Arduino 부분집합 해석기, 가상 센서, LED/Serial 출력
- [ ] 4단계: 센서 7종 단독 연습 (채점, 힌트, 모범답안)
- [ ] 5단계: 조합 모범답안 합성(21개), 난이도, 추가 요구 카드
- [ ] 6단계: 실전 모드, 기본기 모드, 약점 복습, 진행 기록, UI 다듬기
