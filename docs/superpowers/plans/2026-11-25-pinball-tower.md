# 핀볼 새 판 "다락방 타워" 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 핀볼 판을 400×1300으로 키우고, 장치를 33개로 늘리고, 램프로 올라가 레일로 내려오는 2층 다락을 넣는다.

**Architecture:** 판 배치(자료)와 엔진(물리·규칙), 화면 따라가기, 그리기를 서로 다른 파일로 나눈다. 2층 다락은 같은 평면의 닫힌 방이고, 겹치는 건 정해진 길을 따라가는 레일과 킥백뿐이다. 화면은 400×700 범위만 보여 주고 공을 따라 세로로 움직인다.

**Tech Stack:** TypeScript, React 19, Canvas 2D, `node --test` (Node 24의 TS 실행), Vite.

**Spec:** `docs/superpowers/specs/2026-11-25-pinball-tower-design.md` — 좌표 초안(5.2), 점수표(5.4), 화면 따라가기(5.5), 균형 기준(6.2)은 그 문서가 정본이다.

## Global Constraints

- 누르는 플리퍼는 아래 두 개뿐이다. 위쪽이나 2층에 조작하는 플리퍼를 넣지 않는다.
- 서버는 바꾸지 않는다. `MAX_SCORE = 5_000_000`, `MAX_COINS_PER_RUN = 400`은 `src/pinball/engine.ts`에서 계속 내보낸다 (`test/parity.test.ts`).
- 엔진·판 자료·화면 따라가기는 DOM 없는 순수 TS다. 테스트가 읽는 파일의 상대 import에는 `.ts` 확장자를 쓴다.
- 그림은 한 칸 = 판 좌표 3, 정수 칸 `fillRect`만 쓴다. 색은 스킨의 11가지와 공 색 2가지만 쓴다.
- 캔버스 글자는 12px 이상. 큰 알림 문구는 해요체로 짧게.
- '동작 줄이기'면 흔들림·번쩍임을 끈다. 화면이 공을 따라가는 것은 유지한다.
- 주석과 테스트 이름은 지금 코드처럼 한국어로 쓴다.
- 커밋은 `pinball-tower` 브랜치에만 한다. 푸시와 배포는 사용자 확인 뒤에 한다.
- 매 작업의 끝 확인: `npm test` 통과, `npx tsc -b` 통과, `npm run lint`에서 새 경고 없음 (지금 경고 2개는 예전부터 있던 것).

## Review Focus

1. 탭이 뒤로 갔다 돌아와 프레임 간격이 아주 길 때 — 공이 벽을 뚫거나 화면이 튀지 않아야 한다. (Task 2: 긴 dt 테스트)
2. 멀티볼에서 한 공은 레일 위, 한 공은 아래로 빠질 때 — 공을 잃은 것으로 세지 않고, 남은 공으로 판이 이어져야 한다. (Task 6)
3. 공이 다락이나 구멍, 레일 위에 있는 채로 일시정지·다시 시작·나가기 — 점수와 코인이 한 번만 저장되고 새 판이 깨끗해야 한다. (Task 7: 새 엔진으로 다시 시작하는 지금 방식 유지 확인)
4. 점수가 상한에 닿은 뒤의 보상(다락 잭팟, 뽑기 코인) — 점수·코인이 상한을 넘지 않아야 한다. (Task 5, Task 4)
5. 스킨 6종 모두에서 다락·램프·레일이 바닥과 구별돼 보여야 한다. (Task 7: 스킨별 화면 확인)

---

## 파일 구조

| 파일 | 맡는 일 |
|---|---|
| `src/pinball/rules.ts` (새로) | 점수·개수·시간 상수. 엔진과 화면이 함께 읽는다 |
| `src/pinball/table.ts` (새로) | 판 배치 자료: 크기, 벽, 장치 좌표, 램프·다락 다각형, 레일·킥백 길, 동전 구역 |
| `src/pinball/path.ts` (새로) | 정해진 길: 부드럽게 만들기, 길이, 거리 → 위치·방향 |
| `src/pinball/camera.ts` (새로) | 화면 따라가기 (따라갈 공, 목표 위치, 한 프레임 이동) |
| `src/pinball/engine.ts` (고침) | 물리와 규칙. 판 자료는 `table.ts`에서 읽는다 |
| `src/pinball/pixel.ts` (고침) | 보이는 범위 칸 수와 판 전체 칸 수 |
| `src/pinball/render.ts` (고침) | 그리기. 미리 그려 두는 두 장(바닥·벽 / 다락·램프·레일) |
| `src/pinball/fx.ts`, `src/arcade/fx.ts` (고침) | 새 사건 연출, 화면이 움직인 만큼 글자 옮기기 |
| `src/pages/Pinball.tsx` (고침) | 화면 따라가기 상태, 새 사건의 소리·진동 |
| `src/game/sfx.ts` (고침) | 새 소리 |
| `test/pinball/helpers.ts` (새로) | 난수, 공 놓기, 시간 돌리기, 봇 |
| `test/pinball/*.test.ts` (새로) | 작업별 테스트 |

