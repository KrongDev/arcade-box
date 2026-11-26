import { mutation } from '../admin/index.ts';
import { storeIcon } from '../asset/index.ts';
import type { Args, Command } from '../shared/cli/index.ts';
import type { Db } from '../shared/db/index.ts';
import { RuleError } from '../shared/errors.ts';
import { readPriceHistory, readProducts, readSkus, readActivePrices } from './repo.ts';
import {
  checkAccess,
  checkAmount,
  checkCurrency,
  checkDescription,
  checkGameRef,
  checkGrantCoins,
  checkKind,
  checkName,
  checkProductId,
  checkProductShape,
  checkSku,
  checkSlot,
  checkSortOrder,
  checkStatus,
  checkStore,
  type Product,
} from './rules.ts';
import { clearPrice, createProduct, getProduct, newProductRow, setPrice, setSku, updateProduct, type NewProduct, type ProductPatch } from './service.ts';

export interface ProductEnv {
  /** 아이콘을 두는 곳 (`<dataDir>/assets/`) */
  dataDir: string;
}

const usage = (line: string) => new RuleError(400, 'invalid_args', `이렇게 써 주세요: ${line}`);

/** 값이 있는 flag. 없으면 undefined, 값 없이 적었으면(`--name`만) 거절 */
function flag(args: Args, name: string): string | undefined {
  const v = args.flags[name];
  if (v === true) throw new RuleError(400, `invalid_${name.replace(/-/g, '_')}`, `--${name}에 값을 적어 주세요`);
  return v;
}

/** 명령줄의 0 이상 정수 글 (`1.5`, `1e3`, `-1`, ` 5`는 받지 않는다) */
function wholeNumber(text: string | undefined, code: string, label: string): number | undefined {
  if (text === undefined) return undefined;
  if (!/^[0-9]{1,16}$/.test(text)) throw new RuleError(400, `invalid_${code}`, `${label}은 0 이상의 정수예요`);
  return Number(text);
}

const ADD = 'product add <상품ID> --kind game|item|coin_pack --name <이름> --access everyone|purchase [--game <게임ID>] [--slot <자리>] [--grant-coins <n>] [--description <설명>] [--status draft|on_sale|hidden|retired] [--sort <순서>] --reason <까닭>';
const UPDATE = 'product update <상품ID> [--name] [--description] [--access] [--status] [--grant-coins] [--sort] [--icon <파일>] --reason <까닭>';

/** `product add`의 인자를 상품 한 줄로. 규칙까지 여기서 본다 (확인을 묻기 전에 거절하려고) */
function addArgs(args: Args): NewProduct {
  if (args.positional.length !== 1) throw usage(ADD);
  const kind = flag(args, 'kind');
  const name = flag(args, 'name');
  const access = flag(args, 'access');
  if (kind === undefined || name === undefined || access === undefined) throw usage(ADD);
  const status = flag(args, 'status');
  const sort = wholeNumber(flag(args, 'sort'), 'sort_order', '순서');
  const grant = wholeNumber(flag(args, 'grant-coins'), 'grant_coins', '주는 코인');
  const input: NewProduct = {
    id: checkProductId(args.positional[0]),
    kind: checkKind(kind),
    name: checkName(name),
    description: checkDescription(flag(args, 'description') ?? ''),
    gameId: checkGameRef(flag(args, 'game') ?? null),
    slot: checkSlot(flag(args, 'slot') ?? null),
    access: checkAccess(access),
    status: status === undefined ? undefined : checkStatus(status),
    grantCoins: grant === undefined ? null : grant,
    sortOrder: sort === undefined ? undefined : checkSortOrder(sort),
  };
  checkProductShape(newProductRow(input));
  return input;
}

function updateArgs(args: Args): { id: string; patch: ProductPatch; icon: string | undefined } {
  if (args.positional.length !== 1) throw usage(UPDATE);
  const name = flag(args, 'name');
  const description = flag(args, 'description');
  const access = flag(args, 'access');
  const status = flag(args, 'status');
  const sort = wholeNumber(flag(args, 'sort'), 'sort_order', '순서');
  const grant = wholeNumber(flag(args, 'grant-coins'), 'grant_coins', '주는 코인');
  const icon = flag(args, 'icon');
  const patch: ProductPatch = {};
  if (name !== undefined) patch.name = checkName(name);
  if (description !== undefined) patch.description = checkDescription(description);
  if (access !== undefined) patch.access = checkAccess(access);
  if (status !== undefined) patch.status = checkStatus(status);
  if (sort !== undefined) patch.sortOrder = checkSortOrder(sort);
  if (grant !== undefined) patch.grantCoins = checkGrantCoins(grant);
  if (Object.keys(patch).length === 0 && icon === undefined) throw usage(UPDATE);
  return { id: checkProductId(args.positional[0]), patch, icon };
}

function priceArgs(args: Args) {
  if (args.positional.length !== 3) throw usage('price set <상품ID> <COIN|KRW> <금액> --reason <까닭>');
  const [id, currency, amount] = args.positional;
  return { id: checkProductId(id), currency: checkCurrency(currency), amount: checkAmount(wholeNumber(amount, 'amount', '금액')) };
}

function clearArgs(args: Args) {
  if (args.positional.length !== 2) throw usage('price clear <상품ID> <COIN|KRW> --reason <까닭>');
  return { id: checkProductId(args.positional[0]), currency: checkCurrency(args.positional[1]) };
}

function skuArgs(args: Args) {
  if (args.positional.length !== 3) throw usage('sku set <상품ID> <google_play|app_store> <코드> --reason <까닭>');
  const [id, store, sku] = args.positional;
  return { id: checkProductId(id), store: checkStore(store), sku: checkSku(sku) };
}

