import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/**
 * 운영 이미지는 `npm ci --omit=dev`로 만든다 (Dockerfile). 그래서 서버와 명령줄이 실행하는 코드(`src`)는
 * `dependencies`의 패키지와 Node 기본 모듈만 가져와야 한다: 개발용 패키지(drizzle-kit, PGlite, typescript)를 가져오면
 * 테스트는 통과하는데 컨테이너에서만 죽는다.
 */
const SERVER = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(`${SERVER}/package.json`, 'utf8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };

/** 소스가 가져오는 패키지 이름들 (상대 경로와 `node:` 모듈은 뺀다). `import type`은 실행할 때 지워지므로 세지 않는다 */
function packagesOf(source: string): string[] {
  const found: string[] = [];
  const patterns = [/\b(?:import|export)\b(?!\s+type\b)[^'"`;]*?\bfrom\s*['"`]([^'"`]+)['"`]/g, /\bimport\s*['"`]([^'"`]+)['"`]/g, /\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g];
  for (const pattern of patterns) for (const m of source.matchAll(pattern)) found.push(m[1]);
  return found
    .filter((spec) => !spec.startsWith('.') && !spec.startsWith('node:') && !builtinModules.includes(spec))
    .map((spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]));
}

function readSources(dir: string, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(out, readSources(path, `${prefix}${entry.name}/`));
    else if (entry.name.endsWith('.ts')) out[`${prefix}${entry.name}`] = readFileSync(path, 'utf8');
  }
  return out;
}

test('src는 dependencies의 패키지만 가져온다 (개발용 패키지를 실행 때 가져오지 않는다)', () => {
  const allowed = Object.keys(pkg.dependencies);
  const sources = readSources(`${SERVER}/src`);
  const used = new Set<string>();
  for (const [file, source] of Object.entries(sources)) {
    for (const name of packagesOf(source)) {
      used.add(name);
      assert.ok(allowed.includes(name), `src/${file}가 ${name}을 가져온다. dependencies에 없는 패키지다`);
    }
  }
  // 아무것도 못 읽어서 통과하는 일이 없게: 실제로 쓰는 패키지가 보인다
  assert.deepEqual([...used].sort(), ['drizzle-orm', 'jose', 'pg']);
  assert.deepEqual(allowed.sort(), ['drizzle-orm', 'jose', 'pg'], '런타임 의존성은 셋뿐이다 (계획의 Global Constraints)');
});

test('검사기가 개발용 패키지를 가져오는 예를 잡아낸다', () => {
  assert.deepEqual(packagesOf("import { PGlite } from '@electric-sql/pglite';\nimport x from 'drizzle-kit/api';"), ['@electric-sql/pglite', 'drizzle-kit']);
  assert.deepEqual(packagesOf("const m = await import('typescript');\nimport 'pg/lib/defaults.js';").sort(), ['pg', 'typescript']);
  // 타입만 가져오는 것, 상대 경로, Node 기본 모듈은 세지 않는다
  assert.deepEqual(packagesOf("import type { PgDatabase } from 'drizzle-orm/pg-core';\nimport { a } from './a.ts';\nimport fs from 'node:fs';\nimport http from 'http';"), []);
  assert.deepEqual(packagesOf("import { drizzle } from 'drizzle-orm/node-postgres';"), ['drizzle-orm']);
});

/**
 * 운영 이미지에 무엇이 남는지는 잠금 파일의 표시로 정해진다. `npm ci --omit=dev`만으로는 `devOptional`로 표시된 패키지가 남는다:
 * 우리가 개발용으로 설치한 PGlite와 `@types/*`는 `drizzle-orm`이 "있으면 쓰는"(optional peer) 패키지이기도 해서 그렇게 표시된다.
 * `--omit=optional`까지 줘야 빠진다. 그때 함께 빠지는 `pg-cloudflare`는 Cloudflare Workers에서만 쓰는 것이다.
 */
const lock = JSON.parse(readFileSync(`${SERVER}/package-lock.json`, 'utf8')) as {
  packages: Record<string, { dev?: boolean; optional?: boolean; devOptional?: boolean }>;
};

/** `npm ci --omit=dev --omit=optional` 뒤에 남는 패키지 이름들 */
function keptInImage(): string[] {
  return Object.entries(lock.packages)
    .filter(([path, p]) => path.startsWith('node_modules/') && !p.dev && !p.optional && !p.devOptional)
    .map(([path]) => path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length));
}

test('Dockerfile은 개발용 패키지와 선택 패키지를 모두 빼고 설치한다', () => {
  const dockerfile = readFileSync(`${SERVER}/Dockerfile`, 'utf8');
  const installs = dockerfile.split('\n').filter((line) => /\bnpm (ci|install)\b/.test(line));
  assert.equal(installs.length, 1, '패키지를 설치하는 줄은 하나다');
  assert.match(installs[0], /\bnpm ci\b/);
  assert.match(installs[0], /--omit=dev\b/);
  assert.match(installs[0], /--omit=optional\b/, 'devOptional로 표시된 개발용 패키지(PGlite, @types)는 --omit=optional까지 줘야 빠진다');
});

test('운영 이미지에 남는 패키지에 개발용 패키지가 없고, 실행에 쓰는 패키지는 모두 남는다', () => {
  const kept = keptInImage();
  const devOnly = kept.filter((name) => /^(drizzle-kit|typescript|@electric-sql\/|@types\/|@typescript\/|esbuild|@esbuild\/|tsx)/.test(name));
  assert.deepEqual(devOnly, [], '개발용 패키지가 운영 이미지에 남는다');
  // 서버가 가져오는 패키지와, pg가 실행 때 가져오는 패키지
  for (const name of ['drizzle-orm', 'jose', 'pg', 'pg-pool', 'pg-protocol', 'pg-types', 'pg-connection-string', 'pgpass']) {
    assert.ok(kept.includes(name), `${name}이 운영 이미지에서 빠진다`);
  }
  // 잠금 파일이 PGlite와 @types를 "개발용이자 선택"으로 적고 있다는 전제가 바뀌면 이 테스트를 다시 본다
  assert.equal(lock.packages['node_modules/@electric-sql/pglite']?.devOptional, true);
});
