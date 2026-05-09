import { useFleetSocket } from '../hooks/useFleetSocket.js';
import CaptainPanel from '../components/CaptainPanel.jsx';
import { STATUS_COLORS } from '../config.js';

export default function CaptainView() {
  const { ships, alerts, connected, lastEvent, send, tick } = useFleetSocket();

  const handleSendDistress = (shipId, text) => {
    send('distress_message', { shipId, text });
  };

  const handleDirectiveResponse = (shipId, directiveId, response) => {
    send('directive_response', { shipId, directiveId, response });
  };

  const criticalShips = ships.filter(s => s.status === 'distress' || s.status === 'critical');

  return (
    <div className="w-screen h-screen flex flex-col bg-void overflow-hidden scanlines">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-panel shrink-0">
        <div className="flex items-center gap-4">
          <div className="font-display text-warn text-sm tracking-widest" style={{ textShadow: '0 0 10px var(--warn)' }}>
            ⚓ CAPTAIN BRIDGE
          </div>
          <div className="font-mono text-xs text-text-mute">VESSEL COMMAND TERMINAL</div>
        </div>
        <div className="flex items-center gap-4">
          <div className="font-mono text-xs flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-success' : 'bg-danger animate-pulse'}`} />
            <span className={connected ? 'text-success' : 'text-danger'}>
              {connected ? 'CONNECTED' : 'DISCONNECTED'}
            </span>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Fleet status overview */}
        <div className="w-56 shrink-0 border-r border-border overflow-y-auto p-2">
          <div className="section-label">Fleet Status</div>
          {ships.map(ship => (
            <div key={ship.shipId} className="flex items-center gap-2 py-1 border-b border-border/30">
              <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: STATUS_COLORS[ship.status] }} />
              <div className="flex-1 min-w-0">
                <div className="font-mono text-xs text-text truncate">{ship.name}</div>
                <div className="font-mono text-xs text-text-mute">{ship.fuel.toFixed(0)}t</div>
              </div>
              <div className="font-mono text-xs" style={{ color: STATUS_COLORS[ship.status] }}>
                {ship.status.slice(0,3).toUpperCase()}
              </div>
            </div>
          ))}
        </div>

        {/* Center: Captain panel */}
        <div className="flex-1 overflow-hidden">
          <CaptainPanel
            ships={ships}
            onSendDistress={handleSendDistress}
            onDirectiveResponse={handleDirectiveResponse}
            lastEvent={lastEvent}
          />
        </div>

        {/* Right: Fleet alerts relevant to captain */}
        <div className="w-64 shrink-0 border-l border-border overflow-y-auto p-2">
          <div className="section-label">Active Alerts</div>
          {alerts.filter(a => !a.resolved).slice(0, 20).map(alert => (
            <div key={alert.alertId} className="mb-1 p-2 rounded-sm border font-mono text-xs"
              style={{ borderColor: alert.priority === 'critical' ? 'var(--danger)' : 'var(--border)',
                       color: alert.priority === 'critical' ? 'var(--danger)' : 'var(--text-dim)' }}>
              {alert.message}
            </div>
          ))}
          {alerts.filter(a => !a.resolved).length === 0 && (
            <div className="text-text-mute text-xs text-center py-4">ALL CLEAR</div>
          )}
        </div>
      </div>
    </div>
  );
}