const priceText = (prices: Array<{ currency: string; amount: number }>) => (prices.length === 0 ? '가격 없음' : prices.map((p) => `${p.currency} ${p.amount}`).join(', '));
const place = (p: Product) => (p.gameId === null ? '-' : `${p.gameId}${p.slot === null ? '' : `/${p.slot}`}`);

export function commands(db: Db, actor: string, env: ProductEnv): Command[] {
  return [
    {
      name: 'product add',
      usage: `${ADD} [--yes]`,
      run: mutation(db, actor, {
        action: 'product.add',
        describe: (args) => {
          const p = newProductRow(addArgs(args));
          return `상품 ${p.id}(${p.kind}, ${p.access}, ${p.status}, ${place(p)})을 추가해요: ${p.name}`;
        },
        target: (args) => ({ ref: checkProductId(args.positional[0]) }),
        apply: (tx, args) => createProduct(tx, addArgs(args)),
        report: () => '추가했어요. 가격은 price set으로 정해요',
      }),
    },
    {
      name: 'product update',
      usage: `${UPDATE} [--yes]`,
      run: mutation(db, actor, {
        action: 'product.update',
        describe: (args) => {
          const a = updateArgs(args);
          const parts = Object.entries(a.patch).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
          if (a.icon !== undefined) parts.push(`icon=${a.icon}`);
          return `상품 ${a.id}을 고쳐요: ${parts.join(', ')}`;
        },
        target: (args) => ({ ref: updateArgs(args).id }),
        apply: async (tx, args) => {
          const a = updateArgs(args);
          const patch = { ...a.patch };
          if (a.icon !== undefined) patch.iconPath = await storeIcon(env.dataDir, a.icon);
          await updateProduct(tx, a.id, patch);
          return patch.iconPath;
        },
        report: (iconPath) => (iconPath ? `고쳤어요. 아이콘: ${iconPath}` : '고쳤어요'),
      }),
    },
    {
      // 읽기만 한다: 까닭도 확인도 받지 않고 운영 기록도 남기지 않는다
      name: 'product list',
      usage: 'product list',
      run: async (args, io) => {
        if (args.positional.length > 0) throw usage('product list');
        const all = await readProducts(db, false);
        if (all.length === 0) {
          io.out('상품이 없어요');
          return;
        }
        const prices = await readActivePrices(
          db,
          all.map((p) => p.id),
        );
        for (const p of all) {
          io.out(`${p.id}  ${p.kind}  ${p.status}  ${p.access}  ${place(p)}  ${priceText(prices.filter((x) => x.productId === p.id))}  ${p.name}`);
        }
      },
    },
    {
      name: 'product show',
      usage: 'product show <상품ID>',
      run: async (args, io) => {
        if (args.positional.length !== 1) throw usage('product show <상품ID>');
        const p = await getProduct(db, args.positional[0]);
        if (!p) throw new RuleError(404, 'not_found', '없는 상품이에요');
        io.out(`${p.id}  ${p.kind}  ${p.status}  ${p.access}  ${place(p)}  순서 ${p.sortOrder}`);
        io.out(`이름: ${p.name}`);
        io.out(`설명: ${JSON.stringify(p.description)}`);
        io.out(`아이콘: ${p.iconPath ?? '없음'}`);
        if (p.kind === 'coin_pack') io.out(`consumable ${p.consumable} · grant_coins ${p.grantCoins}`);
        const history = await readPriceHistory(db, p.id);
        io.out(history.length === 0 ? '가격: 없음' : '가격 (최신부터):');
        for (const h of history) io.out(`  ${h.currency} ${h.amount}  ${h.active ? '켜짐' : '꺼짐'}  ${h.createdAt.toISOString()}`);
        const skus = await readSkus(db, p.id);
        for (const s of skus) io.out(`스토어 코드: ${s.store} ${s.sku}`);
      },
    },
    {
      name: 'price set',
      usage: 'price set <상품ID> <COIN|KRW> <금액> --reason <까닭> [--yes]',
      run: mutation(db, actor, {
        action: 'price.set',
        describe: (args) => {
          const a = priceArgs(args);
          return `상품 ${a.id}의 ${a.currency} 가격을 ${a.amount}로 정해요 (옛 가격은 꺼진 채 남아요)`;
        },
        target: (args) => ({ ref: priceArgs(args).id }),
        apply: (tx, args) => {
          const a = priceArgs(args);
          return setPrice(tx, a.id, a.currency, a.amount);
        },
        report: () => '가격을 정했어요',
      }),
    },
    {
      name: 'price clear',
      usage: 'price clear <상품ID> <COIN|KRW> --reason <까닭> [--yes]',
      run: mutation(db, actor, {
        action: 'price.clear',
        describe: (args) => {
          const a = clearArgs(args);
          return `상품 ${a.id}의 ${a.currency} 가격을 꺼요 (그 화폐로는 살 수 없게 돼요)`;
        },
        target: (args) => ({ ref: clearArgs(args).id }),
        apply: (tx, args) => {
          const a = clearArgs(args);
          return clearPrice(tx, a.id, a.currency);
        },
        report: () => '가격을 껐어요',
      }),
    },
    {
      name: 'sku set',
      usage: 'sku set <상품ID> <google_play|app_store> <코드> --reason <까닭> [--yes]',
      run: mutation(db, actor, {
        action: 'sku.set',
        describe: (args) => {
          const a = skuArgs(args);
          return `상품 ${a.id}의 ${a.store} 상품 코드를 ${a.sku}로 정해요`;
        },
        target: (args) => ({ ref: skuArgs(args).id }),
        apply: (tx, args) => {
          const a = skuArgs(args);
          return setSku(tx, a.id, a.store, a.sku);
        },
        report: () => '스토어 상품 코드를 정했어요',
      }),
    },
  ];
}