---

### Task 1: 지금 규칙을 테스트로 고정하고 상수·판 자료를 떼어 낸다

판을 바꾸기 전에, 남겨야 하는 규칙을 테스트로 잡아 둔다. 동작은 바꾸지 않는다.

**Files:**
- Create: `src/pinball/rules.ts`, `src/pinball/table.ts`, `test/pinball/helpers.ts`, `test/pinball/rules.test.ts`
- Modify: `src/pinball/engine.ts`, `src/pinball/render.ts`

**Interfaces:**
- Produces (`rules.ts`): `BALL_R`, `BALLS_PER_GAME`, `COIN_PICKUP_VALUE`, `MAX_COINS_PER_RUN`, `MAX_MULTIPLIER`, `MAX_SCORE`, `BALL_SAVE_TIME`, `POINTS`, `MILESTONES` — 값은 지금 `engine.ts`와 같다.
- Produces (`table.ts`): 지금 `engine.ts`의 `TABLE_W`, `TABLE_H`, `LANE_X`, `RIGHT_X`, `WALLS`, `GATE`, `LANE_POSTS`, `SAUCER`, `PLUNGER_TOP`, `PULL_DISTANCE`과 장치 좌표를 만드는 함수들. 타입 `Point`, `Wall`.
- Produces (`engine.ts`): 위 이름을 그대로 다시 내보낸다 (`export * from './rules.ts'` 등). `makeBall(partial: Partial<Ball> & { x: number; y: number }): Ball`.
- Produces (`helpers.ts`): `seeded(seed: number): () => number`, `engineWith(gear?): PinballEngine` (난수 고정), `placeBall(e, ball)`, `run(e, seconds, dt = 1/120): PinballEvent[]`, `runUntil(e, pred, maxSeconds): PinballEvent[]`.

- [ ] **Step 1: 테스트를 쓴다** (`test/pinball/rules.test.ts`). 각각 지금 엔진에서 통과해야 한다.
  - `위쪽 레인을 다 켜면 배율이 오르고 3,000점을 받는다` — 레인 위치에 공을 차례로 놓아 `lanes` 사건과 `multiplier === 2` 확인.
  - `플리퍼를 누르면 켜진 레인 불이 옆으로 옮겨 간다`
  - `드롭 타깃을 다 쓰러뜨리면 잠금 불이 켜지고, 구멍에 넣으면 멀티볼이 된다` — `bank`, `multiball` 사건, `isMultiball`.
  - `멀티볼 중에 구멍에 넣으면 잭팟 20,000 × 2를 받는다`
  - `발사 뒤 8초 안에 잃은 공은 한 번 돌려준다` — `ballSaved`, `ballsLeft` 그대로.
  - `공 3개를 다 잃으면 판이 끝난다` — `gameOver`, `over === true`.
  - `점수는 상한을 넘지 않는다` — `e.score = MAX_SCORE - 50` 뒤 범퍼에 맞혀 `score === MAX_SCORE`.
  - `한 판 코인은 400개를 넘지 않는다`
  - `점수 구간을 넘으면 코인을 받는다` — 10,000점에서 `milestone` 사건, 코인 10.
- [ ] **Step 2:** `npm test` — 새 테스트가 통과하는지 본다 (동작을 고정하는 테스트라 처음부터 통과한다. 실패하면 테스트가 틀린 것이다).
- [ ] **Step 3:** 상수를 `rules.ts`로, 배치를 `table.ts`로 옮기고 `engine.ts`·`render.ts`의 import를 고친다.
- [ ] **Step 4:** `npm test && npx tsc -b && npm run lint` 통과. 브라우저에서 핀볼 화면이 전과 같은지 한 번 본다.
- [ ] **Step 5:** 커밋 `핀볼: 지금 규칙을 테스트로 고정하고 상수·판 자료를 떼어 냄`.

---

### Task 2: 긴 판과 화면 따라가기

판을 1300으로 늘리고 아래쪽을 안쪽·바깥 길로 나눈다. 장치는 지금 종류만 새 자리에 놓는다 (위쪽 레인 4개, 범퍼 5개, 드롭 타깃, 잠금 구멍). 바깥 길로 들어간 공은 그대로 잃는다 (킥백은 Task 3).

