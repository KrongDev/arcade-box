/**
 * game — 게임, 버전과 묶음, 내보내기와 되돌리기 (스펙 5.8).
 * 다른 도메인은 이 파일로만 가져온다 (테이블에 외래 키를 걸 때만 `schema.ts`).
 */
export { commands, type GameEnv } from './commands.ts';
export type { LiveVersion } from './repo.ts';
export { GAME_STATUSES, isGameId, manifestText, type GameStatus, type VersionStatus } from './rules.ts';
export { addVersion, createGame, getGame, getVersion, listLiveGames, publish, rollback, updateGame, type Game, type GamePatch } from './service.ts';
