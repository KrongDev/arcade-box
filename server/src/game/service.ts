import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, rename, rm, rmdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isIconName } from '../asset/index.ts';
import { sha256File, verifyEd25519 } from '../shared/crypto.ts';
import type { Q, Tx } from '../shared/db/index.ts';
import { RuleError } from '../shared/errors.ts';
import {
  insertGame,
  insertVersion,
  lockGame,
  maxVersion,
  patchGame,
  previousLive,
  readGame,
  readLiveGames,
  readVersion,
  readVersionById,
  setLiveVersion,
  setVersionStatus,
  type GameRow,
} from './repo.ts';
import {
  bundleRelPath,
  checkDescription,
  checkGameId,
  checkGameStatus,
  checkMinShellApi,
  checkName,
  checkNotes,
  checkSignature,
  checkSortOrder,
  checkVersion,
  isGameId,
  isVersion,
  manifestText,
  type GameStatus,
  type VersionStatus,
} from './rules.ts';

const noGame = () => new RuleError(404, 'not_found', '없는 게임이에요');
const noVersion = () => new RuleError(404, 'not_found', '없는 버전이에요');
const nothingToRollback = () => new RuleError(409, 'nothing_to_rollback', '되돌릴 이전 버전이 없어요');

// ── 게임 ────────────────────────────────────────────────────

/** 게임을 만든다 (처음 상태는 draft). 같은 ID가 있으면 `409 already_exists` */
export async function createGame(tx: Tx, input: { id: string; name: string; description: string; sortOrder?: number }): Promise<void> {
  const row = {
    id: checkGameId(input.id),
    name: checkName(input.name),
    description: checkDescription(input.description),
    sortOrder: input.sortOrder === undefined ? 0 : checkSortOrder(input.sortOrder),
  };
  if (!(await insertGame(tx, row))) throw new RuleError(409, 'already_exists', `이미 있는 게임이에요: ${row.id}`);
}

export interface GamePatch {
  name?: string;
  description?: string;
  sortOrder?: number;
  status?: GameStatus;
  /** `asset`의 `storeIcon`이 준 이름 */
  iconPath?: string;
}

/** 준 것만 고친다. 고칠 것이 없으면 `400 nothing_to_update`, 없는 게임이면 `404 not_found` */
export async function updateGame(tx: Tx, id: string, patch: GamePatch): Promise<void> {
  const gameId = checkGameId(id);
  const set: GamePatch = {};
  if (patch.name !== undefined) set.name = checkName(patch.name);
  if (patch.description !== undefined) set.description = checkDescription(patch.description);
  if (patch.sortOrder !== undefined) set.sortOrder = checkSortOrder(patch.sortOrder);
  if (patch.status !== undefined) set.status = checkGameStatus(patch.status);
  if (patch.iconPath !== undefined) {
    if (typeof patch.iconPath !== 'string' || !isIconName(patch.iconPath)) throw new RuleError(400, 'invalid_icon', '아이콘 이름이 올바르지 않아요');
    set.iconPath = patch.iconPath;
  }
  if (Object.keys(set).length === 0) throw new RuleError(400, 'nothing_to_update', '고칠 것을 하나 이상 적어 주세요');
  if (!(await patchGame(tx, gameId, set))) throw noGame();
}

export type Game = GameRow;

/** 게임 하나 (상태와 상관없이). 없거나 ID 모양이 아니면 null */
export async function getGame(q: Q, id: string): Promise<Game | null> {
  if (!isGameId(id)) return null;
  return readGame(q, id);
}

/** live 게임만, 순서대로. 버전을 내보낸 적 없는 게임은 `liveVersion`이 null이다 */
export async function listLiveGames(q: Q): Promise<Game[]> {
  return readLiveGames(q);
}

// ── 버전과 묶음 ────────────────────────────────────────────────

/**
 * 게임 버전을 올린다 (스펙 5.8). 운영자가 VM에 올린 묶음 파일과 서명을 받아:
 *
 * 1. 게임 ID·버전·min_shell_api·서명의 모양을 본다 (경로를 만들기 전에)
 * 2. 공개 키 설정이 없으면 `409 no_public_key`
 * 3. 게임 행을 잠그고, 버전이 지금까지의 가장 큰 버전(거둬들인 것 포함)보다 크지 않으면 `409 version_not_increasing`
 * 4. 파일을 `bundles/<게임>/`의 임시 이름으로 복사하고, 복사본에서 SHA-256과 크기를 직접 계산한다
 * 5. 그 값으로 만든 `manifestText`의 서명이 맞지 않으면 `409 bad_signature`
 * 6. 'uploaded'로 넣고 임시 파일을 `<버전>.zip`으로 바꿔 단다
 *
 * 복사본을 확인하므로 확인한 내용과 저장한 내용이 같다 (원본이 그사이 바뀌어도). 거절하면 임시 파일을 지우고,
 * 이번에 처음 만든 빈 `bundles/<게임>/` 디렉토리도 지워 그 자리에 아무것도 남기지 않는다.
 *
 * 남을 수 있는 것 하나: 바꿔 단(`rename`) 뒤에 부른 쪽의 트랜잭션이 실패하면(커밋 실패 등) 행 없는 `<버전>.zip`이
 * 남는다. 행이 없으니 내려 주지 않고(`getVersion`이 null), 같은 버전을 다시 올리면 덮어쓴다.
 */
