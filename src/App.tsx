import { useState } from 'react';
import { SaveProvider } from './game/SaveProvider';
import type { GameId } from './game/registry';
import Home from './pages/Home';
import Leaderboard from './pages/Leaderboard';
import Minesweeper from './pages/Minesweeper';
import Pinball from './pages/Pinball';
import Settings from './pages/Settings';
import Shop from './pages/Shop';

type Screen = 'home' | 'shop' | 'settings' | 'leaderboard' | GameId;

function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const goHome = () => setScreen('home');

  return (
    <SaveProvider>
      {screen === 'pinball' && <Pinball onExit={goHome} />}
      {screen === 'minesweeper' && <Minesweeper onExit={goHome} />}
      {screen === 'shop' && <Shop onExit={goHome} />}
      {screen === 'settings' && <Settings onExit={goHome} />}
      {screen === 'leaderboard' && <Leaderboard onExit={goHome} />}
      {screen === 'home' && (
        <Home
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
