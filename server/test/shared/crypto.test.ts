import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { randomToken, sha256File, sha256Hex, verifyEd25519 } from '../../src/shared/crypto.ts';

/** 테스트 안에서 만든 Ed25519 키 쌍. 공개 키는 두 가지 모양(32바이트 그대로, SPKI DER)으로 준다 */
function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  return {
    spki: spki.toString('base64'),
    raw: spki.subarray(spki.length - 32).toString('base64'),
    sign: (message: string) => sign(null, Buffer.from(message, 'utf8'), privateKey).toString('base64'),
  };
}

test('맞는 서명은 통과하고, 글자 하나를 바꾼 글이나 다른 키의 서명은 통과하지 않는다', () => {
  const key = keyPair();
  const other = keyPair();
  const message = 'arcade-box-bundle\npinball\n3\nab\n10\n1\n';
  const signature = key.sign(message);

  assert.equal(verifyEd25519(key.raw, message, signature), true);
  assert.equal(verifyEd25519(key.spki, message, signature), true);

  assert.equal(verifyEd25519(key.raw, message.replace('pinball', 'pinbalm'), signature), false);
  assert.equal(verifyEd25519(key.raw, message, other.sign(message)), false);
  assert.equal(verifyEd25519(other.raw, message, signature), false);
  assert.equal(verifyEd25519(other.spki, message, signature), false);
});

test('키나 서명이 말이 안 되면 던지지 않고 거짓을 준다', () => {
  const key = keyPair();
  const message = '글';
  const signature = key.sign(message);
  for (const badKey of ['', 'AAAA', '한글', key.raw.slice(0, 20), `${key.raw}AAAA`, 'A'.repeat(64)]) {
    assert.equal(verifyEd25519(badKey, message, signature), false, `키 ${badKey}`);
  }
  for (const badSignature of ['', 'AAAA', signature.slice(0, 40), `${signature}AAAA`]) {
    assert.equal(verifyEd25519(key.raw, message, badSignature), false, `서명 ${badSignature}`);
  }
});

test('randomToken은 32바이트를 base64url로 적은 43자이고 부를 때마다 다르다', () => {
  const tokens = new Set(Array.from({ length: 50 }, () => randomToken()));
  assert.equal(tokens.size, 50);
  for (const token of tokens) {
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(token, 'base64url').length, 32);
  }
});

test('sha256Hex와 sha256File은 같은 내용에 같은 값을 준다', async () => {
  // 알려진 값: SHA-256("abc")
  const abc = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  assert.equal(sha256Hex('abc'), abc);
  const dir = mkdtempSync(join(tmpdir(), 'arcade-crypto-'));
  try {
    writeFileSync(join(dir, 'abc.bin'), 'abc');
    assert.deepEqual(await sha256File(join(dir, 'abc.bin')), { hex: abc, size: 3 });
    const big = Buffer.alloc(300_000, 7);
    writeFileSync(join(dir, 'big.bin'), big);
    const out = await sha256File(join(dir, 'big.bin'));
    assert.equal(out.size, 300_000);
    assert.match(out.hex, /^[0-9a-f]{64}$/);
    await assert.rejects(sha256File(join(dir, 'none.bin')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
