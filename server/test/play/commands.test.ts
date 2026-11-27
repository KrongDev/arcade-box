import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adminActions } from '../../src/admin/schema.ts';
import { commands, listBoards, updateBoard } from '../../src/play/index.ts';
import { boards } from '../../src/play/schema.ts';
import { runCli } from '../../src/shared/cli/index.ts';
import type { Db } from '../../src/shared/db/index.ts';
import { loginGuest } from '../account/helpers.ts';
import { fakeIo } from '../helpers/cli.ts';
import { testDb } from '../helpers/db.ts';
import { MS, NOW, own, rule, seedPlay, send } from './helpers.ts';

const ACTOR = 'ops-kim';

async function run(db: Db, argv: string[], answer = true) {
  const io = fakeIo(answer);
  const code = await runCli(argv, commands(db, ACTOR), io);
  return { code, text: io.text(), questions: io.questions };
}

const actions = (db: Db) => db.select().from(adminActions).orderBy(adminActions.id);
const boardRows = (db: Db) => db.select().from(boards).orderBy(boards.id);

async function setup(): Promise<{ db: Db; close(): Promise<void> }> {
  const kit = await testDb();
  await seedPlay(kit.db);
  return kit;
}

test('board add는 순위표를 만들고 admin_actions에 남는다', async () => {
  const { db, close } = await setup();
  try {
    const before = (await boardRows(db)).length;
    const out = await run(db, ['board', 'add', 'breakout.daily', '--game', 'breakout', '--label', '오늘의 벽돌', '--ordering', 'higher', '--min', '0', '--max', '900000', '--max-coins', '120', '--sort', '2', '--reason', '새 순위표', '--yes']);
    assert.equal(out.code, 0, out.text);
    const [row] = (await boardRows(db)).filter((b) => b.id === 'breakout.daily');
    assert.deepEqual(
      { gameId: row.gameId, label: row.label, ordering: row.ordering, min: row.minValue, max: row.maxValue, coins: row.maxCoinsPerRun, requires: row.requiresBoardId, validator: row.validator, params: row.validatorParams, sort: row.sortOrder },
      { gameId: 'breakout', label: '오늘의 벽돌', ordering: 'higher', min: 0, max: 900000, coins: 120, requires: null, validator: 'caps', params: null, sort: 2 },
      '검증기를 적지 않으면 caps다',
    );
    assert.equal((await boardRows(db)).length, before + 1);
    const acts = await actions(db);
    assert.equal(acts.length, 1);
    assert.deepEqual({ actor: acts[0].actor, action: acts[0].action, targetRef: acts[0].targetRef, reason: acts[0].reason }, { actor: ACTOR, action: 'board.add', targetRef: 'breakout.daily', reason: '새 순위표' });
    assert.match(out.text, new RegExp(`운영 기록 #${acts[0].id}`));

    // 서버 배포 없이 바로 판 결과를 받는다
    const me = await loginGuest(db, NOW);
    await own(db, me.userId, 'breakout');
    assert.equal((await send(db, me.userId, { boardId: 'breakout.daily', score: 900000, coins: 120 }, NOW)).balance, 120);
    await assert.rejects(send(db, me.userId, { boardId: 'breakout.daily', score: 900001, coins: 0 }, new Date(NOW.getTime() + 5000)), rule(400, 'invalid_score'));

    // 지뢰찾기 검증기와 앞 단계가 있는 순위표
    const ms = await run(db, [
      'board', 'add', 'minesweeper.expert', '--game', 'minesweeper', '--label', '달인', '--ordering', 'higher', '--min', '0', '--max', '5000000', '--max-coins', '300',
      '--requires', 'minesweeper.hard', '--validator', 'minesweeper', '--params', '{"safe":480,"mines":120,"par":1200}', '--reason', '달인 단계', '--yes',
    ]);
    assert.equal(ms.code, 0, ms.text);
    const expert = (await listBoards(db, 'minesweeper')).find((b) => b.id === 'minesweeper.expert')!;
    assert.deepEqual([expert.requiresBoardId, expert.validator, expert.validatorParams], ['minesweeper.hard', 'minesweeper', { safe: 480, mines: 120, par: 1200 }]);

    // 확인에서 그만두면 아무것도 바뀌지 않는다. 까닭이 없으면 묻지도 않는다
    const no = await run(db, ['board', 'add', 'pinball.daily', '--game', 'pinball', '--label', '오늘', '--ordering', 'higher', '--min', '0', '--max', '10', '--max-coins', '1', '--reason', '시험'], false);
    assert.equal(no.code, 1);
    assert.equal(no.questions.length, 1);
    const noReason = await run(db, ['board', 'add', 'pinball.daily', '--game', 'pinball', '--label', '오늘', '--ordering', 'higher', '--min', '0', '--max', '10', '--max-coins', '1', '--yes']);
    assert.equal(noReason.code, 1);
    assert.match(noReason.text, /--reason/);
    assert.equal((await actions(db)).length, 2);
    assert.equal((await boardRows(db)).some((b) => b.id === 'pinball.daily'), false);
  } finally {
    await close();
  }
});

