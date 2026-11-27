import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RuleError } from '../shared/errors.ts';

/** 아이콘 크기 상한 (스펙 5.8: 200KB) */
export const MAX_ICON_BYTES = 204_800;

export type IconType = 'png' | 'webp';

/** 내려 줄 수 있는 이름: 내용의 SHA-256(소문자 16진수 64자) + 확장자. 이 모양이 아니면 파일을 찾아보지도 않는다 */
export const ICON_NAME = /^[0-9a-f]{64}\.(png|webp)$/;

export const CONTENT_TYPES: Record<IconType, string> = { png: 'image/png', webp: 'image/webp' };

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * 파일 머리글자로 종류를 가린다. 확장자는 믿지 않는다.
 * - PNG: 고정된 8바이트 서명
 * - WebP: `RIFF` · 크기 4바이트 · `WEBP` (같은 RIFF 틀을 쓰는 WAV·AVI는 아니다)
 */
export function iconType(bytes: Buffer): IconType | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** 아이콘을 두는 곳: `<dataDir>/assets/` */
export function assetsDir(dataDir: string): string {
  return join(dataDir, 'assets');
}

const tooLarge = () => new RuleError(400, 'icon_too_large', `아이콘은 ${MAX_ICON_BYTES.toLocaleString('en-US')}바이트(200KB)까지예요`);

/**
 * 아이콘 파일을 확인해 `<dataDir>/assets/<sha256>.<png|webp>`에 두고 그 이름을 준다 (스펙 5.8).
 * 같은 내용이면 같은 이름이라 두 번 올려도 파일은 하나다.
 *
 * - 없거나 보통 파일이 아니면 `400 icon_not_found`
 * - 204,800바이트를 넘으면 `400 icon_too_large`
 * - 머리글자가 PNG·WebP가 아니면 `400 icon_type`
 *
 * 크기를 먼저 보고 넘지 않을 때만 한 번 읽는다 (200KB라 메모리에 올려도 된다). 확인·이름·저장이 모두 그 한 번 읽은
 * 내용으로 하므로 그사이 원본이 바뀌어도 어긋나지 않는다. 거절하면 아무것도 쓰지 않는다. 쓸 때는 같은 디렉토리의
 * 임시 이름에 쓴 뒤 바꿔 달아서, 내려 주는 쪽이 반쯤 쓰인 파일을 보는 일이 없다.
 */
export async function storeIcon(dataDir: string, sourcePath: string): Promise<string> {
  let bytes: Buffer;
  try {
    const info = await stat(sourcePath);
    if (!info.isFile()) throw new Error('not a file');
    if (info.size > MAX_ICON_BYTES) throw tooLarge();
    bytes = await readFile(sourcePath);
  } catch (err) {
    if (err instanceof RuleError) throw err;
    throw new RuleError(400, 'icon_not_found', '아이콘 파일을 찾을 수 없어요');
  }
  if (bytes.length > MAX_ICON_BYTES) throw tooLarge(); // stat 뒤에 커졌다
  const type = iconType(bytes);
  if (!type) throw new RuleError(400, 'icon_type', '아이콘은 PNG나 WebP 파일이어야 해요');

  const name = `${createHash('sha256').update(bytes).digest('hex')}.${type}`;
  const dir = assetsDir(dataDir);
  await mkdir(dir, { recursive: true });
  const temp = join(dir, `.upload-${randomBytes(8).toString('hex')}`);
  try {
    await writeFile(temp, bytes);
    await rename(temp, join(dir, name));
  } finally {
    await rm(temp, { force: true });
  }
  return name;
}

/** 목록에 넣는 아이콘 주소. 아이콘이 없으면 null */
export function iconUrl(name: string | null): string | null {
  return name === null ? null : `/v2/assets/${name}`;
}

/** `storeIcon`이 준 이름의 모양인지 (게임·상품에 아이콘 이름을 달 때 확인한다) */
export function isIconName(name: string): boolean {
  return ICON_NAME.test(name);
}
