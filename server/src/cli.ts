/**
 * 운영 명령줄 도구. 서버 컨테이너 안에서 `node src/cli.ts <명령>`으로 실행한다 (스펙 5.11).
 * 도메인마다 내놓는 명령을 모은 것(`commands.ts`의 `allCommands`)을 등록한다. HTTP로 여는 관리 기능은 없다.
 */
import { userInfo } from 'node:os';
import { createInterface } from 'node:readline';
import { allCommands } from './commands.ts';
import { runCli, type CliIo } from './shared/cli/index.ts';
import { loadConfig } from './shared/config.ts';
import { connectPg, isMigrated } from './shared/db/index.ts';
import { safeMessage } from './shared/errors.ts';

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
  const { db, close } = connectPg(config.databaseUrl, config.dbTimeouts);
  try {
    // 명령줄은 마이그레이션을 하지 않는다 (서버가 뜰 때 한다). 서버를 한 번도 띄우지 않은 DB면 쿼리 오류 대신 할 일을 알려 준다
    if (!(await isMigrated(db))) {
      throw new Error('DB에 아직 테이블이 없어요. 서버를 먼저 한 번 띄워 마이그레이션을 적용한 뒤 다시 실행해 주세요');
    }
    code = await runCli(process.argv.slice(2), allCommands(db, actorName(), config), io);
  } finally {
    await close();
  }
} catch (err) {
  // 설정이 틀렸거나 DB에 닿지 못했을 때 (DATABASE_URL 없음, 마이그레이션 전 등). 메시지만 보여 준다 (쿼리와 넣은 값은 빼고)
  console.error(safeMessage(err));
}
process.exitCode = code;