test('board add: 틀린 인자는 확인을 묻기 전에 거절하고 아무것도 남기지 않는다', async () => {
  const { db, close } = await setup();
  try {
    const base = ['--game', 'pinball', '--label', '새 순위표', '--ordering', 'higher', '--min', '0', '--max', '100', '--max-coins', '10', '--reason', '시험'];
    const replace = (flag: string, value: string | null) => {
      const out = [...base];
      const i = out.indexOf(flag);
      if (value === null) out.splice(i, 2);
      else out[i + 1] = value;
      return out;
    };
    const bad: Array<[string, string[]]> = [
      ['ID 모양', ['board', 'add', 'Pinball.New', ...base]],
      ['ID에 경로', ['board', 'add', '../x', ...base]],
      ['ID 없음', ['board', 'add', ...base]],
      ['게임 없음', ['board', 'add', 'pinball.new', ...replace('--game', null)]],
      ['게임 ID 모양', ['board', 'add', 'pinball.new', ...replace('--game', '../pinball')]],
      ['이름 없음', ['board', 'add', 'pinball.new', ...replace('--label', null)]],
      ['이름이 너무 김', ['board', 'add', 'pinball.new', ...replace('--label', '가'.repeat(61))]],
      ['이름에 줄바꿈', ['board', 'add', 'pinball.new', ...replace('--label', '두\n줄')]],
      ['ordering', ['board', 'add', 'pinball.new', ...replace('--ordering', 'biggest')]],
      ['min이 숫자가 아님', ['board', 'add', 'pinball.new', ...replace('--min', 'abc')]],
      ['min이 NaN', ['board', 'add', 'pinball.new', ...replace('--min', 'NaN')]],
      ['max가 무한대', ['board', 'add', 'pinball.new', ...replace('--max', 'Infinity')]],
      ['min > max', ['board', 'add', 'pinball.new', ...replace('--min', '101')]],
      ['코인이 음수', ['board', 'add', 'pinball.new', ...replace('--max-coins', '-1')]],
      ['코인이 소수', ['board', 'add', 'pinball.new', ...replace('--max-coins', '1.5')]],
      ['코인이 너무 큼', ['board', 'add', 'pinball.new', ...replace('--max-coins', '99999999999')]],
      ['모르는 검증기', ['board', 'add', 'pinball.new', ...base, '--validator', 'tetris']],
      ['지뢰찾기인데 판 크기 없음', ['board', 'add', 'pinball.new', ...base, '--validator', 'minesweeper']],
      ['판 크기가 깨진 JSON', ['board', 'add', 'pinball.new', ...base, '--validator', 'minesweeper', '--params', '{safe:70}']],
      ['판 크기가 틀림', ['board', 'add', 'pinball.new', ...base, '--validator', 'minesweeper', '--params', '{"safe":70,"mines":10}']],
      ['caps에 설정을 줌', ['board', 'add', 'pinball.new', ...base, '--params', '{"safe":70,"mines":10,"par":180}']],
      ['순서가 음수', ['board', 'add', 'pinball.new', ...base, '--sort', '-1']],
      ['자기 자신을 요구', ['board', 'add', 'pinball.new', ...base, '--requires', 'pinball.new']],
    ];
    for (const [why, argv] of bad) {
      const out = await run(db, argv);
      assert.equal(out.code, 1, why);
      assert.deepEqual(out.questions, [], `${why}: 확인을 묻기 전에 거절한다`);
    }
    // DB를 봐야 아는 것은 확인 뒤에 거절하지만 아무것도 남기지 않는다: 없는 게임, 없는 앞 단계, 다른 게임의 앞 단계, 이미 있는 ID
    const late: Array<[string, string[], RegExp]> = [
      ['없는 게임', ['board', 'add', 'tetris.main', ...replace('--game', 'tetris'), '--yes'], /없는 게임/],
      ['없는 앞 단계', ['board', 'add', 'pinball.new', ...base, '--requires', 'pinball.none', '--yes'], /없는 순위표/],
      ['다른 게임의 앞 단계', ['board', 'add', 'pinball.new', ...base, '--requires', 'minesweeper.easy', '--yes'], /같은 게임/],
      ['이미 있는 ID', ['board', 'add', 'pinball', ...base, '--yes'], /이미 있/],
    ];
    for (const [why, argv, message] of late) {
      const out = await run(db, argv);
      assert.equal(out.code, 1, why);
      assert.match(out.text, message, why);
    }
    assert.deepEqual(await actions(db), [], '거절된 명령은 운영 기록을 남기지 않는다');
    assert.equal((await boardRows(db)).length, 6);
  } finally {
    await close();
  }
});