**Files:**
- Create: `src/pinball/camera.ts`, `test/pinball/camera.test.ts`, `test/pinball/launch.test.ts`, `test/pinball/soak.test.ts`
- Modify: `src/pinball/table.ts`, `engine.ts`, `pixel.ts`, `render.ts`, `fx.ts`, `src/arcade/fx.ts`, `src/pages/Pinball.tsx`, `test/pinball/rules.test.ts`, `test/pinball/helpers.ts`

**Interfaces:**
- Produces (`table.ts`): `TABLE_H = 1300`, `VIEW_W = 400`, `VIEW_H = 700`, `FLIPPER_Y = 1204`, 스펙 5.2의 바깥 벽·발사 레인·위쪽 레인 4개·범퍼 5개·드롭 타깃·잠금 구멍·슬링샷·플리퍼·나눔벽·지붕 가이드. `COIN_ZONES: { x: number; y: number; w: number; h: number }[]`. `LAUNCH_MIN = 1225`, `LAUNCH_MAX = 1680`. 엔진의 `MAX_SPEED = 1700`.
- Produces (`camera.ts`):
  - `focusBall<T extends { y: number; level: 0 | 1; held: number; ride: unknown }>(balls: T[]): T | null` — 공이 하나면 그 공. 여럿이면 1층(`level 0`, 레일 아님) 공 중 `y`가 가장 큰 공, 없으면 `y`가 가장 큰 공.
  - `cameraTarget(ball: { y: number; vy: number } | null): number` — `ball`이 없으면 `TABLE_H - VIEW_H`. 있으면 `clamp(y - 350 + clamp(vy * 0.22, -140, 220), 0, TABLE_H - VIEW_H)`.
  - `stepCamera(cam: number, target: number, ballY: number | null, dt: number): number` — `dt`는 0.05로 자른다. `cam += (target - cam) * (1 - exp(-10 * dt))`. 공이 `cam + 60` 위나 `cam + VIEW_H - 80` 아래로 나가면 그만큼 바로 따라붙는다. 결과는 0~600.
  - `snapCamera(cam: number): number` — 3의 배수로 반올림.
- Produces (`engine.ts`): `Ball`에 `level: 0 | 1` (지금은 늘 0), `ride: null`(Task 3에서 채움). 동전은 `COIN_ZONES` 안에서만 생긴다.
- Produces (`pixel.ts`): `LOW_W = ceil(VIEW_W / P)`, `LOW_H = ceil(VIEW_H / P)`, `FULL_H = ceil(TABLE_H / P)`.
- Produces (`render.ts`): `drawTable(ctx, engine, theme, fx, cameraY: number)`.
- Produces (`arcade/fx.ts`): `drawText(ctx, width, height, offsetY = 0)` — 점수 팝업만 `offsetY`만큼 위로 옮긴다. 큰 알림은 화면 가운데 그대로. `drawOver`의 번쩍임은 변환을 잠깐 풀고 캔버스 전체에 칠한다.
- Produces (`helpers.ts`): `randomBot(seed)`, `reactiveBot(seed)` (스펙 6.2의 정의), `playGame(e, bot, maxSeconds): { score: number; coins: number; seconds: number; over: boolean; losses: { center: number; left: number; right: number } }`. 공을 잃은 곳은 `drain` 사건의 `x`로 나눈다 (`drain` 사건에 `x: number`를 더한다).

- [ ] **Step 1: 화면 따라가기 테스트** (`camera.test.ts`)
  - `공이 하나면 그 공을 따라간다`, `여럿이면 1층에서 가장 아래 공을 따라간다`, `1층에 공이 없으면 가장 아래 공을 따라간다`
  - `공이 없으면 맨 아래를 본다` — `cameraTarget(null) === 600`
  - `공이 판 아래쪽에 있으면 화면은 맨 아래에 붙는다` — `cameraTarget({ y: 1000, vy: 0 }) === 600`
  - `범위를 벗어나지 않는다` — `y: 20`이면 0, `y: 1290`이면 600
  - `곧장 떨어지는 가장 빠른 공도 0.2초 전에는 플리퍼가 보인다` — `y0 ∈ {150, 400, 700}`, `vy0 ∈ {0, 800, 1700}`에서 중력 900으로 떨어뜨리며 `stepCamera`를 돌려, 공이 `y ≥ 1170`에 닿는 시각에서 `cam + 700 ≥ 1240`이 된 시각을 뺀 값이 0.2 이상.
  - `프레임 간격이 아주 길어도 범위 안에 있다` — `dt = 5`.
