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