test('board update는 적은 것만 고치고 admin_actions에 남는다', async () => {
  const { db, close } = await setup();
  try {
    const row = async (id: string) => (await boardRows(db)).find((b) => b.id === id)!;
    const out = await run(db, ['board', 'update', 'pinball', '--max-coins', '500', '--label', '핀볼 점수', '--reason', '코인 상한 조정', '--yes']);
    assert.equal(out.code, 0, out.text);
    const pinball = await row('pinball');
    assert.deepEqual([pinball.label, pinball.maxCoinsPerRun, pinball.minValue, pinball.maxValue, pinball.validator, pinball.sortOrder], ['핀볼 점수', 500, 0, 5_000_000, 'caps', 0]);
    const acts = await actions(db);
    assert.deepEqual([acts[0].action, acts[0].targetRef, acts[0].reason], ['board.update', 'pinball', '코인 상한 조정']);

    // 바뀐 상한이 바로 판 결과에 쓰인다
    const me = await loginGuest(db, NOW);
    assert.equal((await send(db, me.userId, { boardId: 'pinball', score: 1, coins: 500 }, NOW)).balance, 500);

    // 앞 단계를 떼고(none) 붙인다
    assert.equal((await run(db, ['board', 'update', 'minesweeper.hard', '--requires', 'none', '--reason', '고급을 엶', '--yes'])).code, 0);
    assert.equal((await row('minesweeper.hard')).requiresBoardId, null);
    assert.equal((await run(db, ['board', 'update', 'minesweeper.hard', '--requires', 'minesweeper.easy', '--reason', '초급만 깨면', '--yes'])).code, 0);
    assert.equal((await row('minesweeper.hard')).requiresBoardId, 'minesweeper.easy');
    // 판 크기만 바꾼다
    assert.equal((await run(db, ['board', 'update', 'minesweeper.easy', '--params', '{"safe":71,"mines":9,"par":180}', '--reason', '판 크기', '--yes'])).code, 0);
    assert.deepEqual((await row('minesweeper.easy')).validatorParams, { safe: 71, mines: 9, par: 180 });
    // 검증기를 caps로 바꾸면 설정도 함께 비운다 (중급은 이제 아무도 앞 단계로 두지 않는다)
    assert.equal((await run(db, ['board', 'update', 'minesweeper.normal', '--validator', 'caps', '--params', 'none', '--reason', '범위만', '--yes'])).code, 0);
    assert.deepEqual([(await row('minesweeper.normal')).validator, (await row('minesweeper.normal')).validatorParams], ['caps', null]);
    assert.equal((await actions(db)).length, 5);

    const bad: Array<[string, string[]]> = [
      ['고칠 것이 없음', ['board', 'update', 'pinball', '--reason', 'x', '--yes']],
      ['없는 순위표', ['board', 'update', 'nope', '--label', 'x', '--reason', 'x', '--yes']],
      ['min이 지금 max보다 큼', ['board', 'update', 'pinball', '--min', '5000001', '--reason', 'x', '--yes']],
      ['max가 지금 min보다 작음', ['board', 'update', 'pinball', '--max', '-1', '--reason', 'x', '--yes']],
      ['모르는 검증기', ['board', 'update', 'pinball', '--validator', 'tetris', '--reason', 'x', '--yes']],
      ['지금 설정과 맞지 않는 검증기', ['board', 'update', 'pinball', '--validator', 'minesweeper', '--reason', 'x', '--yes']],
      ['caps에 설정', ['board', 'update', 'pinball', '--params', '{"safe":1,"mines":1,"par":1}', '--reason', 'x', '--yes']],
      ['자기 자신을 요구', ['board', 'update', 'minesweeper.easy', '--requires', 'minesweeper.easy', '--reason', 'x', '--yes']],
      ['돌고 도는 앞 단계 (easy → hard → easy)', ['board', 'update', 'minesweeper.easy', '--requires', 'minesweeper.hard', '--reason', 'x', '--yes']],
      ['다른 게임의 앞 단계', ['board', 'update', 'pinball', '--requires', 'minesweeper.easy', '--reason', 'x', '--yes']],
      ['없는 앞 단계', ['board', 'update', 'pinball', '--requires', 'pinball.none', '--reason', 'x', '--yes']],
      ['순서(ordering)는 못 바꿈', ['board', 'update', 'pinball', '--ordering', 'lower', '--reason', 'x', '--yes']],
      ['게임은 못 바꿈', ['board', 'update', 'pinball', '--game', 'breakout', '--reason', 'x', '--yes']],
    ];
    for (const [why, argv] of bad) assert.equal((await run(db, argv)).code, 1, why);
    // 못 바꾸는 칸은 다른 것과 함께 적어도 조용히 버리지 않고 통째로 거절한다
    for (const fixed of [['--ordering', 'lower'], ['--game', 'breakout']]) {
      const out = await run(db, ['board', 'update', 'pinball', ...fixed, '--label', '몰래 바꾼 이름', '--reason', 'x', '--yes']);
      assert.equal(out.code, 1, fixed[0]);
      assert.match(out.text, /바꿀 수 없어요/, fixed[0]);
      assert.deepEqual(out.questions, []);
    }
    assert.equal((await row('pinball')).label, '핀볼 점수', '이름도 바뀌지 않았다');
    await assert.rejects(db.transaction((tx) => updateBoard(tx, 'pinball', { label: 'x', ordering: 'lower' } as never)), rule(400, 'not_updatable'));
    await assert.rejects(db.transaction((tx) => updateBoard(tx, 'pinball', { label: 'x', gameId: 'breakout' } as never)), rule(400, 'not_updatable'));
    assert.equal((await actions(db)).length, 5, '거절된 명령은 운영 기록을 남기지 않는다');
    assert.deepEqual([(await row('pinball')).minValue, (await row('pinball')).maxValue, (await row('pinball')).ordering, (await row('pinball')).gameId], [0, 5_000_000, 'higher', 'pinball']);
  } finally {
    await close();
  }
});