- [ ] **Step 2:** `node --test test/pinball/camera.test.ts` — 실패 확인 (모듈 없음).
- [ ] **Step 3:** `camera.ts`를 쓴다. 통과 확인.
- [ ] **Step 4: 발사와 판 테스트** (`launch.test.ts`)
  - `끝까지 당겨 쏘면 레인을 빠져나가 판에 들어간다` — 3초 안에 `gateClosed === true`, 공 `x < LANE_X`.
  - `40%만 당겨도 레인을 빠져나간다`
  - `아주 약하게 쏘면 발사대로 돌아온다` — `launch(0)` 뒤 `plungerLoaded === true`, `ballsLeft === 3`.
  - `바깥 길로 들어간 공은 잃는다` — 왼쪽 바깥 길 안 `(22, 1060)`에 공을 놓으면 `drain`.
  - `벽을 타고 내려온 공은 지붕 가이드를 따라 안쪽 길로 간다` — `(20, 900)`에 멈춘 공을 놓으면 왼쪽 플리퍼 근처(`x` 100~170, `y` > 1150)에 닿고 `drain`이 나지 않는다 (2초 안, 플리퍼는 쉬는 상태로 공이 굴러 지나가기 전까지).
  - `프레임 간격이 아주 길어도 공이 판 밖으로 나가지 않는다` — `step(5)`를 여러 번.
- [ ] **Step 5:** `rules.test.ts`의 좌표를 새 판에 맞게 고친다 (`table.ts`의 값을 읽어 쓰게 한다).
- [ ] **Step 6:** `table.ts`·`engine.ts`를 새 판으로 고친다. 통과 확인.
- [ ] **Step 7: 무작위 플레이 테스트** (`soak.test.ts`) — `randomBot`으로 20판, `reactiveBot`으로 5판(판마다 최대 600초). NaN 없음, 공이 `x < 0`, `x > 400`, `y < 0`로 나가지 않음, 5초 넘게 속도 15 아래로 멈춘 공 없음(구멍에 붙잡힌 공과 눌린 플리퍼 위 공은 뺀다).
- [ ] **Step 8:** `pixel.ts`, `render.ts`, `fx.ts`, `arcade/fx.ts`, `Pinball.tsx`를 고친다. 낮은 해상도 캔버스는 보이는 범위 크기로 두고, 미리 그린 판 전체 바닥에서 `cameraY`만큼 잘라 붙인 뒤 세로로 밀어 장치를 그린다. `Pinball.tsx`는 `useCanvasLoop(stageRef, canvasRef, VIEW_W, VIEW_H, …)`와 `cameraRef`를 쓴다. 바닥 표시등과 `lanes` 사건의 고리 위치는 엔진 값에서 읽는다. 은하수 별은 판 전체 높이에 뿌린다. 화면 밖 공은 위쪽 가장자리에 작은 표시를 그린다.
- [ ] **Step 9:** `npm test && npx tsc -b && npm run lint`. 브라우저에서 한 판 한다: 발사하면 화면이 따라 올라가고, 공이 내려오면 플리퍼가 보이고, 바깥 길로 공을 잃을 수 있다.
- [ ] **Step 10:** 커밋 `핀볼: 판을 400×1300으로 늘리고 화면이 공을 따라가게 함`.

---

### Task 3: 정해진 길, 킥백, 오른쪽 타깃

**Files:**
- Create: `src/pinball/path.ts`, `test/pinball/path.test.ts`, `test/pinball/kickback.test.ts`
- Modify: `rules.ts`, `table.ts`, `engine.ts`, `render.ts`, `fx.ts`