export async function addVersion(
  tx: Tx,
  input: { gameId: string; version: number; filePath: string; signature: string; minShellApi: number; notes?: string },
  env: { dataDir: string; publicKey: string | null },
): Promise<{ version: number; sha256: string; sizeBytes: number }> {
  const gameId = checkGameId(input.gameId);
  const version = checkVersion(input.version);
  const minShellApi = checkMinShellApi(input.minShellApi);
  const signature = checkSignature(input.signature);
  const notes = checkNotes(input.notes);
  const publicKey = env.publicKey;
  if (!publicKey) throw new RuleError(409, 'no_public_key', '서버에 묶음 서명 공개 키(BUNDLE_PUBLIC_KEY)가 없어요');

  if (!(await lockGame(tx, gameId))) throw noGame();
  const max = await maxVersion(tx, gameId);
  if (version <= max) throw new RuleError(409, 'version_not_increasing', `버전은 지금까지의 가장 큰 버전(${max})보다 커야 해요`);

  try {
    if (!(await stat(input.filePath)).isFile()) throw new Error('not a file');
  } catch {
    throw new RuleError(400, 'bundle_not_found', '묶음 파일을 찾을 수 없어요');
  }

  const bundlePath = bundleRelPath(gameId, version);
  const target = join(env.dataDir, bundlePath);
  await mkdir(dirname(target), { recursive: true });
  const temp = join(dirname(target), `.upload-${randomBytes(8).toString('hex')}`);
  let ok = false;
  try {
    await copyFile(input.filePath, temp);
    const { hex: sha256, size: sizeBytes } = await sha256File(temp);
    if (!verifyEd25519(publicKey, manifestText({ gameId, version, sha256, sizeBytes, minShellApi }), signature)) {
      throw new RuleError(409, 'bad_signature', '묶음 서명이 맞지 않아요 (파일, 게임, 버전, min_shell_api, 키를 확인해 주세요)');
    }
    await insertVersion(tx, { gameId, version, bundlePath, sizeBytes, sha256, signature, minShellApi, notes });
    await rename(temp, target);
    ok = true;
    return { version, sha256, sizeBytes };
  } finally {
    await rm(temp, { force: true });
    // 거절했으면 빈 디렉토리를 지운다. 다른 버전의 묶음이 있으면 비어 있지 않아 지워지지 않는다
    if (!ok) await rmdir(dirname(target)).catch(() => {});
  }
}

/**
 * 버전을 내보낸다: 그 버전을 'live'로, `games.live_version_id`를 그 버전으로, 게임이 draft면 live로 (한 트랜잭션).
 * 거둬들인 버전은 다시 내보내지 않는다(`409 version_withdrawn`). 이미 지금 버전이면 `409 already_live`.
 */
export async function publish(tx: Tx, gameId: string, version: number): Promise<void> {
  const id = checkGameId(gameId);
  const v = checkVersion(version);
  const game = await lockGame(tx, id);
  if (!game) throw noGame();
  const row = await readVersion(tx, id, v);
  if (!row) throw noVersion();
  if (row.status === 'withdrawn') throw new RuleError(409, 'version_withdrawn', '거둬들인 버전은 다시 내보낼 수 없어요. 새 버전으로 올려 주세요');
  if (game.liveVersionId === row.id) throw new RuleError(409, 'already_live', '이미 지금 버전이에요');
  await setVersionStatus(tx, row.id, 'live', true);
  await setLiveVersion(tx, id, row.id, game.status === 'draft' ? 'live' : undefined);
}

/**
 * 되돌린다: 지금 버전을 'withdrawn'으로 바꾸고 포인터를 `toVersion`으로 옮긴다 (한 트랜잭션).
 * `toVersion`이 없으면 지금보다 낮은 live 버전 가운데 가장 높은 것이다. 갈 곳이 없으면 `409 nothing_to_rollback`.
 * `toVersion`은 내보낸 적 있는 live 버전이어야 한다 (`409 version_not_live`).
 */
export async function rollback(tx: Tx, gameId: string, toVersion?: number): Promise<{ from: number; to: number }> {
  const id = checkGameId(gameId);
  const to = toVersion === undefined ? undefined : checkVersion(toVersion);
  const game = await lockGame(tx, id);
  if (!game) throw noGame();
  if (game.liveVersionId === null) throw nothingToRollback();
  const current = await readVersionById(tx, game.liveVersionId);
  if (!current) throw nothingToRollback();

  let target;
  if (to === undefined) {
    target = await previousLive(tx, id, current.version);
    if (!target) throw nothingToRollback();
  } else {
    target = await readVersion(tx, id, to);
    if (!target) throw noVersion();
    if (target.id === current.id) throw nothingToRollback();
    if (target.status !== 'live') throw new RuleError(409, 'version_not_live', '내보낸 적 있는 live 버전으로만 되돌릴 수 있어요');
  }
  await setVersionStatus(tx, current.id, 'withdrawn', false);
  await setLiveVersion(tx, id, target.id);
  return { from: current.version, to: target.version };
}

/**
 * 버전 하나의 상태와 묶음 경로. `bundlePath`는 dataDir 기준 상대 경로다 (`bundles/<게임>/<버전>.zip`):
 * 묶음을 내려 줄 때 `join(config.dataDir, bundlePath)`로 쓴다. 없거나 게임 ID·버전 모양이 아니면 null.
 */
export async function getVersion(q: Q, gameId: string, version: number): Promise<{ status: VersionStatus; bundlePath: string } | null> {
  if (!isGameId(gameId) || !isVersion(version)) return null;
  const row = await readVersion(q, gameId, version);
  return row ? { status: row.status, bundlePath: row.bundlePath } : null;
}
