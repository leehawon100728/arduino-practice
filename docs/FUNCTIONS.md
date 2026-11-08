# 함수 정리

회로 편집기/시뮬레이터 핵심 로직에 있는 함수들을 파일별로 정리했다. 각 함수가 "무엇을 하는지"만 적었고, 구현 세부사항은 코드를 보면 된다.

## src/sim/geometry.ts — 좌표계 (브레드보드 구멍 ↔ 화면 좌표, 아두이노 핀)

| 함수 | 기능 |
|---|---|
| `holeXY(col, y)` | 구멍의 격자 좌표(col, y) → 화면 픽셀 좌표(x, y) |
| `isHoleRow(y)` | 그 가로줄(y)에 구멍이 있는 줄인지 (레일/단자줄/중앙 홈 판별) |
| `isHole(col, y)` | (col, y)가 실제로 존재하는 구멍인지 |
| `holeNode(col, y)` | 구멍이 속한 내부 전기 노드 이름 (같은 노드면 브레드보드 안에서 이미 연결됨) |
| `holeId(col, y)` | 구멍의 고유 id 문자열 (`H:col:y`) 생성 |
| `holeName(col, y)` | 구멍을 사람이 읽을 이름으로 (`a3`, `위 +레일 5` 등) |
| `nearestHole(x, y, maxDist?)` | 화면 좌표에서 가장 가까운 구멍 찾기 (너무 멀면 null) |
| `buildPins()` | 아두이노 UNO의 모든 핀 정의(위치/라벨/PWM 여부 등) 생성 |
| `pointXY(pointId)` | 포인트 id(`H:..` 또는 `P:..`) → 화면 좌표 |
| `pointNode(pointId)` | 포인트 id → 전기 노드 이름 |
| `pointName(pointId)` | 포인트 id → 사람이 읽을 이름 |
| `pinNumberToNode(pin)` | 핀 번호(0~19) → 노드 이름(`D7`, `A0` 등) |
| `nodeToPinNumber(node)` | 노드 이름 → 핀 번호 |

## src/sim/parts.ts — 부품 정의, 배치 규칙, 넷리스트(전기적 연결 그룹)

| 함수/클래스 | 기능 |
|---|---|
| `isLed(kind)` | 이 부품 종류가 LED인지 |
| `isResistor(kind)` | 이 부품 종류가 저항인지 |
| `emptyCircuit()` | 부품/선이 하나도 없는 빈 회로 생성 |
| `rotate(dx, dy, rot)` | 로컬 오프셋(dx, dy)을 회전값(rot, 90°×n)만큼 돌린 결과 |
| `legHoles(part)` | 부품의 각 다리가 실제로 꽂힌 구멍 좌표 목록 (구부린 다리는 구부린 위치 사용) |
| `canPlaceLeg(c, partId, legId, col, y)` | 다리 하나를 그 구멍으로 옮겨도 되는지 (빈 구멍인지) |
| `canPlace(c, part, ignoreId?)` | 부품을 그 위치/회전으로 놓을 수 있는지 (다리가 전부 빈 구멍에 들어가는지) |
| `occupiedHoles(c, ignorePartId?, ignoreWireId?)` | 지금 부품 다리나 점퍼선이 차지하고 있는 구멍 전체 집합 |
| `Netlist` (class) | 회로를 union-find로 묶어 "전기적으로 같은 지점(노드)"들을 계산 |
| `Netlist.find(x)` | x가 속한 그룹의 대표 노드 찾기 (경로 압축) |
| `Netlist.union(a, b)` | 두 노드를 같은 그룹으로 합치기 (GND/5V/핀이 대표가 되도록 우선순위 적용) |
| `Netlist.same(a, b)` | 두 노드가 같은 그룹(=전기적으로 연결됨)인지 |
| `Netlist.net(partId, legId)` | 부품의 특정 다리가 속한 노드 찾기 |

## src/sim/solver.ts — 회로 해석기 (전압/전류 계산)

| 함수 | 기능 |
|---|---|
| `cdsOhms(light)` | 조도(%) → CDS(가변저항) 저항값 변환 (밝을수록 저항 작음) |
| `solveCircuit(input)` | 회로 전체를 풀어서 각 노드 전압, LED 켜짐 여부/전류, 센서 모듈 전원 상태, 핀 전류, 쇼트/플로팅 여부를 계산 (LED·모듈 출력은 안정될 때까지 반복 계산) |
| `linearSolve(gnd, gs, srcs, currents, extraNodes)` | 저항망(컨덕턴스)·전압원·전류원으로 이루어진 연립방정식을 가우스 소거법으로 풀어 각 노드 전압 계산, 전원에 안 닿는 "플로팅" 노드도 찾아냄 |

## src/sim/modelCircuit.ts — 모범 배선(정답 회로) 자동 생성

| 함수 | 기능 |
|---|---|
| `buildModelCircuit(spec)` | 선택된 센서/LED/버튼 구성에 맞춰 모범 배선(부품 배치 + 점퍼선)을 자동으로 만들어줌 |

## src/sim/board.ts

