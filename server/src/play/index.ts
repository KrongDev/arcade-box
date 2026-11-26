/**
 * play — 게임을 하는 일: 묶음 받기, 순위표 정의, 판 결과와 검증, 기록, 순위표 조회 (스펙 5.8, 5.9).
 * 다른 도메인은 이 파일로만 가져온다 (테이블에 외래 키를 걸 때만 `schema.ts`).
 */
export { commands } from './commands.ts';
export { routes, type PlayDeps } from './routes.ts';
export { nickname, type Board, type Ordering, type RunResult } from './rules.ts';
export { boardStats, createBoard, leaderboard, listBoards, purgeUser, runCoinStatus, submitRun, updateBoard, type BoardPatch, type Leaderboard, type NewBoard, type RunOutcome } from './service.ts';
export { VALIDATORS, type Validator } from './validators.ts';
