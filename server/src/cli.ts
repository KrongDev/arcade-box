/**
 * 운영 명령줄 도구. 서버 컨테이너 안에서 `node src/cli.ts <명령>`으로 실행한다 (스펙 5.11).
 * 도메인마다 내놓는 명령(`commands`)을 모아 등록한다. HTTP로 여는 관리 기능은 없다.
 */
import { userInfo } from 'node:os';
import { createInterface } from 'node:readline';
import { commands as adminCommands } from './admin/index.ts';
import { commands as entitlementCommands } from './entitlement/index.ts';
import { commands as gameCommands } from './game/index.ts';
import { commands as orderCommands } from './order/index.ts';
import { commands as playCommands } from './play/index.ts';
import { commands as productCommands } from './product/index.ts';
import { seedCommand } from './seed.ts';
import { runCli, type CliIo, type Command } from './shared/cli/index.ts';
import { loadConfig } from './shared/config.ts';
import { connectPg } from './shared/db/index.ts';
import { commands as viewCommands } from './view/index.ts';
import { commands as walletCommands } from './wallet/index.ts';

/** 운영 기록에 남는 "누가": ADMIN_ACTOR, 없으면 OS 사용자 이름 */
function actorName(): string {
  if (process.env.ADMIN_ACTOR) return process.env.ADMIN_ACTOR;
  try {
    return userInfo().username;
  } catch {
    return 'unknown';
  }
}

const io: CliIo = {
  out: (line) => console.log(line),
  /** y, yes, 예, 네만 "예"다. 입력이 끊기면(터미널이 아닌 곳에서 --yes 없이 부름) "아니오"다 */
  confirm: (question) =>
    new Promise((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      let answered = false;
      rl.on('close', () => {
        if (!answered) resolve(false);
      });
      rl.question(`${question} (y/N) `, (answer) => {
        answered = true;
        rl.close();
        resolve(/^(y|yes|예|네)$/i.test(answer.trim()));
      });
    }),
};

let code = 1;
try {
  const config = loadConfig();
  const { db, close } = connectPg(config.databaseUrl);
  try {
    const actor = actorName();
    const commands: Command[] = [
      ...adminCommands(db, actor),
      ...walletCommands(db, actor),
      ...gameCommands(db, actor, { dataDir: config.dataDir, publicKey: config.bundlePublicKey }),
      ...productCommands(db, actor, { dataDir: config.dataDir }),
      ...entitlementCommands(db, actor),
      ...playCommands(db, actor),
      ...orderCommands(db, actor),
      ...viewCommands(db),
      seedCommand(db, actor),
    ];
    code = await runCli(process.argv.slice(2), commands, io);
  } finally {
    await close();
  }
} catch (err) {
  // 설정이 틀렸을 때 (DATABASE_URL 없음 등). 메시지만 보여 준다
  console.error(err instanceof Error ? err.message : String(err));
}
process.exitCode = code;