| 함수 | 기능 |
|---|---|
| `defaultValues()` | 센서 입력값(조도, 모션 감지 등)의 기본값 모음 생성 |

## src/components/circuit/CircuitEditor.tsx — 회로 편집기 UI (드래그/배선/삭제 등 모든 상호작용)

| 함수 | 기능 |
|---|---|
| `legPosFor(part)` | 부품의 각 다리를 부품 로컬 좌표로 변환 (구부린 다리는 본체에서 멀어진 위치로, 그림을 그릴 때 씀) |
| `wirePath(a, b)` | 두 점을 잇는 점퍼선의 살짝 처진 곡선 SVG path 생성 |
| `maxLegBend(kind)` | 부품 종류별로 다리를 구부려 꽂을 수 있는 최대 거리 (저항은 무제한, LED는 2~3칸) |
| `toSvg(clientX, clientY)` | 화면(브라우저) 좌표를 SVG 내부 좌표로 변환 |
| `hitTolerance()` | 화면에 실제로 그려지는 축소 비율에 맞춰 터치 인식 허용 오차를 계산 (작은 화면에서도 손가락 터치가 잘 먹도록) |
| `pointAt(x, y)` | SVG 좌표에서 그 자리에 있는 핀/구멍의 id를 찾음 |
| `flash(msg)` | 화면 하단에 안내 메시지를 잠깐 띄움 |
| `clickPoint(pid)` | 구멍/핀을 클릭했을 때: 선 잇기 시작/완료, 또는 이미 꽂힌 선을 떼어내고 다시 잇기 |
| `commitDrag(drag)` | 드래그로 옮기던 부품을 실제로 그 위치에 놓음 (안 되면 안내 메시지) |
| `autoPlace(kind, rot)` | 부품을 빈 자리에 자동으로 찾아 꽂음 (트레이에서 그냥 클릭했을 때) |
| `beginDrag(kind, clientX, clientY, rot)` *(외부 공개 API)* | 부품 트레이 등 바깥에서 "이 부품을 여기서부터 드래그 시작"을 트리거 |
| `startPartDrag(e, part)` | 브레드보드 위의 부품을 눌렀을 때 드래그를 시작 (버튼은 실행 중이면 누르는 동작으로 처리) |
| `startLegDrag(e, part, legId)` | 부품의 다리 하나를 구부리기 위해 드래그를 시작 |
| `removeSel()` | 선택된 부품/점퍼선 삭제 (부품을 지우면 그 다리에 꽂혀 있던 점퍼선도 같이 삭제) |
| `rotateSel()` | 선택된 부품을 90°씩 돌려봄 (놓을 수 있는 각도를 찾을 때까지) |
| `moveSel(dc, dy)` | 선택된 부품을 방향키로 한 칸(혹은 다음 구멍 줄까지) 이동 |
| `onKey(e)` | 키보드 입력 처리 (Esc 취소, Delete 삭제, R 회전, 방향키 이동) |
| `onSvgPointerMove(e)` | 포인터가 움직일 때 커서 위치/호버 중인 구멍-핀 갱신 |
| `onSvgPointerUp(e)` | 포인터를 뗐을 때 그 지점의 구멍/핀을 클릭 처리 |
| `PartBounds({ kind })` | 선택된 부품 주위에 점선 테두리를 그려줌 |

## src/components/circuit/PartGraphic.tsx — 부품 모양을 그리는 SVG

| 함수 | 기능 |
|---|---|
| `legXY(kind, legId, legPos?)` | 부품의 특정 다리가 그려질 로컬 좌표 (구부려졌으면 그 위치, 아니면 기본 위치) |
| `Legs({ kind, legPos })` | 부품의 다리 끝(접점)들을 작은 원으로 그림 |
| `Module({ kind, w, label, state, children })` | VCC/GND가 있는 센서 모듈의 공통 틀(파란 박스 + 라벨 + 전원 LED)을 그림 |
| `PartGraphic({ kind, state, legPos })` | 부품 종류(kind)에 맞는 실제 그림을 그림 (LED, 저항, 버튼, 각 센서 모듈 등 분기) |

## src/components/circuit/PartIcon.tsx — 부품 트레이용 작은 아이콘

| 함수 | 기능 |
|---|---|
| `LedIcon({ kind })` | LED의 작은 아이콘 그림 |
| `ResistorIcon({ kind })` | 저항의 작은 아이콘 그림 (세로가 기본 방향 — 실제 배치 rot=0과 동일) |
| `PartIcon({ kind })` | 부품 종류에 맞는 아이콘 컴포넌트를 골라 보여줌 |

## src/components/practice/PartsTray.tsx — 부품 트레이(카드 그리드) UI

| 함수 | 기능 |
|---|---|
| `toggleRot(kind)` | 그 부품 카드의 미리보기 방향(가로/세로)을 전환 |
| `item(kind, label, icon, highlight?)` | 부품 카드 하나(아이콘+라벨+방향전환 버튼)를 렌더링 |
| `PartsTray({ sensors, editor })` | 전체 부품 트레이(센서 카드 + 공통 부품 카드 + "다른 센서" 접은 목록)를 렌더링 |
