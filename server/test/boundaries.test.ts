import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/**
 * 도메인 경계 (스펙 5.14). src의 import를 훑어 어긴 곳을 찾는다.
 *
 * - 다른 도메인의 것은 그 도메인의 index.ts로만 가져온다. 외래 키를 거는 schema.ts끼리만 예외다.
 * - shared는 shared 밖의 것을 가져오지 않는다.
 * - 의존은 아래 단에서 위 단으로만 간다. 같은 단끼리도 가져오지 않는다.
 *   src 바로 아래의 조립 파일(index.ts, server.ts, cli.ts, schema.ts, seed.ts …)은 맨 위 단이다.
 */
const TIERS: string[][] = [['admin', 'asset', 'account'], ['game', 'wallet'], ['product'], ['entitlement'], ['play', 'reward', 'order'], ['view']];
const SHARED = 'shared';
const ROOT = '(조립)';

type Rule = 'internal' | 'schema' | 'shared' | 'direction' | 'unknown';
interface Violation {
  rule: Rule;
  from: string;
  to: string;
}

/** 파일이 속한 곳: 도메인 이름, shared, 또는 src 바로 아래(조립) */
function areaOf(path: string): string {
  const cut = path.indexOf('/');
  return cut === -1 ? ROOT : path.slice(0, cut);
}

function tierOf(area: string): number {
  if (area === SHARED) return -1;
  if (area === ROOT) return TIERS.length;
  return TIERS.findIndex((tier) => tier.includes(area));
}

