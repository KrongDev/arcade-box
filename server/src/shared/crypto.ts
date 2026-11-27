import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';

/** 세션 토큰 같은 비밀값: 32바이트 난수를 base64url로 적은 43자 */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 파일을 흘려 읽으며 SHA-256과 크기를 구한다 (파일 전체를 메모리에 올리지 않는다) */
export async function sha256File(path: string): Promise<{ hex: string; size: number }> {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
    size += (chunk as Buffer).length;
  }
  return { hex: hash.digest('hex'), size };
}

/** base64(또는 base64url)를 푼다. 다른 글자가 섞였거나 뒤에 군더더기가 붙었으면 null */
function decodeBase64(text: string): Buffer | null {
  const plain = text.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]+$/.test(plain)) return null;
  const bytes = Buffer.from(plain, 'base64');
  return bytes.toString('base64').replace(/=+$/, '') === plain ? bytes : null;
}

/** Ed25519 공개 키를 SPKI DER로 적을 때 32바이트 키 앞에 붙는 고정 머리 */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * Ed25519 서명 확인. 공개 키는 32바이트 그대로이거나 SPKI DER(44바이트)이고, 키와 서명은 base64로 받는다.
 * 키나 서명이 말이 안 되면 던지지 않고 거짓을 준다.
 */
export function verifyEd25519(publicKeyBase64: string, message: string, signatureBase64: string): boolean {
  try {
    let der = decodeBase64(publicKeyBase64);
    if (der?.length === 32) der = Buffer.concat([ED25519_SPKI_PREFIX, der]);
    if (der?.length !== 44 || !der.subarray(0, 12).equals(ED25519_SPKI_PREFIX)) return false;
    const signature = decodeBase64(signatureBase64);
    if (signature?.length !== 64) return false;
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    return verify(null, Buffer.from(message, 'utf8'), key, signature);
  } catch {
    return false;
  }
}
