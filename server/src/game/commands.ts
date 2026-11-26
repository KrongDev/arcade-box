import { mutation } from '../admin/index.ts';
import { storeIcon } from '../asset/index.ts';
import type { Args, Command } from '../shared/cli/index.ts';
import type { Db } from '../shared/db/index.ts';
import { RuleError } from '../shared/errors.ts';
import { lockGame, readAllGames, readVersions } from './repo.ts';
import { checkDescription, checkGameId, checkGameStatus, checkMinShellApi, checkName, checkNotes, checkSignature, checkSortOrder, checkVersion, INT_MAX } from './rules.ts';
import { addVersion, createGame, publish, rollback, updateGame } from './service.ts';

export interface GameEnv {
  dataDir: string;
  publicKey: string | null;
}

const usage = (line: string) => new RuleError(400, 'invalid_args', `이렇게 써 주세요: ${line}`);

/** 값이 있는 flag. 없으면 undefined, 값 없이 적었으면(`--name`만) 거절 */
function flag(args: Args, name: string): string | undefined {
  const v = args.flags[name];
  if (v === true) throw new RuleError(400, `invalid_${name.replace(/-/g, '_')}`, `--${name}에 값을 적어 주세요`);
  return v;
}

/** 명령줄의 숫자 글: 0 없이 시작하는 자연수만 (`1.5`, `1e3`, `-1`, `../1`은 받지 않는다) */
function positiveInt(text: string | undefined, code: string, label: string): number {
  if (text === undefined || !/^[1-9][0-9]{0,9}$/.test(text) || Number(text) > INT_MAX) {
    throw new RuleError(400, `invalid_${code}`, `${label}은 1~${INT_MAX}의 정수예요`);
  }
  return Number(text);
}

function sortFlag(args: Args): number | undefined {
  const text = flag(args, 'sort');
  if (text === undefined) return undefined;
  if (!/^[0-9]{1,7}$/.test(text)) throw new RuleError(400, 'invalid_sort_order', '순서는 0 이상의 정수예요');
  return checkSortOrder(Number(text));
}

function addArgs(args: Args) {
  const line = 'game add <게임ID> --name <이름> [--description <설명>] [--sort <순서>] --reason <까닭>';
  if (args.positional.length !== 1) throw usage(line);
  const name = flag(args, 'name');
  if (name === undefined) throw usage(line);
  return { id: checkGameId(args.positional[0]), name: checkName(name), description: checkDescription(flag(args, 'description') ?? ''), sortOrder: sortFlag(args) };
}

function updateArgs(args: Args) {
  const line = 'game update <게임ID> [--name] [--description] [--sort] [--status draft|live|retired] [--icon <파일>] --reason <까닭>';
  if (args.positional.length !== 1) throw usage(line);
  const name = flag(args, 'name');
  const description = flag(args, 'description');
  const status = flag(args, 'status');
  const icon = flag(args, 'icon');
  const patch = {
    name: name === undefined ? undefined : checkName(name),
    description: description === undefined ? undefined : checkDescription(description),
    sortOrder: sortFlag(args),
    status: status === undefined ? undefined : checkGameStatus(status),
  };
  if (Object.values(patch).every((v) => v === undefined) && icon === undefined) throw usage(line);
  return { id: checkGameId(args.positional[0]), patch, icon };
}

function versionArgs(args: Args) {
  const line = 'game add-version <게임ID> <버전> --file <묶음.zip> --signature <base64> --min-shell-api <n> [--notes <메모>] --reason <까닭>';
  if (args.positional.length !== 2) throw usage(line);
  const filePath = flag(args, 'file');
  const signature = flag(args, 'signature');
  if (filePath === undefined || signature === undefined) throw usage(line);
  return {
    gameId: checkGameId(args.positional[0]),
    version: checkVersion(positiveInt(args.positional[1], 'version', '버전')),
    filePath,
    signature: checkSignature(signature),
    minShellApi: checkMinShellApi(positiveInt(flag(args, 'min-shell-api'), 'min_shell_api', 'min_shell_api')),
    notes: checkNotes(flag(args, 'notes')) ?? undefined,
  };
}

function publishArgs(args: Args) {
  if (args.positional.length !== 2) throw usage('game publish <게임ID> <버전> --reason <까닭>');
  return { gameId: checkGameId(args.positional[0]), version: positiveInt(args.positional[1], 'version', '버전') };
}

function rollbackArgs(args: Args) {
  if (args.positional.length !== 1) throw usage('game rollback <게임ID> [--to <버전>] --reason <까닭>');
  const to = flag(args, 'to');
  return { gameId: checkGameId(args.positional[0]), to: to === undefined ? undefined : positiveInt(to, 'version', '버전') };
}