**Interfaces:**
- Produces (`path.ts`): `interface Track { points: Point[]; cum: number[]; length: number }`, `makeTrack(points: Point[], smoothing = 2): Track` (모서리를 깎아 부드럽게, 양 끝점은 그대로), `trackAt(track: Track, s: number): { x: number; y: number; tx: number; ty: number }` (`s`는 0~`length`로 자른다).
- Produces (`table.ts`): `KICKBACK = { sensor: { x: 10, y: 1224, w: 26, h: 80 }, track: Track, speed: 900, release: { vx: 240, vy: -420 } }` — 길은 `(22,1230) (22,1045) (36,1010) (58,985)`. `STANDUPS: { x: 344, y1: number, y2: number }[]` (스펙 5.2).
- Produces (`rules.ts`): `POINTS.standup = 300`, `POINTS.standupBank = 2000`.
- Produces (`engine.ts`):
  - `Ball.ride: { track: 'kick' | 'rail'; s: number; v: number } | null`. 길 위의 공은 충돌 계산을 건너뛰고, 다른 공과도 부딪히지 않는다. 같은 길의 뒤 공은 앞 공보다 `2 * BALL_R` 넘게 다가가지 못한다.
  - `kickbackLit: boolean` — 판 시작과 공을 새로 받을 때 `true`.
  - `standups: { x: number; y1: number; y2: number; lit: boolean; flash: number }[]`. 꺼진 타깃을 세게(충돌 속도 40 이상) 맞히면 켜지고 300점. 셋이 다 켜지면 2,000점과 `kickbackLit = true`, 1초 뒤 모두 꺼진다. 켜진 타깃을 또 맞히면 튕기기만 한다.
  - 사건: `{ type: 'kickback'; x: number; y: number }`, `{ type: 'standup'; x: number; y: number; points: number }`, `{ type: 'standupBank'; points: number; relit: boolean }` (`relit`은 꺼져 있던 킥백이 켜졌을 때 `true`).
  - 타깃이 켜질 때는 콤보에 넣는다. `combo` 사건에 마지막으로 맞힌 곳 `x`, `y`를 더해서 팝업을 그 자리에 띄운다.

- [ ] **Step 1: 길 테스트** — `길이는 점 사이 거리의 합이다`(직선), `거리 0과 끝은 양 끝점이다`, `방향은 단위 벡터다`, `범위를 벗어난 거리는 양 끝으로 자른다`.
- [ ] **Step 2: 킥백 테스트**
  - `킥백이 켜져 있으면 왼쪽 바깥 길의 공을 살리고 꺼진다` — `(22, 1235)`에 공. `kickback` 사건, 2초 안에 공이 `x > 40`, `y < 1010`에 있고 `drain` 없음, `kickbackLit === false`.
  - `킥백이 꺼져 있으면 공을 잃는다`
  - `오른쪽 바깥 길에는 킥백이 없다` — `(338, 1235)`에 공을 놓으면 `drain`.
  - `공을 새로 받으면 킥백이 다시 켜진다`
  - `오른쪽 타깃 셋을 다 맞히면 2,000점을 받고 킥백이 다시 켜진다` — 한 타깃을 두 번 맞혀도 300점은 한 번.
  - `길 위의 공은 다른 공과 부딪히지 않는다`
- [ ] **Step 3:** 실패 확인 → 구현 → 통과 확인.
- [ ] **Step 4:** 그리기: 킥백(켜지면 밝게), 오른쪽 타깃(켜진 불), 길 위의 공. 연출: `kickback`은 큰 알림 "킥백!", 타깃은 지금 드롭 타깃과 같은 파편.
- [ ] **Step 5:** `npm test && npx tsc -b && npm run lint`, 커밋 `핀볼: 킥백과 오른쪽 타깃`.

---

### Task 4: 돌아가는 길과 스피너, 뽑기 구멍

**Files:**
- Create: `test/pinball/orbit.test.ts`
- Modify: `rules.ts`, `table.ts`, `engine.ts`, `render.ts`, `fx.ts`, `test/pinball/rules.test.ts`

**Interfaces:**
- Produces (`table.ts`): 돌아가는 길 안쪽 벽 `(48,772)-(48,340)`. `SPINNER = { x: 29, y: 744, half: 17 }`. `SAUCERS = { lock: {…}, mystery: { x: 150, y: 726, r: 12, catchR: 11, hold: 0.9 } }` — 각 구멍에 뱉는 속도 `eject(random): { vx: number; vy: number }`.
- Produces (`rules.ts`): `POINTS.spinner = 100`, `POINTS.mysterySmall = 3000`, `POINTS.mysteryBig = 10000`, `MYSTERY_COINS = 10`, `MYSTERY = [['small', 40], ['big', 20], ['coins', 20], ['save', 10], ['lock', 10]] as const`.
- Produces (`engine.ts`):
  - `Ball.heldBy: 'lock' | 'mystery' | 'attic' | null`. 구멍마다 한 번에 공 하나. `saucers: Record<SaucerId, { flash: number; cooldown: number }>`.
  - `spinner: { angle: number; speed: number; pending: number; flash: number }`. 공이 스피너 선을 지나면 `pending += clamp(round(|vy| / 180), 1, 8)`. 0.06초마다 한 번씩 `pending`을 줄이며 100점. 콤보에는 넣지 않는다.
  - 뽑기: `random()`으로 `MYSTERY`에서 무게대로 고른다. `save`는 `saveTimer = BALL_SAVE_TIME; saveUsed = false`, `lock`은 `lockLit = true`, `coins`는 상한 안에서 10개(능력 영향 없음).
  - 사건: `{ type: 'spinner'; x; y; points }`, `{ type: 'mystery'; x; y; award: 'small' | 'big' | 'coins' | 'save' | 'lock'; points: number; coins: number }`.
  - 구멍에 들어가는 것은 지금처럼 콤보에 넣는다.

