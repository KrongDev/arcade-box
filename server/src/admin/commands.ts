import type { Args, Command } from '../shared/cli/index.ts';
import type { Db } from '../shared/db/index.ts';
import { RuleError } from '../shared/errors.ts';
import { CONFIG_DEFAULTS, getNumber, isConfigKey, mutation, setNumber, type ConfigKey } from './service.ts';

const KEYS = Object.keys(CONFIG_DEFAULTS) as ConfigKey[];

function configKey(name: string | undefined): ConfigKey {
  if (name === undefined || !isConfigKey(name)) {
    throw new RuleError(400, 'unknown_config', `모르는 설정이에요: ${name ?? '(없음)'}. 쓸 수 있는 이름은 ${KEYS.join(', ')}이에요`);
  }
  return name;
}

/** `config set <key> <value>`의 인자. 값은 숫자만 적은 글이어야 한다 (1e3, 1.5, -1은 받지 않는다) */
function setArgs(args: Args): { key: ConfigKey; value: number } {
  if (args.positional.length !== 2) throw new RuleError(400, 'invalid_args', '이렇게 써 주세요: config set <key> <value> --reason <까닭>');
  const key = configKey(args.positional[0]);
  const text = args.positional[1];
  const value = Number(text);
  if (!/^\d{1,6}$/.test(text) || value > 100_000) throw new RuleError(400, 'invalid_value', '설정값은 0~100,000의 정수여야 해요');
  return { key, value };
}

export function commands(db: Db, actor: string): Command[] {
  return [
    {
      name: 'config get',
      usage: 'config get [key]',
      run: async (args, io) => {
        const keys = args.positional.length > 0 ? [configKey(args.positional[0])] : KEYS;
        for (const key of keys) io.out(`${key} = ${await getNumber(db, key)}`);
      },
    },
    {
      name: 'config set',
      usage: 'config set <key> <value> --reason <까닭> [--yes]',
      run: mutation(db, actor, {
        action: 'config.set',
        describe: (args) => {
          const { key, value } = setArgs(args);
          return `설정을 바꿔요: ${key} = ${value}`;
        },
        target: (args) => ({ ref: setArgs(args).key }),
        apply: async (tx, args) => {
          const { key, value } = setArgs(args);
          const before = await getNumber(tx, key);
          await setNumber(tx, key, value);
          return { key, before, value };
        },
        report: (r) => `${r.key}: ${r.before} → ${r.value}`,
      }),
    },
  ];
}
