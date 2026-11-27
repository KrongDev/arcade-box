/**
 * 명령줄 도구가 등록하는 모든 명령 (스펙 5.11). 도메인마다 내놓는 명령(`commands`)을 모은다.
 * `cli.ts`가 이것으로 실행하고, 테스트가 같은 목록으로 "모든 명령이 받는 flag를 적어 두었는지"를 본다.
 */
import { commands as adminCommands } from './admin/index.ts';
import { commands as entitlementCommands } from './entitlement/index.ts';
import { commands as gameCommands } from './game/index.ts';
import { commands as orderCommands } from './order/index.ts';
import { commands as playCommands } from './play/index.ts';
import { commands as productCommands } from './product/index.ts';
import { seedCommand } from './seed.ts';
import type { Command } from './shared/cli/index.ts';
import type { Config } from './shared/config.ts';
import type { Db } from './shared/db/index.ts';
import { commands as viewCommands } from './view/index.ts';
import { commands as walletCommands } from './wallet/index.ts';

/** `actor`는 운영 기록에 남는 "누가"다. `env`는 묶음·아이콘을 두는 곳과 묶음 서명의 공개 키 */
export function allCommands(db: Db, actor: string, env: Pick<Config, 'dataDir' | 'bundlePublicKey'>): Command[] {
  return [
    ...adminCommands(db, actor),
    ...walletCommands(db, actor),
    ...gameCommands(db, actor, { dataDir: env.dataDir, publicKey: env.bundlePublicKey }),
    ...productCommands(db, actor, { dataDir: env.dataDir }),
    ...entitlementCommands(db, actor),
    ...playCommands(db, actor),
    ...orderCommands(db, actor),
    ...viewCommands(db),
    seedCommand(db, actor),
  ];
}