- [ ] **Step 1: 테스트**
  - `스피너를 빠르게 지나가면 여러 번 돌고, 한 번에 100점씩 받는다` — `vy = -900`이면 5번.
  - `스피너는 콤보에 들어가지 않는다`
  - `뽑기 구멍은 난수에 따라 보상을 준다` — 난수를 0.1 / 0.5 / 0.7 / 0.85 / 0.95로 고정하면 차례로 `small` / `big` / `coins` / `save` / `lock`.
  - `뽑기 코인은 한 판 상한을 넘지 않는다` — `coinsEarned = 395`에서 5개만.
  - `뽑기 구멍에 공이 있어도 잠금 구멍은 따로 받는다`
  - `구멍이 뱉은 공은 곧장 가운데로 떨어지지 않는다` — 세 구멍 모두, 뱉은 뒤 1초 동안 공이 `y < 1150`에 있다 (다락 구멍은 Task 5에서 더한다).
- [ ] **Step 2:** 실패 확인 → 구현 → 통과 확인. `soak.test.ts`도 다시 돌린다.
- [ ] **Step 3:** 그리기: 스피너(도는 동안 판 폭이 변함), 뽑기 구멍(노란 테), 길 표시 화살표. 연출: 뽑기 결과 큰 알림 ("뽑기! 10,000점", "뽑기! 코인 +10", "뽑기! 공 살리기", "뽑기! 잠금 불").
- [ ] **Step 4:** `npm test && npx tsc -b && npm run lint`, 커밋 `핀볼: 돌아가는 길과 스피너, 뽑기 구멍`.

---

### Task 5: 램프와 2층 다락

**Files:**
- Create: `test/pinball/attic.test.ts`
- Modify: `rules.ts`, `table.ts`, `engine.ts`, `render.ts`, `fx.ts`

**Interfaces:**
- Produces (`table.ts`):
  - `ATTIC = { polygon: Point[], mouth: [Point, Point], exit: [Point, Point] }` — 스펙 5.2의 테두리. 테두리 벽은 `WALLS`에 넣는다 (입구와 출구는 뚫어 둔다).
  - `RAMP = { center: Point[], width: 36, polygon: Point[], down: Point, pull: number }` — 가운데 선의 끝은 다락 입구 가운데, 난간의 끝은 입구 양 끝. 입구는 깔때기로 벌린다(바깥쪽 폭 60 안팎). `down`은 꼭대기 → 입구 방향 단위 벡터.
  - 다락 장치: `ATTIC_TARGETS`, `ATTIC_BUMPERS`(반지름 13), `ATTIC_KICKER`(슬링샷과 같은 모양), `SAUCERS.attic`.
- Produces (`rules.ts`): `POINTS.ramp = 2000`, `POINTS.atticBumper = 200`, `POINTS.kicker = 50`, `POINTS.atticTarget = 1000`, `POINTS.atticHole = 2000`, `POINTS.atticJackpot = 25000`, `RAMP_COMBO_WINDOW = 12`, `MAX_RAMP_COMBO = 5`, `ATTIC_MAX_STAY = 20`.
- Produces (`engine.ts`):
  - `Ball.level`은 위치로 정한다: 공 중심이 다락 다각형 안이면 1, 아니면 0 (길 위에서는 타기 전 값을 유지).
  - 램프 다각형 안의 1층 공에는 `RAMP.down` 방향으로 `RAMP.pull`만큼 가속을 더한다.
  - 다락 입구 선은 2층 공에게만 벽이다.
  - 0 → 1로 바뀔 때: `rampCombo`는 앞선 성공이 12초 안이면 +1(최대 5), 아니면 1. `2000 × rampCombo`점. 사건 `{ type: 'ramp'; x; y; points; combo }`.
  - 범퍼·슬링샷에 `level` 표시를 둬서 2층 범퍼는 200점, 키커는 50점.
  - `atticTargets: { x1; x2; y; lit; flash }[]` — 켜질 때 1,000점. 셋이 다 켜지면 `jackpotLit = true`, 1초 뒤 타깃 불이 꺼진다. 사건 `atticTarget`, `{ type: 'jackpotLit' }`.
  - 다락 구멍: `jackpotLit`이면 25,000점과 `jackpotLit = false`, 아니면 2,000점. 사건 `{ type: 'atticHole'; x; y; points; jackpot: boolean }`.
  - `Ball.atticTime` — 2층에 있는 동안 늘고, 20초를 넘으면 출구 바로 아래 `(133, 622)`로 옮기고 아래로 내보낸다 (Task 6에서 레일 타기로 바뀐다).
  - 2층 범퍼, 키커, 2층 타깃(켜질 때), 다락 구멍은 콤보에 넣는다.
  - 동전은 다락·램프 안에 생기지 않는다 (`COIN_ZONES`가 겹치면 그 자리는 버린다).
  - 이 작업에서는 출구로 나온 공이 그냥 1층으로 떨어진다.

