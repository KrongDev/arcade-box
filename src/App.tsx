import { useEffect, useState } from 'react';
import { SaveProvider } from './game/SaveProvider';
import type { GameId } from './game/registry';
import { platform } from './platform';
import Breakout from './pages/Breakout';
import Home from './pages/Home';
import Leaderboard from './pages/Leaderboard';
import Minesweeper from './pages/Minesweeper';
import Pinball from './pages/Pinball';
import Settings from './pages/Settings';
import Shop from './pages/Shop';

type ScreenId = 'home' | 'shop' | 'settings' | 'leaderboard' | GameId;

function App() {
  const [screen, setScreen] = useState<ScreenId>('home');

  // 모든 화면이 세로 전용이라 앱 전체를 세로로 고정한다(폰을 가로로 돌려도 화면이 돌지 않게)
  useEffect(() => {
    platform.lockPortrait();
  }, []);
  // 지금 고른 게임 — 홈 오락기 화면·코인 표시·상점·순위표가 함께 쓴다
  const [game, setGame] = useState<GameId>('pinball');
  const goHome = () => setScreen('home');

  return (
    <SaveProvider>
      {screen === 'pinball' && <Pinball onExit={goHome} />}
      {screen === 'minesweeper' && <Minesweeper onExit={goHome} />}
      {screen === 'breakout' && <Breakout onExit={goHome} />}
      {screen === 'shop' && <Shop game={game} onGameChange={setGame} onExit={goHome} />}
      {screen === 'settings' && <Settings onExit={goHome} />}
      {screen === 'leaderboard' && <Leaderboard game={game} onExit={goHome} />}
      {screen === 'home' && (
        <Home
          game={game}
          onGameChange={setGame}
          onPlay={setScreen}
          onOpenShop={() => setScreen('shop')}
          onOpenSettings={() => setScreen('settings')}
          onOpenLeaderboard={() => setScreen('leaderboard')}
        />
      )}
    </SaveProvider>
  );
}

export default App;