export function commands(db: Db, actor: string, env: GameEnv): Command[] {
  return [
    {
      name: 'game add',
      usage: 'game add <게임ID> --name <이름> [--description <설명>] [--sort <순서>] --reason <까닭> [--yes]',
      run: mutation(db, actor, {
        action: 'game.add',
        describe: (args) => {
          const a = addArgs(args);
          return `게임 ${a.id}(${a.name})을 draft로 추가해요`;
        },
        target: (args) => ({ ref: addArgs(args).id }),
        apply: (tx, args) => createGame(tx, addArgs(args)),
        report: () => '추가했어요 (draft). 내보내려면 버전을 올리고 game publish를 해요',
      }),
    },
    {
      name: 'game update',
      usage: 'game update <게임ID> [--name <이름>] [--description <설명>] [--sort <순서>] [--status draft|live|retired] [--icon <파일>] --reason <까닭> [--yes]',
      run: mutation(db, actor, {
        action: 'game.update',
        describe: (args) => {
          const a = updateArgs(args);
          const parts = Object.entries(a.patch)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => `${k}=${JSON.stringify(v)}`);
          if (a.icon !== undefined) parts.push(`icon=${a.icon}`);
          return `게임 ${a.id}을 고쳐요: ${parts.join(', ')}`;
        },
        target: (args) => ({ ref: updateArgs(args).id }),
        apply: async (tx, args) => {
          const a = updateArgs(args);
          if (a.icon === undefined) {
            await updateGame(tx, a.id, a.patch);
            return undefined;
          }
          // 아이콘 파일은 거절할 것을 다 거절한 뒤에 쓴다: 게임을 잠가 있는지 보고, 아이콘 말고 고칠 것을 먼저 고친다.
          // 그래야 거절된 명령이 assets/에 아무 게임에도 달리지 않은 파일을 남기지 않는다 (이름이 내용의 해시라
          // 다른 게임이 같은 파일을 쓰고 있을 수 있어서, 실패한 뒤에 지우는 방식은 쓰지 않는다)
          if (!(await lockGame(tx, a.id))) throw new RuleError(404, 'not_found', '없는 게임이에요');
          if (Object.values(a.patch).some((v) => v !== undefined)) await updateGame(tx, a.id, a.patch);
          const iconPath = await storeIcon(env.dataDir, a.icon);
          await updateGame(tx, a.id, { iconPath });
          return iconPath;
        },
        report: (iconPath) => (iconPath ? `고쳤어요. 아이콘: ${iconPath}` : '고쳤어요'),
      }),
    },
    {
      // 읽기만 한다: 까닭도 확인도 받지 않고 운영 기록도 남기지 않는다
      name: 'game list',
      usage: 'game list',
      run: async (args, io) => {
        if (args.positional.length > 0) throw usage('game list');
        const all = await readAllGames(db);
        if (all.length === 0) {
          io.out('게임이 없어요');
          return;
        }
        for (const g of all) {
          io.out(`${g.id}  ${g.status}  지금 버전 ${g.liveVersion?.version ?? '없음'}  순서 ${g.sortOrder}  ${g.name}${g.iconPath ? '' : '  (아이콘 없음)'}`);
          const versions = await readVersions(db, g.id);
          if (versions.length > 0) io.out(`  버전: ${versions.map((v) => `${v.version}(${v.status}, ${v.sizeBytes}B, shell ${v.minShellApi})`).join(' ')}`);
        }
      },
    },
    {
      name: 'game add-version',
      usage: 'game add-version <게임ID> <버전> --file <묶음.zip> --signature <base64> --min-shell-api <n> [--notes <메모>] --reason <까닭> [--yes]',
      run: mutation(db, actor, {
        action: 'game.add_version',
        describe: (args) => {
          const a = versionArgs(args);
          return `게임 ${a.gameId}의 버전 ${a.version}을 올려요 (파일 ${a.filePath}, min_shell_api ${a.minShellApi}). 서명을 확인한 뒤 uploaded로 넣어요`;
        },
        target: (args) => {
          const a = versionArgs(args);
          return { ref: `${a.gameId}@${a.version}` };
        },
        apply: (tx, args) => addVersion(tx, versionArgs(args), env),
        report: (r) => `올렸어요 (uploaded): 버전 ${r.version} · sha256 ${r.sha256} · ${r.sizeBytes}바이트. 내보내려면 game publish를 해요`,
      }),
    },
    {
      name: 'game publish',
      usage: 'game publish <게임ID> <버전> --reason <까닭> [--yes]',
      run: mutation(db, actor, {
        action: 'game.publish',
        describe: (args) => {
          const a = publishArgs(args);
          return `게임 ${a.gameId}의 지금 버전을 ${a.version}으로 내보내요`;
        },
        target: (args) => {
          const a = publishArgs(args);
          return { ref: `${a.gameId}@${a.version}` };
        },
        apply: async (tx, args) => {
          const a = publishArgs(args);
          await publish(tx, a.gameId, a.version);
          return a;
        },
        report: (a) => `${a.gameId}의 지금 버전: ${a.version}`,
      }),
    },
    {
      name: 'game rollback',
      usage: 'game rollback <게임ID> [--to <버전>] --reason <까닭> [--yes]',
      run: mutation(db, actor, {
        action: 'game.rollback',
        describe: (args) => {
          const a = rollbackArgs(args);
          return `게임 ${a.gameId}의 지금 버전을 거둬들이고 ${a.to === undefined ? '직전 live 버전' : `버전 ${a.to}`}으로 되돌려요`;
        },
        target: (args) => ({ ref: rollbackArgs(args).gameId }),
        apply: (tx, args) => {
          const a = rollbackArgs(args);
          return rollback(tx, a.gameId, a.to);
        },
        report: (r) => `되돌렸어요: ${r.from} → ${r.to} (${r.from}은 withdrawn)`,
      }),
    },
  ];
}