- [ ] **Step 1: 테스트**
  - `램프 입구에 빠르게 들어온 공은 2층에 올라가고 2,000점을 받는다` — 입구 가운데에서 가운데 선 방향으로 속도 1,100. 2초 안에 `ramp` 사건, `level === 1`.
  - `느린 공은 램프를 되굴러 나온다` — 속도 400. `ramp` 사건 없음, 공이 입구 아래로 나옴.
  - `12초 안에 또 올리면 점수가 2배, 3배가 되고 5배에서 멈춘다`
  - `2층 공은 램프로 되돌아 내려가지 않는다` — 다락 안에서 입구 쪽으로 속도 600으로 굴려도 `level`이 1로 남는다.
  - `1층 공은 다락 벽을 뚫고 들어가지 못한다` — 다락 바깥 여러 방향에서 속도 1,500으로 쏴도 `level === 0`.
  - `2층 타깃 셋을 맞히면 잭팟 불이 켜지고, 구멍에 넣으면 25,000점을 받는다`
  - `불이 꺼진 구멍은 2,000점을 준다`
  - `2층 범퍼는 200점, 자동 키커는 50점을 준다`
  - `2층에 20초 넘게 있으면 출구로 나온다`
  - `점수 상한에 닿은 뒤의 다락 잭팟은 점수를 넘기지 않는다`
  - `왼쪽 플리퍼에 얹힌 공을 제때 치면 램프에 올라간다` — 공을 왼쪽 안쪽 길에서 굴려 플리퍼에 얹고, 누르는 시각을 0.01초 간격으로 바꿔 가며 돌렸을 때 `ramp` 사건이 나는 시각의 폭이 0.04초 이상.
- [ ] **Step 2:** 실패 확인 → 구현. 마지막 테스트가 통과할 때까지 램프 입구 모양·방향과 `RAMP.pull`을 다듬는다. `soak.test.ts`도 통과.
- [ ] **Step 3:** 그리기: 두 번째로 미리 그려 두는 장(다락 바닥과 테두리·그림자, 램프와 화살표 무늬). 순서는 1층 장치 → 1층 공 → 이 장 → 2층 장치 → 램프 위·2층 공. 잭팟 불은 깜빡인다. 연출: "2층!", "램프 ×2", "잭팟 준비!", "다락 잭팟!".
- [ ] **Step 4:** `npm test && npx tsc -b && npm run lint`. 브라우저에서 램프에 올려 본다. 커밋 `핀볼: 램프와 2층 다락`.

---

### Task 6: 내려오는 레일

**Files:**
- Create: `test/pinball/rail.test.ts`
- Modify: `table.ts`, `engine.ts`, `render.ts`, `fx.ts`

**Interfaces:**
- Produces (`table.ts`): `RAIL = { track: Track, startSpeed: 180, maxSpeed: 620, accel: 700, release: { vx: 0, vy: 200 } }` — 길은 스펙 5.2의 레일.
- Produces (`engine.ts`): 2층 공이 출구 틈을 지나 다락 밖으로 나오면 `ride = { track: 'rail', s: 0, v: startSpeed }`. 길 위에서는 `v += accel * ty * h` (아래로 향할수록 빨라짐), `startSpeed`~`maxSpeed`로 자른다. 끝에서 `level = 0`, 놓는 속도 적용. 20초 넘은 공도 레일을 탄다. 사건 `{ type: 'rail' }`(탈 때), `{ type: 'railEnd'; x; y }`.

- [ ] **Step 1: 테스트**
  - `출구로 나온 공은 레일을 타고 왼쪽 안쪽 길에 내려온다` — 3초 안에 `railEnd`, 공이 `x` 40~64, `y` 1030~1060 근처.
  - `레일에서 내린 공은 왼쪽 플리퍼에 닿는다` — 플리퍼를 올린 채로 두면 공이 플리퍼 위에 멈춘다 (`y` 1170~1215, 속도 30 아래).
  - `레일 위의 공은 1층 장치와 부딪히지 않는다` — 레일 아래 드롭 타깃이 쓰러지지 않는다.
  - `멀티볼에서 한 공이 레일 위에 있을 때 다른 공이 빠져도 공을 잃지 않는다` — `ballsLeft` 그대로, `multiballEnd` 사건.
  - `두 공이 같이 타도 서로 지나치지 않는다`
