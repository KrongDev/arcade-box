import { RuleError } from '../errors.ts';

/** 명령 이름 뒤에 온 것: 자리 인자와 `--flag` */
export interface Args {
  positional: string[];
  flags: Record<string, string | true>;
}

/** 명령이 쓰는 입출력. 테스트는 가짜를 넣는다 */
export interface CliIo {
  out(line: string): void;
  /** 예/아니오를 묻는다 */
  confirm(question: string): Promise<boolean>;
}

export interface Command {
  /** 예: `config set`, `grant`. 낱말 사이는 빈칸 하나 */
  name: string;
  /** 쓰는 법 한 줄. 모르는 명령이 오면 이 줄들을 보여 준다 */
  usage: string;
  /**
   * 이 명령이 받는 flag의 이름 (`--` 없이, 예: `['reason', 'yes']`). 여기에 없는 flag가 오면 `runCli`가 실행하지 않고 거절한다:
   * 오타 난 flag(`--yse`, `--stauts`)를 조용히 넘기면 운영자가 뜻하지 않은 일을 한다.
   * 바꾸는 명령은 `reason`과 `yes`를 적고, 읽기만 하는 명령은 적지 않는다.
   */
  flags: readonly string[];
  run(args: Args, io: CliIo): Promise<void>;
}

/** 뒤에 무엇이 와도 값을 받지 않는 flag */
const VALUELESS = new Set(['yes']);

/**
 * 인자를 가른다.
 * - `--flag 값`, `--flag=값`: 값이 있는 flag
 * - `--yes`, 그리고 뒤에 값이 없는(끝이거나 다른 `--flag`가 오는) flag: 값 없는 flag (`true`)
 * - 그 밖은 자리 인자. `-300` 같은 음수도 자리 인자다
 *
 * 값이 `--`로 시작하면 flag로 읽히니 `--flag=값`으로 적는다 (예: `--reason=--yes가 필요해서`).
 */
export function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--') || token.length === 2) {
      positional.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    if (eq !== -1) {
      flags[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    const name = token.slice(2);
    const next = argv[i + 1];
    if (VALUELESS.has(name) || next === undefined || next.startsWith('--')) {
      flags[name] = true;
    } else {
      flags[name] = next;
      i++;
    }
  }
  return { positional, flags };
}

/**
 * 명령을 찾아 실행한다. 0은 성공, 1은 실패.
 * 명령 이름은 맨 앞에 온다 (`config set …`). 그 명령이 받지 않는 flag가 있으면 실행하지 않고 쓰는 법을 보여 준다.
 * `RuleError`는 메시지만, 그 밖의 오류는 스택까지 보여 준다.
 */
export async function runCli(argv: string[], commands: Command[], io: CliIo): Promise<number> {
  let found: Command | null = null;
  let used = 0;
  for (const command of commands) {
    const words = command.name.split(' ');
    if (words.length > used && words.every((word, i) => argv[i] === word)) {
      found = command;
      used = words.length;
    }
  }
  if (!found) {
    io.out(argv.length > 0 ? `모르는 명령이에요: ${argv.join(' ')}` : '명령을 적어 주세요.');
    io.out('쓸 수 있는 명령:');
    for (const command of commands) io.out(`  ${command.usage}`);
    return 1;
  }
  const args = parseArgs(argv.slice(used));
  const unknown = Object.keys(args.flags).filter((name) => !found.flags.includes(name));
  if (unknown.length > 0) {
    io.out(`모르는 flag예요: ${unknown.map((name) => `--${name}`).join(' ')}. 이렇게 써 주세요: ${found.usage}`);
    // 값이 `--`로 시작해서 flag로 읽힌 것일 수 있다 (`--reason --yes가 필요해서`). 값을 받지 못한 flag가 있으면 적는 법을 알려 준다
    for (const [name, value] of Object.entries(args.flags)) {
      if (value === true && !VALUELESS.has(name) && found.flags.includes(name)) io.out(`--${name}의 값이 --로 시작하면 --${name}=… 으로 적어요`);
    }
    return 1;
  }
  try {
    await found.run(args, io);
    return 0;
  } catch (err) {
    if (err instanceof RuleError) {
      io.out(err.message);
      return 1;
    }
    io.out(err instanceof Error ? (err.stack ?? String(err)) : String(err));
    // 스택에는 감싼 오류만 보인다. 속에 든 진짜 까닭(DB 연결 거부 등)도 한 줄씩 보여 준다
    let cause: unknown = err instanceof Error ? err.cause : undefined;
    for (let depth = 0; cause instanceof Error && depth < 5; depth++) {
      const code = (cause as { code?: unknown }).code;
      io.out(`까닭: ${[typeof code === 'string' ? code : '', cause.message].filter(Boolean).join(' ') || cause.name}`);
      cause = cause.cause;
    }
    return 1;
  }
}