test('board list는 읽기만 하고 운영 기록을 남기지 않는다', async () => {
  const { db, close } = await setup();
  try {
    const all = await run(db, ['board', 'list']);
    assert.equal(all.code, 0, all.text);
    for (const id of ['pinball', 'pinball.sprint', 'breakout', 'minesweeper.easy', 'minesweeper.normal', 'minesweeper.hard']) assert.match(all.text, new RegExp(`(^|\\n)${id.replace('.', '\\.')}\\s`), id);
    assert.match(all.text, /minesweeper\.normal.*minesweeper\.easy/, '앞 단계가 보인다');
    assert.match(all.text, new RegExp(`minesweeper\\.hard.*"safe":${MS.hard.safe}`), '판 크기가 보인다');

    const one = await run(db, ['board', 'list', 'minesweeper']);
    assert.equal(one.code, 0);
    assert.equal(one.text.split('\n').length, 3);
    assert.doesNotMatch(one.text, /pinball/);
    assert.match((await run(db, ['board', 'list', 'tetris'])).text, /순위표가 없어요/);
    assert.equal((await run(db, ['board', 'list', '../x'])).code, 1);
    assert.deepEqual(await actions(db), []);
    assert.deepEqual(all.questions, [], '확인을 묻지 않는다');
  } finally {
    await close();
  }
});

