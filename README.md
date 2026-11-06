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
  types.ts              데이터 스키마 (센서, 카드, 문제, 진행 기록)
  data/
    sensors.ts          센서 7종: 핀, 모범답안 조각, 힌트, 실수, 가상 센서 컨트롤
    cards.ts            추가 요구 카드 9장 (자동 검사 규칙 포함)
    difficulty.ts       난이도 3단계 설정
    templates.ts        기본기 모드 템플릿
  sim/                  회로 시뮬레이터
    geometry.ts         브레드보드(a~j, 전원 레일, 중앙 홈) / UNO 핀 좌표
    parts.ts            부품 다리 정의, 회로 모델, 넷리스트(union-find)
    solver.ts           절점 해석: 저항·CDS 전압 분배, LED 순방향 전압, 풀업/풀다운, 모듈 전원
    board.ts            가상 아두이노 (pinMode/digitalRead/pulseIn/DHT…), 과전류·LED 파손·플로팅 경고
    modelCircuit.ts     모범 배선 자동 생성
  interp/               Arduino C++ 부분집합 해석기
    lexer.ts            토큰화 + #include/#define 전처리
    parser.ts           구문 분석 (한국어 문법 오류)
    compiler.ts         의미 분석 + 클로저 컴파일, 내장 함수, DHT11.h / DHT.h 모의 구현
    types.ts            AVR 자료형 규칙 (int 16비트, 정수 나눗셈, 오버플로)
  grading/              채점기
    harness.ts          센서 값을 바꿔 가며 실행하고 LED/시리얼 출력 측정
    grade.ts            배선 40 + 코드 30 + 동작 30, 카드 규칙 검사
  lib/
    problem.ts          문제 생성 (시드 난수, 핀 충돌 해결, 카드 선택, 문제 문장)
    solution.ts         모범답안 자동 합성 (단독 7 + 조합 21 + 카드별 변형)
    useSimulation.ts    실시간 실행 (requestAnimationFrame, 가상 시간)
    storage.ts          진행 기록, 약점 가중치
  components/circuit    브레드보드 편집기 (드래그&드롭, 점퍼선, 회전, 키보드 조작)
  pages/                화면
```

## 동작 원리 요약

- **해석기**: 코드를 AST 로 바꾼 뒤 클로저로 컴파일합니다. `delay()` 와 사용자 함수가 있는 부분만 제너레이터로 만들어서,
  실행 중에도 화면이 멈추지 않고 실제 시간에 맞춰(▶ 시작) 또는 아주 빠르게(채점) 돌릴 수 있습니다.
  무한 루프는 프레임당 실행 단계 제한과 30분 실행 제한으로 막습니다.
- **회로**: 같은 열(a~e / f~j), 전원 레일, 점퍼선을 union-find 로 묶어 넷을 만들고, 저항·CDS·LED·풀업을
  절점 해석으로 풀어 핀 전압을 계산합니다. 그래서 버튼을 중앙 홈을 넘겨 꽂지 않거나, CDS 저항이 없거나,
  LED 극성이 반대인 경우가 실제처럼 동작하지 않습니다.
- **CDS 기준**: 모범 배선은 5V ─ 10kΩ ─ A0 ─ CDS ─ GND 로, 어두울수록 analogRead 값이 커집니다.
  반대로 연결해도 동작하면 감점하지 않고 참고 메시지만 보여 줍니다.
- **동작 채점**: 문제의 모범 배선 위에서 학생 코드를 실행하고 센서 값을 격자로 바꿔 가며 LED 출력이
  센서 A/B 각각에 반응하는지 봅니다. 임계값은 채점하지 않고, 범위를 벗어난 임계값은 이유를 알려 줍니다.

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
- `rules` 는 `src/types.ts` 의 `CardRule` 종류를 조합합니다. 새 종류가 필요하면 `CardRule` 에 추가하고
  `src/grading/grade.ts` 의 `checkRule` 에 검사 로직을, `src/lib/solution.ts` 의 `composeSolution` 에 모범답안 생성을 추가합니다.
- `npm test` 의 "추가 요구 카드별 예시 코드" 테스트가 카드가 붙을 수 있는 모든 조합에서 모범답안이 만점인지 확인합니다.
  모범답안을 만들 수 없는 조합이면 `conflictsWith` 에 서로 추가하세요.

센서를 추가할 때는 `src/lib/solution.ts` 의 `SOLUTION_EXTRAS` 에 조건 변수 이름(`condName`)과,
연속값 센서라면 3단계 기준(`levels`), 밝기 변환(`pwm`), 자동 보정(`calibration`)도 넣어 주세요.

## 개발 진행 상황

- [x] 1단계: 프로젝트 세팅, 라우팅, 화면 뼈대, 데이터 스키마
- [x] 2단계: 브레드보드 + UNO SVG, 부품 배치, 점퍼선, 넷리스트
- [x] 3단계: Arduino 부분집합 해석기, 가상 센서, LED/Serial 출력
- [x] 4단계: 센서 7종 단독 연습 (채점, 힌트, 모범답안)
- [x] 5단계: 조합 모범답안 합성(21개), 난이도, 추가 요구 카드
- [x] 6단계: 실전 모드, 기본기 모드, 약점 복습, 진행 기록, UI 다듬기

## 테스트

`npm test` 가 확인하는 것:
- 21개 조합 × 3단계 × 40개 시드에서 핀 충돌 없음, D0/D1 미사용, 카드 제약 준수
- 해석기: 16비트 int, 정수 나눗셈, 함수/배열/참조, #define, millis, 한국어 오류 메시지
- 회로: CDS 방향, 버튼 풀다운/풀업, 초음파 거리, DHT11 라이브러리, 저항 없는 LED 파손, 플로팅 경고
- **모범답안 전부 만점**: 단독 7개, 조합 21개(Lv1/2/3), OR·DHT.h·풀업·라인 A0 변형, 카드 9장 × 적용 가능한 모든 조합,
  실전 Lv3 랜덤 출제
- 채점기가 틀린 답(센서 미반영, 범위 밖 임계값, 문법 오류, Echo 미연결, LED 저항 없음)을 잡아내는지
