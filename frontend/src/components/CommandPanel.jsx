import { useState } from 'react';

const COMMANDS = [
  { cmd: 'ANCHOR',       label: 'ANCHOR',        color: 'warn',   desc: 'Stop and hold position' },
  { cmd: 'RESUME',       label: 'RESUME',         color: 'accent', desc: 'Resume normal navigation' },
  { cmd: 'SPEED_REDUCE', label: 'REDUCE SPEED',   color: 'warn',   desc: 'Reduce speed by 40%' },
  { cmd: 'DIVERT',       label: 'DIVERT',         color: 'danger', desc: 'Mark as diverted (update destination manually)' },
];

export default function CommandPanel({ selectedShip, zones, onIssueDirective, onZoneDrawn, drawingEnabled, onToggleDrawing, onRemoveZone }) {
  const [command, setCommand]   = useState('ANCHOR');
  const [message, setMessage]   = useState('');
  const [zoneName, setZoneName] = useState('');
  const [tab, setTab]           = useState('directives'); // 'directives' | 'zones'

  const handleIssueDirective = () => {
    if (!selectedShip) return;
    onIssueDirective(selectedShip.shipId, command, message);
    setMessage('');
  };

  const handleZoneDrawn = (polygon) => {
    const name = zoneName.trim() || `Zone ${Date.now()}`;
    onZoneDrawn(polygon, name);
    setZoneName('');
  };

  return (
    <div className="flex flex-col h-full panel">
      {/* Tabs */}
      <div className="flex border-b border-border">
        {['directives', 'zones'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 font-display text-xs tracking-widest transition-all ${tab===t ? 'text-accent border-b-2 border-accent bg-accent/5' : 'text-text-mute hover:text-text'}`}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      {tab === 'directives' && (
        <div className="flex-1 flex flex-col p-3 gap-3 overflow-y-auto">
          {/* Ship selector indicator */}
          <div className="section-label">Target Vessel</div>
          {selectedShip ? (
            <div className="bg-surface border border-accent/40 rounded-sm p-2">
              <div className="font-display text-sm text-accent">{selectedShip.name}</div>
              <div className="font-mono text-xs text-text-mute">{selectedShip.shipId} — {selectedShip.status.toUpperCase()}</div>
            </div>
          ) : (
            <div className="bg-surface border border-border rounded-sm p-2 text-text-mute font-mono text-xs">
              SELECT A VESSEL ON MAP OR LIST
            </div>
          )}

          {/* Command grid */}
          <div className="section-label">Command</div>
          <div className="grid grid-cols-2 gap-2">
            {COMMANDS.map(c => (
              <button key={c.cmd} onClick={() => setCommand(c.cmd)}
                className={`btn btn-${c.color} text-left py-2 px-3 ${command===c.cmd ? 'ring-1 ring-current' : ''}`}>
                <div className="font-display text-xs">{c.label}</div>
                <div className="font-ui text-xs opacity-70 mt-0.5 normal-case font-normal">{c.desc}</div>
              </button>
            ))}
          </div>

          {/* Custom heading/destination */}
          <div className="section-label">Custom Command</div>
          <div className="flex gap-1">
            <input type="text" placeholder="e.g. HEADING:045 or DESTINATION:MCT-1"
              className="flex-1 bg-surface border border-border rounded-sm px-2 py-1 font-mono text-xs text-text placeholder-text-mute focus:border-accent focus:outline-none"
              value={command.startsWith('ANCHOR')||command.startsWith('RESUME')||command.startsWith('SPEED')||command.startsWith('DIVERT') ? '' : command}
              onChange={e => setCommand(e.target.value)} />
          </div>

          {/* Message */}
          <textarea rows={2} placeholder="Optional message to captain..."
            className="bg-surface border border-border rounded-sm px-2 py-1 font-mono text-xs text-text placeholder-text-mute focus:border-accent focus:outline-none resize-none"
            value={message} onChange={e => setMessage(e.target.value)} />

          <button onClick={handleIssueDirective} disabled={!selectedShip}
            className={`btn btn-primary w-full py-2 ${!selectedShip ? 'opacity-40 cursor-not-allowed' : ''}`}>
            TRANSMIT DIRECTIVE
          </button>
        </div>
      )}

      {tab === 'zones' && (
        <div className="flex-1 flex flex-col p-3 gap-3 overflow-y-auto">
          <div className="section-label">Draw Restricted Zone</div>
          <input type="text" placeholder="Zone name (e.g. 'Naval Blockade Alpha')"
            className="bg-surface border border-border rounded-sm px-2 py-1 font-mono text-xs text-text placeholder-text-mute focus:border-accent focus:outline-none"
            value={zoneName} onChange={e => setZoneName(e.target.value)} />

          <button onClick={onToggleDrawing}
            className={`btn w-full py-2 ${drawingEnabled ? 'btn-danger' : 'btn-warn'}`}>
            {drawingEnabled ? '◼ STOP DRAWING' : '✎ DRAW ZONE ON MAP'}
          </button>

          {drawingEnabled && (
            <div className="bg-warn/10 border border-warn/40 rounded-sm p-2 font-mono text-xs text-warn">
              DRAWING MODE ACTIVE — Use the polygon/rectangle tools on the map to draw the zone.
            </div>
          )}

          <div className="section-label">Active Zones ({zones.length})</div>
          <div className="flex-1 overflow-y-auto space-y-1">
            {zones.length === 0 ? (
              <div className="font-mono text-xs text-text-mute text-center py-4">NO ZONES ACTIVE</div>
            ) : zones.map(z => (
              <div key={z.zoneId} className="flex items-center justify-between p-2 bg-danger/5 border border-danger/30 rounded-sm">
                <div>
                  <div className="font-mono text-xs text-danger">{z.name}</div>
                  <div className="font-mono text-xs text-text-mute">{z.zoneId}</div>
                </div>
                <button onClick={() => onRemoveZone(z.zoneId)} className="btn btn-danger py-0.5 px-2 text-xs">REMOVE</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
