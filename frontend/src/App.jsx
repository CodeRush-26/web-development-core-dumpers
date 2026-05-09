import { useState } from 'react';
import CommandView from './pages/CommandView.jsx';
import CaptainView from './pages/CaptainView.jsx';

export default function App() {
  const [view, setView] = useState('command');

  return (
    <>
      {/* View switcher — fixed top-right overlay */}
      <div className="fixed top-0 right-0 z-[9999] flex" style={{ gap: 0 }}>
        <button
          id="nav-command"
          onClick={() => setView('command')}
          className={`px-3 py-1 font-display text-xs tracking-widest border-b border-l transition-all ${
            view === 'command'
              ? 'bg-accent/20 text-accent border-accent'
              : 'bg-panel/80 text-text-mute border-border hover:text-text'
          }`}
        >
          ◈ COMMAND
        </button>
        <button
          id="nav-captain"
          onClick={() => setView('captain')}
          className={`px-3 py-1 font-display text-xs tracking-widest border-b border-l transition-all ${
            view === 'captain'
              ? 'bg-warn/20 text-warn border-warn'
              : 'bg-panel/80 text-text-mute border-border hover:text-text'
          }`}
        >
          ⚓ CAPTAIN
        </button>
      </div>

      {view === 'command' ? <CommandView /> : <CaptainView />}
    </>
  );
}