/** 소스에서 상대 경로 import를 뽑는다: import … from, export … from, import '…', import('…') */
function importsOf(source: string): string[] {
  const found: string[] = [];
  // 따옴표는 ', ", ` 모두 본다
  const patterns = [/\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"`]([^'"`]+)['"`]/g, /\bimport\s*['"`]([^'"`]+)['"`]/g, /\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g];
  for (const pattern of patterns) for (const m of source.matchAll(pattern)) found.push(m[1]);
  return found.filter((spec) => spec.startsWith('.'));
}

/** 경로(src 기준)와 내용을 받아 경계를 어긴 import를 모두 돌려준다 */
function findViolations(sources: Record<string, string>): Violation[] {
  const out: Violation[] = [];
  for (const [from, source] of Object.entries(sources)) {
    const a = areaOf(from);
    if (tierOf(a) === -1 && a !== SHARED) {
      out.push({ rule: 'unknown', from, to: a });
      continue;
    }
    for (const spec of importsOf(source)) {
      const to = posix.normalize(posix.join(posix.dirname(from), spec));
      if (to.startsWith('..')) continue; // src 밖
      const b = areaOf(to);
      if (a === b || b === SHARED) continue;
      if (a === SHARED) {
        out.push({ rule: 'shared', from, to });
        continue;
      }
      if (b !== ROOT) {
        if (to === `${b}/schema.ts`) {
          if (posix.basename(from) !== 'schema.ts') out.push({ rule: 'schema', from, to });
        } else if (to !== `${b}/index.ts`) {
          out.push({ rule: 'internal', from, to });
        }
      }
      if (tierOf(a) <= tierOf(b)) out.push({ rule: 'direction', from, to });
    }
  }
  return out;
}

function readSources(dir: string, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(out, readSources(`${dir}/${entry.name}`, path));
    else if (entry.name.endsWith('.ts')) out[path] = readFileSync(`${dir}/${entry.name}`, 'utf8');
  }
  return out;
}

const real = readSources(fileURLToPath(new URL('../src', import.meta.url)));
const realViolations = findViolations(real);
const show = (rule: Rule, list = realViolations) => list.filter((v) => v.rule === rule).map((v) => `${v.from} → ${v.to}`);

test('다른 도메인의 index.ts와 schema.ts가 아닌 파일을 가져오지 않는다', () => {
  assert.deepEqual(show('internal'), []);
});

test('schema.ts가 아닌 파일은 다른 도메인의 schema.ts를 가져오지 않는다', () => {
  assert.deepEqual(show('schema'), []);
});

test('shared는 도메인을 가져오지 않는다', () => {
  assert.deepEqual(show('shared'), []);
});

test('아래 도메인이 위 도메인을 가져오지 않는다', () => {
  assert.deepEqual(show('direction'), []);
});

test('src의 디렉토리는 정해진 도메인과 shared뿐이다', () => {
  assert.deepEqual(show('unknown'), []);
});

test('검사기가 진짜 src를 읽고 있다', () => {
  // 아무것도 못 읽어서 통과하는 일이 없게, 있어야 하는 파일과 import가 보이는지 본다
  assert.ok('shared/http/index.ts' in real);
  assert.ok('shared/errors.ts' in real);
  assert.ok(importsOf(real['shared/http/index.ts']).includes('../errors.ts'));
  // 경계를 넘는 import도 실제로 읽힌다: 명령줄 조립이 admin을 그 index.ts로 가져온다
  assert.ok(importsOf(real['cli.ts']).includes('./admin/index.ts'));
  assert.ok(importsOf(real['schema.ts']).includes('./admin/schema.ts'));
});

test('검사기가 어긴 예(글자열로 준 가짜 소스)를 잡아낸다', () => {
  const check = (sources: Record<string, string>) => findViolations(sources).map((v) => `${v.rule}: ${v.from} → ${v.to}`);

  // 지켜진 예: 자기 도메인 안, shared, 패키지, 아래 도메인의 index.ts, schema.ts끼리의 외래 키, 조립 파일
  assert.deepEqual(
    check({
      'order/service.ts': `
        import { eq } from 'drizzle-orm';
        import { RuleError } from '../shared/errors.ts';
        import type { Tx } from '../shared/db/index.ts';
        import { applyCoins } from '../wallet/index.ts';
        import { insertOrder } from './repo.ts';
        import { orders } from './schema.ts';`,
      'order/schema.ts': `
        import { users } from '../account/schema.ts';
        import { coinLedger } from '../wallet/schema.ts';
        import { app } from '../shared/db/schema.ts';`,
      'view/routes.ts': `import { getBalance } from '../wallet/index.ts';\nimport { listOrders } from '../order/index.ts';`,
      'server.ts': `import { routes as walletRoutes } from './wallet/index.ts';\nimport { createHandler } from './shared/http/index.ts';\nimport { loadStaticPages } from './static-pages.ts';`,
      'schema.ts': `export * from './admin/schema.ts';\nexport * from './wallet/schema.ts';\nexport { app } from './shared/db/schema.ts';`,
    }),
    [],
  );

  // 1. 다른 도메인의 속 파일
  assert.deepEqual(check({ 'wallet/service.ts': `import { findUser } from '../account/repo.ts';` }), ['internal: wallet/service.ts → account/repo.ts']);
  assert.deepEqual(check({ 'order/service.ts': `import { lockWallet } from '../wallet/repo.ts';` }), ['internal: order/service.ts → wallet/repo.ts']);
  assert.deepEqual(check({ 'server.ts': `import { lockWallet } from './wallet/repo.ts';` }), ['internal: server.ts → wallet/repo.ts']);
  assert.deepEqual(check({ 'order/service.ts': `import { x } from '../wallet/deep/index.ts';` }), ['internal: order/service.ts → wallet/deep/index.ts']);

  // 2. schema.ts가 아닌 파일이 다른 도메인의 schema.ts를
  assert.deepEqual(check({ 'wallet/service.ts': `import { users } from '../account/schema.ts';` }), ['schema: wallet/service.ts → account/schema.ts']);
  assert.deepEqual(check({ 'server.ts': `import { users } from './account/schema.ts';` }), ['schema: server.ts → account/schema.ts']);

  // 3. shared가 도메인이나 조립 파일을
  assert.deepEqual(check({ 'shared/http/index.ts': `import { findSession } from '../../account/index.ts';` }), ['shared: shared/http/index.ts → account/index.ts']);
  assert.deepEqual(check({ 'shared/cli/index.ts': `import { buildServer } from '../../server.ts';` }), ['shared: shared/cli/index.ts → server.ts']);

  // 4. 아래에서 위로, 같은 단끼리, 도메인이 조립 파일을
  assert.deepEqual(check({ 'account/service.ts': `import { getBalance } from '../wallet/index.ts';` }), ['direction: account/service.ts → wallet/index.ts']);
  assert.deepEqual(check({ 'account/schema.ts': `import { wallets } from '../wallet/schema.ts';` }), ['direction: account/schema.ts → wallet/schema.ts']);
  assert.deepEqual(check({ 'wallet/service.ts': `import { getGame } from '../game/index.ts';` }), ['direction: wallet/service.ts → game/index.ts']);
  assert.deepEqual(check({ 'play/service.ts': `import { purchaseWithCoins } from '../order/index.ts';` }), ['direction: play/service.ts → order/index.ts']);
  assert.deepEqual(check({ 'wallet/service.ts': `import { me } from '../view/index.ts';` }), ['direction: wallet/service.ts → view/index.ts']);
  assert.deepEqual(check({ 'view/routes.ts': `import { buildServer } from '../server.ts';` }), ['direction: view/routes.ts → server.ts']);
  // 속 파일을 위쪽으로 가져오면 둘 다 걸린다
  assert.deepEqual(check({ 'account/service.ts': `import { lockWallet } from '../wallet/repo.ts';` }), [
    'internal: account/service.ts → wallet/repo.ts',
    'direction: account/service.ts → wallet/repo.ts',
  ]);

  // 5. import를 적는 여러 모양
  const forms = [
    `import type { User } from '../account/repo.ts';`,
    `import {\n  findUser,\n  type User,\n} from "../account/repo.ts";`,
    `import * as account from '../account/repo.ts';`,
    `export { findUser } from '../account/repo.ts';`,
    `export * from '../account/repo.ts';`,
    `import '../account/repo.ts';`,
    `const m = await import('../account/repo.ts');`,
    'const m = await import(`../account/repo.ts`);',
    'import { findUser } from `../account/repo.ts`;',
    `import { findUser } from './../account/repo.ts';`,
    `import { findUser } from '../wallet/../account/repo.ts';`,
  ];
  for (const form of forms) assert.deepEqual(check({ 'wallet/service.ts': form }), ['internal: wallet/service.ts → account/repo.ts'], form);

  // 6. 모르는 디렉토리 (잡동사니 디렉토리를 만들지 않는다)
  assert.deepEqual(check({ 'utils/strings.ts': `export const x = 1;` }), ['unknown: utils/strings.ts → utils']);
});
