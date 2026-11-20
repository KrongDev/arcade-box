import { graniteEvent } from '@apps-in-toss/web-framework';
import { useCallback, useEffect, useState } from 'react';
import { ArcadeIcon } from '../components/ArcadeIcon';
import { ChevronLeft } from '../components/icons';
import { GAMES, getGame, type GameId } from '../game/registry';
import { API_BASE, api, type LeaderboardData } from '../game/api';
import { useSave } from '../game/save-context';
import { NAV_BAR_OFFSET, useSafeArea } from '../game/useSafeArea';
import '../styles/arcade.css';
import './Leaderboard.css';

type State = { kind: 'loading' } | { kind: 'ready'; data: LeaderboardData } | { kind: 'error' };

const MEDALS = ['medal1', 'medal2', 'medal3'] as const;

function formatValue(value: number): string {
  return `${value.toLocaleString()}점`;
}

export default function Leaderboard({ game, onExit }: { game: GameId; onExit: () => void }) {
  const insets = useSafeArea();
  const { save } = useSave();
  // 열린 게임의 순위표만 보여 준다
  const boards = GAMES.filter((g) => save.unlocked.includes(g.id)).flatMap((g) => g.boards);
  // 홈에서 고른 게임의 순위표부터 보여 준다
  const [board, setBoard] = useState<string>(() => getGame(game).boards.find((b) => boards.includes(b))?.id ?? boards[0].id);
  const scoreNote = GAMES.find((g) => g.boards.some((b) => b.id === board))?.scoreNote;
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    try {
      return graniteEvent.addEventListener('backEvent', { onEvent: onExit, onError: () => undefined });
    } catch {
      return undefined;
    }
  }, [onExit]);

  useEffect(() => {
    if (!API_BASE) return;
    let alive = true;
    api
      .leaderboard(board)
      .then((data) => alive && setState({ kind: 'ready', data }))
      .catch(() => alive && setState({ kind: 'error' }));
    return () => {
      alive = false;
    };
  }, [board, reload]);

  const choose = useCallback((id: string) => {
    setState({ kind: 'loading' });
    setBoard(id);
  }, []);

  const retry = () => {
    setState({ kind: 'loading' });
    setReload((n) => n + 1);
  };

  return (
    <main className="board ab-page" style={{ paddingTop: insets.top + NAV_BAR_OFFSET, paddingBottom: insets.bottom + 24 }}>
      <header className="board-header">
        <div className="ab-head">
          <button type="button" className="ab-icon-btn" aria-label="홈으로" onClick={onExit}>
            <ChevronLeft size={22} />
          </button>
          <h1 className="ab-plate">
            <span className="ab-stripe">순위표</span>
          </h1>
        </div>
        <p className="board-subtitle">{scoreNote ? `${scoreNote}. 순위는 익명 이름으로 보여요` : '순위는 익명 이름으로 보여요'}</p>
      </header>

      <div className="ab-tabs board-tabs" role="tablist" aria-label="순위표 종류">
        {boards.map((b) => (
          <button
            key={b.id}
            type="button"
            role="tab"
            aria-selected={b.id === board}
            className={b.id === board ? 'ab-tab is-active' : 'ab-tab'}
            onClick={() => choose(b.id)}
          >
            {b.label}
          </button>
        ))}
      </div>

      {!API_BASE && <p className="board-empty">순위표는 서버에 연결된 버전에서 볼 수 있어요.</p>}

      {API_BASE && state.kind === 'loading' && <p className="board-empty">불러오는 중이에요</p>}

      {API_BASE && state.kind === 'error' && (
        <div className="board-empty-box">
          <ArcadeIcon name="signal" size={48} className="board-empty-emoji" />
          <p className="board-empty">순위표를 불러오지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.</p>
          <button type="button" className="ab-btn ab-btn--sm ab-btn--ghost board-secondary-button" onClick={retry}>
            다시 불러오기
          </button>
        </div>
      )}

      {API_BASE && state.kind === 'ready' && (
        <>
          <section className="board-me" aria-label="내 순위">
            {state.data.me ? (
              <>
                <p className="board-me-rank">{state.data.me.rank.toLocaleString()}위</p>
                <p className="board-me-value">내 기록 {formatValue(state.data.me.value)}</p>
              </>
            ) : (
              <p className="board-me-value">아직 기록이 없어요. 한 판 해 보면 순위에 올라가요.</p>
            )}
          </section>

          {state.data.entries.length === 0 ? (
            <div className="board-empty-box">
              <ArcadeIcon name="trophy" size={48} className="board-empty-emoji" />
              <p className="board-empty">아직 아무도 기록을 남기지 않았어요</p>
            </div>
          ) : (
            <>
            {/* 1~3위 시상대: 2위 · 1위 · 3위 순서로 놓는다 */}
            <ol className="board-podium" aria-label="1위부터 3위">
              {[1, 0, 2]
                .map((k) => state.data.entries[k])
                .filter((e): e is LeaderboardData['entries'][number] => e !== undefined)
                .map((e) => (
                  <li key={`p-${e.rank}-${e.player}`} className={`podium-step is-rank-${e.rank}${e.me ? ' is-me' : ''}`}>
                    <ArcadeIcon name={MEDALS[e.rank - 1]} size={32} className="podium-medal" />
                    <span className="podium-player">{e.me ? `${e.player} (나)` : e.player}</span>
                    <span className="podium-value">{formatValue(e.value)}</span>
                    <span className="podium-base" aria-hidden="true">
                      {e.rank}
                    </span>
                  </li>
                ))}
            </ol>
            <ol className="board-list" start={4}>
              {state.data.entries.slice(3).map((e) => (
                <li key={`${e.rank}-${e.player}`} className={e.me ? 'board-row is-me' : 'board-row'}>
                  <span className="board-rank">
                    {e.rank <= 3 ? <ArcadeIcon name={MEDALS[e.rank - 1]} size={32} label={`${e.rank}위`} /> : e.rank}
                  </span>
                  <span className="board-player">{e.me ? `${e.player} (나)` : e.player}</span>
                  <span className="board-value">{formatValue(e.value)}</span>
                </li>
              ))}
            </ol>
            </>
          )}
        </>
      )}

      <button type="button" className="ab-btn ab-btn--ghost ab-btn--block board-home-button" onClick={onExit}>
        홈으로
      </button>
    </main>
  );
}
