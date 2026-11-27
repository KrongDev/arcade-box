import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { manifestText } from '../../src/game/index.ts';
import type { Db } from '../../src/shared/db/index.ts';
import { RuleError } from '../../src/shared/errors.ts';
import { testDb } from '../helpers/db.ts';

export const rule = (status: number, code: string) => (err: unknown) => err instanceof RuleError && err.status === status && err.code === code;

/** 테스트 안에서 만든 Ed25519 키 한 쌍. 공개 키는 서버 설정처럼 base64(SPKI DER)로 준다 */
export function keyPair(): { publicKey: string; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'), privateKey };
}

/** 운영자 컴퓨터의 서명 도구가 하는 일: 묶음의 manifest 글에 서명해 base64로 준다 */
export function signManifest(privateKey: KeyObject, m: Parameters<typeof manifestText>[0]): string {
  return sign(null, Buffer.from(manifestText(m), 'utf8'), privateKey).toString('base64');
}

export const sha256Hex = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export interface GameKit {
  db: Db;
  /** 올릴 묶음을 두는 곳 */
  src: string;
  /** 서버의 dataDir */
  dataDir: string;
  publicKey: string;
  privateKey: KeyObject;
  env: { dataDir: string; publicKey: string | null };
  /** 작은 묶음 파일을 만들고, 그 파일에 맞는 서명을 함께 준다 */
  bundle(gameId: string, version: number, opts?: { minShellApi?: number; content?: string }): Promise<{ filePath: string; signature: string; bytes: Buffer }>;
  close(): Promise<void>;
}

/** 빈 DB, 임시 디렉토리 둘(올릴 곳, dataDir), 키 한 쌍. 저장소 안에는 아무것도 만들지 않는다 */
export async function gameKit(): Promise<GameKit> {
  const { db, close } = await testDb();
  const root = await mkdtemp(join(tmpdir(), 'arcade-game-'));
  const src = join(root, 'src');
  const dataDir = join(root, 'data');
  await mkdir(src);
  await mkdir(dataDir);
  const keys = keyPair();
  let n = 0;
  return {
    db,
    src,
    dataDir,
    ...keys,
    env: { dataDir, publicKey: keys.publicKey },
    async bundle(gameId, version, opts = {}) {
      const bytes = Buffer.from(opts.content ?? `PK-fake-zip ${gameId} ${version} ${'x'.repeat(100)}`);
      const filePath = join(src, `upload-${++n}.zip`);
      await writeFile(filePath, bytes);
      const signature = signManifest(keys.privateKey, { gameId, version, sha256: sha256Hex(bytes), sizeBytes: bytes.length, minShellApi: opts.minShellApi ?? 1 });
      return { filePath, signature, bytes };
    },
    async close() {
      await close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
