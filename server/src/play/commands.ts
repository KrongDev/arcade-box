import { mutation } from '../admin/index.ts';
import { isGameId } from '../game/index.ts';
import type { Args, Command } from '../shared/cli/index.ts';
import type { Db } from '../shared/db/index.ts';
import { RuleError } from '../shared/errors.ts';
import { readBoards } from './repo.ts';
import { checkBoardId, type Board } from './rules.ts';
import { checkBoard, createBoard, updateBoard, type BoardPatch, type NewBoard } from './service.ts';

const usage = (line: string) => new RuleError(400, 'invalid_args', `이렇게 써 주세요: ${line}`);

const ADD = 'board add <순위표ID> --game <게임ID> --label <이름> --ordering higher|lower --min <최솟값> --max <최댓값> --max-coins <판당 코인> [--requires <순위표ID>] [--validator caps|minesweeper] [--params <JSON>] [--sort <순서>] --reason <까닭>';
const UPDATE = 'board update <순위표ID> [--label <이름>] [--min <최솟값>] [--max <최댓값>] [--max-coins <판당 코인>] [--requires <순위표ID>|none] [--validator caps|minesweeper] [--params <JSON>|none] [--sort <순서>] --reason <까닭>';
const LIST = 'board list [게임ID]';

/** 값이 있는 flag. 없으면 undefined, 값 없이 적었으면(`--label`만) 거절 */
function flag(args: Args, name: string): string | undefined {
  const v = args.flags[name];
  if (v === true) throw new RuleError(400, `invalid_${name.replace(/-/g, '_')}`, `--${name}에 값을 적어 주세요`);
  return v;
}

/** 명령줄의 숫자 글: 부호와 소수점까지만 (`1e3`, `0x10`, `NaN`, `Infinity`, 빈 값은 받지 않는다) */
function numberFlag(args: Args, name: string): number | undefined {
  const text = flag(args, name);
  if (text === undefined) return undefined;
  if (!/^-?[0-9]{1,13}(\.[0-9]{1,3})?$/.test(text)) throw new RuleError(400, `invalid_${name.replace(/-/g, '_')}`, `--${name}은 숫자로 적어 주세요 (예: 0, 5000000, 0.5)`);
  return Number(text);
}

/** 0 이상의 정수 글 */
function countFlag(args: Args, name: string): number | undefined {
  const text = flag(args, name);
  if (text === undefined) return undefined;
  if (!/^[0-9]{1,10}$/.test(text)) throw new RuleError(400, `invalid_${name.replace(/-/g, '_')}`, `--${name}은 0 이상의 정수로 적어 주세요`);
  return Number(text);
}

/** `--params`: JSON 한 덩어리. `none`은 비운다는 뜻이다 (null) */
function paramsFlag(args: Args): unknown {
  const text = flag(args, 'params');
  if (text === undefined) return undefined;
  if (text === 'none') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RuleError(400, 'invalid_validator_params', '--params는 JSON으로 적어 주세요 (예: \'{"safe":70,"mines":10,"par":180}\')');
  }
}

function addArgs(args: Args): NewBoard {
  if (args.positional.length !== 1) throw usage(ADD);
  const gameId = flag(args, 'game');
  const label = flag(args, 'label');
  const ordering = flag(args, 'ordering');
  const minValue = numberFlag(args, 'min');
  const maxValue = numberFlag(args, 'max');
  const maxCoinsPerRun = countFlag(args, 'max-coins');
  if (gameId === undefined || label === undefined || ordering === undefined || minValue === undefined || maxValue === undefined || maxCoinsPerRun === undefined) throw usage(ADD);
  // DB를 보지 않고 알 수 있는 것은 여기서 다 본다 (확인을 묻기 전에 거절된다)
  const board = checkBoard({
    id: args.positional[0],
    gameId,
    label,
    ordering: ordering as Board['ordering'],
    minValue,
    maxValue,
    maxCoinsPerRun,
    requiresBoardId: flag(args, 'requires') ?? null,
    validator: flag(args, 'validator') ?? 'caps',
    validatorParams: paramsFlag(args) ?? null,
    sortOrder: countFlag(args, 'sort') ?? 0,
  });
  return board;
}