test('앞 단계는 깰 수 있는 순위표여야 한다: 깰 수 없는 순위표를 앞 단계로 두면 그 단계가 영영 열리지 않는다', async () => {
  const { db, close } = await setup();
  try {
    const row = async (id: string) => (await boardRows(db)).find((b) => b.id === id);
    const add = (id: string, requires: string, more: string[] = []) =>
      run(db, ['board', 'add', id, '--game', 'pinball', '--label', '2단계', '--ordering', 'higher', '--min', '0', '--max', '100', '--max-coins', '10', '--requires', requires, ...more, '--reason', '단계', '--yes']);

    // 점수만 재는 순위표(caps·higher)에는 "깬다"가 없다: 앞 단계로 둘 수 없다
    const stuck = await add('pinball.stage2', 'pinball');
    assert.equal(stuck.code, 1);
    assert.match(stuck.text, /깰 수 있는 순위표/);
    assert.equal(await row('pinball.stage2'), undefined);
    await assert.rejects(
      db.transaction((tx) => updateBoard(tx, 'breakout', { requiresBoardId: 'breakout' })),
      rule(400, 'invalid_requires'),
    );
    const viaUpdate = await run(db, ['board', 'update', 'pinball.sprint', '--requires', 'pinball', '--reason', 'x', '--yes']);
    assert.equal(viaUpdate.code, 1);
    assert.match(viaUpdate.text, /깰 수 있는 순위표/);

    // 시간 순위표(caps·lower)와 지뢰찾기는 깰 수 있다: 깨면 다음 단계가 열린다
    assert.equal((await add('pinball.stage2', 'pinball.sprint')).code, 0);
    const me = await loginGuest(db, NOW);
    await assert.rejects(send(db, me.userId, { boardId: 'pinball.stage2', score: 1, coins: 0 }, NOW), rule(403, 'stage_locked'));
    await send(db, me.userId, { boardId: 'pinball.sprint', won: true, seconds: 30, coins: 0 }, NOW);
    assert.equal((await send(db, me.userId, { boardId: 'pinball.stage2', score: 1, coins: 0 }, new Date(NOW.getTime() + 5000))).recordValue, 1);

    // 다른 순위표가 앞 단계로 둔 순위표는 깰 수 없는 검증기로 바꿀 수 없다 (뒤 단계가 막힌다)
    const toCaps = await run(db, ['board', 'update', 'minesweeper.easy', '--validator', 'caps', '--params', 'none', '--reason', 'x', '--yes']);
    assert.equal(toCaps.code, 1);
    assert.match(toCaps.text, /minesweeper\.normal/, '어느 순위표가 막히는지 알려 준다');
    assert.equal((await row('minesweeper.easy'))?.validator, 'minesweeper');
    await assert.rejects(db.transaction((tx) => updateBoard(tx, 'minesweeper.normal', { validator: 'caps', validatorParams: null })), rule(409, 'required_by_boards'));
    // 아무도 앞 단계로 두지 않은 순위표와, 깰 수 있는 채로 남는 변경은 된다
    assert.equal((await run(db, ['board', 'update', 'minesweeper.hard', '--validator', 'caps', '--params', 'none', '--reason', 'x', '--yes'])).code, 0);
    assert.equal((await run(db, ['board', 'update', 'minesweeper.easy', '--params', '{"safe":71,"mines":9,"par":180}', '--reason', 'x', '--yes'])).code, 0);
    assert.equal((await run(db, ['board', 'update', 'pinball.sprint', '--max', '3600', '--reason', 'x', '--yes'])).code, 0);
  } finally {
    await close();
  }
});
