import { useState, useEffect, useRef } from 'react';
import { API_BASE } from '../config.js';

export default function PlaybackPanel() {
  const [snapshots, setSnapshots]   = useState([]);
  const [playing, setPlaying]       = useState(false);
  const [index, setIndex]           = useState(0);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [speed, setSpeed]           = useState(1);
  const intervalRef                 = useRef(null);

  const loadSnapshots = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${API_BASE}/history/snapshots?limit=200`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setSnapshots(data.snapshots || []);
      setIndex(0);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (playing && snapshots.length > 0) {
      intervalRef.current = setInterval(() => {
        setIndex(prev => {
          if (prev >= snapshots.length - 1) {
            setPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 1000 / speed);
    }
    return () => clearInterval(intervalRef.current);
  }, [playing, snapshots.length, speed]);

  const current = snapshots[index];

  return (
    <div className="flex flex-col h-full panel">
      <div className="p-2 border-b border-border">
        <div className="section-label">Fleet History Playback</div>
        <button onClick={loadSnapshots} disabled={loading} className="btn btn-primary w-full mb-2">
          {loading ? 'LOADING...' : 'LOAD HISTORY'}
        </button>
        {error && <div className="font-mono text-xs text-danger mb-2">{error === 'HTTP 404' ? 'No history stored yet (DB may be offline)' : error}</div>}
      </div>

      {snapshots.length > 0 && (
        <div className="flex-1 flex flex-col p-3 gap-3">
          {/* Timeline scrubber */}
          <div>
            <div className="flex justify-between font-mono text-xs text-text-mute mb-1">
              <span>{current ? new Date(current.timestamp).toLocaleTimeString('en-GB') : '--:--:--'}</span>
              <span>{index + 1} / {snapshots.length}</span>
            </div>
            <input type="range" min={0} max={snapshots.length - 1} value={index}
              onChange={e => setIndex(Number(e.target.value))}
              className="w-full accent-accent" />
          </div>

          {/* Controls */}
          <div className="flex gap-2">
            <button onClick={() => setIndex(0)} className="btn btn-primary flex-1">⏮ START</button>
            <button onClick={() => setPlaying(p => !p)} className={`btn flex-1 ${playing ? 'btn-danger' : 'btn-primary'}`}>
              {playing ? '⏸ PAUSE' : '▶ PLAY'}
            </button>
            <button onClick={() => setIndex(snapshots.length - 1)} className="btn btn-primary flex-1">END ⏭</button>
          </div>

          {/* Speed control */}
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-text-mute">SPEED</span>
            {[1, 2, 5, 10].map(s => (
              <button key={s} onClick={() => setSpeed(s)}
                className={`btn text-xs py-0.5 px-2 ${speed === s ? 'btn-primary' : 'border-border text-text-mute hover:border-accent/50 border'}`}>
                {s}×
              </button>
            ))}
          </div>

          {/* Snapshot detail */}
          {current && (
            <div className="bg-surface border border-border rounded-sm p-2 flex-1 overflow-y-auto">
              <div className="section-label mb-2">Snapshot @ {new Date(current.timestamp).toLocaleTimeString('en-GB')}</div>
              <div className="font-mono text-xs text-text-dim grid grid-cols-2 gap-1 mb-3">
                <span>Vessels: {current.ships.length}</span>
                <span>Alerts: {current.alerts_count}</span>
                <span>Zones: {current.restricted_zones_count}</span>
              </div>
              <div className="space-y-1">
                {current.ships.map(ship => (
                  <div key={ship.shipId} className="flex justify-between font-mono text-xs text-text-mute border-b border-border/40 pb-0.5">
                    <span>{ship.name}</span>
                    <span>{ship.status.toUpperCase()}</span>
                    <span>{Number(ship.fuel).toFixed(0)}t</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {snapshots.length === 0 && !loading && !error && (
        <div className="flex-1 flex items-center justify-center font-mono text-xs text-text-mute text-center p-4">
          Load history to play back recorded fleet snapshots.<br/>
          Snapshots are saved every 30 seconds to SQLite (last 1 hour / 120 entries).
        </div>
      )}
    </div>
  );
}