function updateArgs(args: Args): { id: string; patch: BoardPatch } {
  if (args.positional.length !== 1) throw usage(UPDATE);
  for (const fixed of ['game', 'ordering']) {
    if (args.flags[fixed] !== undefined) throw new RuleError(400, 'not_updatable', `--${fixed}은 바꿀 수 없어요. 쌓인 기록의 뜻이 달라져요. 새 순위표를 만들어 주세요`);
  }
  const requires = flag(args, 'requires');
  const patch: BoardPatch = {
    label: flag(args, 'label'),
    minValue: numberFlag(args, 'min'),
    maxValue: numberFlag(args, 'max'),
    maxCoinsPerRun: countFlag(args, 'max-coins'),
    requiresBoardId: requires === undefined ? undefined : requires === 'none' ? null : checkBoardId(requires),
    validator: flag(args, 'validator'),
    validatorParams: paramsFlag(args),
    sortOrder: countFlag(args, 'sort'),
  };
  if (Object.values(patch).every((v) => v === undefined)) throw usage(UPDATE);
  return { id: checkBoardId(args.positional[0]), patch };
}

const show = (v: unknown) => JSON.stringify(v);

export function commands(db: Db, actor: string): Command[] {
  return [
    {
      name: 'board add',
      usage: `${ADD} [--yes]`,
      run: mutation(db, actor, {
        action: 'board.add',
        describe: (args) => {
          const b = addArgs(args);
          return `순위표 ${b.id}(${b.label})을 게임 ${b.gameId}에 추가해요: ${b.ordering}, 값 ${b.minValue}~${b.maxValue}, 판당 코인 ${b.maxCoinsPerRun}까지, 검증기 ${b.validator}${b.validatorParams ? ` ${show(b.validatorParams)}` : ''}${b.requiresBoardId ? `, 앞 단계 ${b.requiresBoardId}` : ''}`;
        },
        target: (args) => ({ ref: addArgs(args).id }),
        apply: (tx, args) => createBoard(tx, addArgs(args)),
        report: () => '추가했어요. 이제 이 순위표의 판 결과를 받아요',
      }),
    },
    {
      name: 'board update',
      usage: `${UPDATE} [--yes]`,
      run: mutation(db, actor, {
        action: 'board.update',
        describe: (args) => {
          const a = updateArgs(args);
          const parts = Object.entries(a.patch)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => `${k}=${show(v)}`);
          return `순위표 ${a.id}을 고쳐요: ${parts.join(', ')}`;
        },
        target: (args) => ({ ref: updateArgs(args).id }),
        apply: (tx, args) => {
          const a = updateArgs(args);
          return updateBoard(tx, a.id, a.patch);
        },
        report: () => '고쳤어요',
      }),
    },
    {
      // 읽기만 한다: 까닭도 확인도 받지 않고 운영 기록도 남기지 않는다
      name: 'board list',
      usage: LIST,
      run: async (args, io) => {
        if (args.positional.length > 1) throw usage(LIST);
        const gameId = args.positional[0];
        if (gameId !== undefined && !isGameId(gameId)) throw new RuleError(400, 'invalid_game_id', `게임 ID 모양이 아니에요: ${gameId}`);
        const all = await readBoards(db, gameId);
        if (all.length === 0) {
          io.out('순위표가 없어요');
          return;
        }
        for (const b of all) {
          io.out(
            `${b.id}  ${b.gameId}  ${b.ordering}  값 ${b.minValue}~${b.maxValue}  판당 코인 ${b.maxCoinsPerRun}  검증기 ${b.validator}${b.validatorParams === null ? '' : ` ${show(b.validatorParams)}`}  ${b.requiresBoardId ? `앞 단계 ${b.requiresBoardId}` : '앞 단계 없음'}  순서 ${b.sortOrder}  ${b.label}`,
          );
        }
      },
    },
  ];
}