- [ ] **Step 2:** 실패 확인 → 구현 → 통과 확인. `soak.test.ts`도 통과.
- [ ] **Step 3:** 그리기: 레일(두 줄과 침목, 바닥 그림자)을 두 번째 장에 더한다. 레일 위 공은 맨 위에, 그림자를 멀리 떨어뜨려 그린다.
- [ ] **Step 4:** `npm test && npx tsc -b && npm run lint`, 커밋 `핀볼: 다락 출구에서 내려오는 레일`.

---

### Task 7: 소리, 진동, 화면 마무리

**Files:**
- Modify: `src/game/sfx.ts`, `src/pages/Pinball.tsx`, `src/pinball/fx.ts`, `src/pinball/render.ts`

**Interfaces:**
- Produces (`sfx.ts`): `'spinner' | 'ramp' | 'rail' | 'kickback' | 'mystery'`를 `Sfx`에 더하고 지금 소리들과 같은 방식(짧은 합성음)으로 만든다. 타깃·구멍·잭팟은 있는 소리를 쓴다.

- [ ] **Step 1:** `Pinball.tsx`의 사건 처리에 새 사건을 더한다: `ramp`(소리 `ramp`, 진동 `success`), `rail`(`rail`), `kickback`(`kickback`, `success`), `spinner`(`spinner`, 진동 없음), `standup`·`atticTarget`(`target`, `tap`), `standupBank`·`jackpotLit`(`bank`, `success`), `mystery`(`mystery`, `basicMedium`), `atticHole`(잭팟이면 `jackpot`·`confetti`, 아니면 `saucer`). `switch`가 모든 사건을 다루는지 타입으로 확인한다.
- [ ] **Step 2:** 불이 켜진 상태를 그린다: 킥백, 잭팟 구멍(깜빡임), 램프 연속(램프 앞 화살표가 `rampCombo`만큼 밝게), 오른쪽 타깃.
- [ ] **Step 3:** 스킨 6종으로 화면을 찍어 다락·램프·레일이 바닥과 구별되는지 본다. 구별이 안 되는 스킨이 있으면 섞는 비율을 고친다.
- [ ] **Step 4:** 일시정지 → 이어 하기, 다시 하기, 나가기를 공이 다락·구멍·레일에 있을 때 각각 해 본다.
- [ ] **Step 5:** `npm test && npx tsc -b && npm run lint`, 커밋 `핀볼: 새 장치의 소리·진동과 불 표시`.

---

### Task 8: 균형 맞추기

**Files:**
- Create: `test/pinball/balance.test.ts`
- Modify: `rules.ts`, `table.ts` (값만)

- [ ] **Step 1: 테스트** (`balance.test.ts`) — 봇으로 각각 200판.
  - `무작위 봇의 점수 중앙값이 25,000~62,000이다`
  - `반응 봇의 점수 중앙값이 500만에 닿지 않는다`
  - `바깥 길로 잃는 공이 전체의 3분의 1을 넘지 않는다` — 무작위 봇 기준.
  - `어느 판도 점수 500만, 코인 400을 넘지 않는다`
- [ ] **Step 2:** 통과할 때까지 점수, 지붕 가이드 틈, 범퍼·키커의 차는 힘, 발사 세기를 다듬는다. 스펙 5.4의 점수표에서 달라진 값은 스펙에도 고쳐 적는다.
- [ ] **Step 3:** `npm test && npx tsc -b && npm run lint`, 커밋 `핀볼: 봇으로 균형을 맞춤`.

---

### Task 9: 문서와 마지막 확인

**Files:**
- Modify: `README.md`

- [ ] **Step 1:** `README.md`의 핀볼 설명(기능 목록, "직접 만든 핀볼 물리", 픽셀 그림 칸 수, 폴더 설명)을 새 판에 맞게 고친다.
- [ ] **Step 2:** `npm test`, `(cd server && npm test)`, `npx tsc -b`, `npm run lint`, `npm run build`, `npm run build:android`가 모두 통과하는지 본다.
- [ ] **Step 3:** 브라우저에서 한 판을 끝까지 한다: 발사, 램프, 다락 잭팟, 레일, 킥백, 뽑기, 멀티볼, 결과 창.
- [ ] **Step 4:** 커밋 `핀볼: README를 새 판에 맞게 고침`. 사용자에게 폰 확인을 부탁하고, 푸시·배포는 확인을 받은 뒤에 한다.
