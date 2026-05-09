import { useState, useCallback, useEffect } from 'react';
import { useFleetSocket } from '../hooks/useFleetSocket.js';
import MapView from '../components/MapView.jsx';
import ShipPanel from '../components/ShipPanel.jsx';
import AlertPanel from '../components/AlertPanel.jsx';
import CommandPanel from '../components/CommandPanel.jsx';
import PlaybackPanel from '../components/PlaybackPanel.jsx';

export default function CommandView() {
  const { ships, alerts, zones, weather, tick, connected, lastEvent, send } = useFleetSocket();
  const [selectedShip, setSelectedShip] = useState(null);
  const [drawingEnabled, setDrawingEnabled] = useState(false);
  const [rightTab, setRightTab] = useState('alerts'); // 'alerts' | 'command' | 'playback'

  // Keep selectedShip in sync with updated ships data
  useEffect(() => {
    if (selectedShip) {
      const updated = ships.find(s => s.shipId === selectedShip.shipId);
      if (updated) setSelectedShip(updated);
    }
  }, [ships]);

  const handleIssueDirective = useCallback((shipId, command, message) => {
    send('issue_directive', { shipId, command, message });
  }, [send]);

  const handleZoneDrawn = useCallback((polygon, name) => {
    send('draw_zone', { polygon, name: name || 'Restricted Zone' });
    setDrawingEnabled(false);
  }, [send]);

  const handleRemoveZone = useCallback((zoneId) => {
    send('remove_zone', { zoneId });
  }, [send]);

  const handleResolveAlert = useCallback((alertId) => {
    send('resolve_alert', { alertId });
  }, [send]);

  const criticalCount = alerts.filter(a => !a.resolved && a.priority === 'critical').length;

  return (
    <div className="w-screen h-screen flex flex-col bg-void overflow-hidden scanlines">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-panel shrink-0 z-10">
        <div className="flex items-center gap-4">
          <div className="font-display text-accent text-sm tracking-widest glow-accent">
            ◈ HORMUZ COMMAND
          </div>
          <div className="font-mono text-xs text-text-mute">STRAIT OF HORMUZ CRISIS CENTER</div>
        </div>
        <div className="flex items-center gap-4">
          {weather.penalty_active && (
            <div className="font-mono text-xs text-warn animate-pulse">⛈ WEATHER PENALTY ACTIVE</div>
          )}
          {weather.wind_speed_kmh != null && (
            <div className="font-mono text-xs text-text-mute">
              WIND {weather.wind_speed_kmh.toFixed(0)} km/h | PRECIP {weather.precipitation_mmh?.toFixed(1) ?? 0} mm/h
            </div>
          )}
          {criticalCount > 0 && (
            <div className="font-mono text-xs text-danger animate-blink">⚠ {criticalCount} CRITICAL</div>
          )}
          <div className="font-mono text-xs flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-success' : 'bg-danger animate-pulse'}`} />
            <span className={connected ? 'text-success' : 'text-danger'}>
              {connected ? `LIVE T+${tick}` : 'RECONNECTING...'}
            </span>
          </div>
          <div className="font-mono text-xs text-text-mute">{ships.length} VESSELS</div>
        </div>
      </header>

      {/* Main layout: LEFT | MAP | RIGHT */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Fleet panel */}
        <div className="w-64 shrink-0 border-r border-border overflow-hidden">
          <ShipPanel ships={ships} selectedShip={selectedShip} onSelectShip={setSelectedShip} />
        </div>

        {/* Center: Map */}
        <div className="flex-1 relative overflow-hidden">
          <MapView
            ships={ships}
            zones={zones}
            selectedShip={selectedShip}
            onShipClick={setSelectedShip}
            onZoneDrawn={handleZoneDrawn}
            drawingEnabled={drawingEnabled}
          />
          {/* Ticker */}
          <div className="absolute bottom-0 left-0 right-0 bg-panel/80 border-t border-border/50 overflow-hidden h-6 z-[1000]">
            <div className="font-mono text-xs text-text-mute whitespace-nowrap"
              style={{ animation: 'ticker 40s linear infinite', display: 'inline-block', paddingLeft: '100%' }}>
              {ships.map(s => `${s.name}: ${s.status.toUpperCase()} | FUEL ${s.fuel.toFixed(0)}t | HDG ${s.heading.toFixed(0)}°`).join('   ◆   ')}
            </div>
          </div>
        </div>

        {/* Right: Tabbed panel */}
        <div className="w-72 shrink-0 border-l border-border flex flex-col overflow-hidden">
          <div className="flex border-b border-border shrink-0">
            {[
              { id: 'alerts',   label: `ALERTS${criticalCount > 0 ? ` (${criticalCount})` : ''}` },
              { id: 'command',  label: 'COMMAND' },
              { id: 'playback', label: 'HISTORY' },
            ].map(t => (
              <button key={t.id} onClick={() => setRightTab(t.id)}
                className={`flex-1 py-2 font-display text-xs tracking-wider transition-all ${rightTab===t.id ? 'text-accent border-b-2 border-accent bg-accent/5' : 'text-text-mute hover:text-text'} ${t.id==='alerts'&&criticalCount>0 ? 'text-danger' : ''}`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-hidden">
            {rightTab === 'alerts'   && <AlertPanel alerts={alerts} onResolve={handleResolveAlert} />}
            {rightTab === 'command'  && (
              <CommandPanel
                selectedShip={selectedShip}
                zones={zones}
                onIssueDirective={handleIssueDirective}
                onZoneDrawn={handleZoneDrawn}
                drawingEnabled={drawingEnabled}
                onToggleDrawing={() => setDrawingEnabled(d => !d)}
                onRemoveZone={handleRemoveZone}
              />
            )}
            {rightTab === 'playback' && <PlaybackPanel />}
          </div>
        </div>
      </div>
    </div>
  );
}
