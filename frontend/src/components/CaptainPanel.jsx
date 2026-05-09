import { useState } from 'react';
import { STATUS_COLORS } from '../config.js';

export default function CaptainPanel({ ships, onSendDistress, onDirectiveResponse, lastEvent }) {
  const [selectedShipId, setSelectedShipId] = useState('');
  const [distressText, setDistressText]     = useState('');
  const [responseText, setResponseText]     = useState('');
  const [captainLog, setCaptainLog]         = useState([]);

  // Track incoming directives
  const latestDirective = lastEvent?.type === 'directive_issued' ? lastEvent : null;

  const handleDistress = () => {
    if (!selectedShipId || !distressText.trim()) return;
    onSendDistress(selectedShipId, distressText.trim());
    setCaptainLog(prev => [{
      type: 'distress', time: new Date().toLocaleTimeString('en-GB', { hour12: false }),
      shipId: selectedShipId, text: distressText
    }, ...prev].slice(0, 20));
    setDistressText('');
  };

  const handleResponse = () => {
    if (!selectedShipId || !responseText.trim()) return;
    onDirectiveResponse(selectedShipId, latestDirective?.directiveId || 'unknown', responseText.trim());
    setCaptainLog(prev => [{
      type: 'response', time: new Date().toLocaleTimeString('en-GB', { hour12: false }),
      shipId: selectedShipId, text: responseText
    }, ...prev].slice(0, 20));
    setResponseText('');
  };

  const selectedShip = ships.find(s => s.shipId === selectedShipId);

  return (
    <div className="flex flex-col h-full panel">
      <div className="p-2 border-b border-border">
        <div className="section-label">Captain Interface</div>
        <select value={selectedShipId} onChange={e => setSelectedShipId(e.target.value)}
          className="w-full bg-surface border border-border rounded-sm px-2 py-1 font-mono text-xs text-text focus:border-accent focus:outline-none">
          <option value="">-- SELECT YOUR VESSEL --</option>
          {ships.map(s => (
            <option key={s.shipId} value={s.shipId}>
              {s.name} ({s.shipId})
            </option>
          ))}
        </select>
      </div>

      {selectedShip && (
        <div className="p-2 border-b border-border bg-surface/40">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ background: STATUS_COLORS[selectedShip.status] }} />
            <span className="font-display text-sm text-text">{selectedShip.name}</span>
            <span className="font-mono text-xs" style={{ color: STATUS_COLORS[selectedShip.status] }}>{selectedShip.status.toUpperCase()}</span>
          </div>
          <div className="font-mono text-xs text-text-mute mt-1">
            Fuel: {selectedShip.fuel.toFixed(0)}t | HDG: {selectedShip.heading.toFixed(0)}° | {selectedShip.speed.toFixed(1)} kts
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        {/* Incoming directive */}
        {latestDirective && latestDirective.shipId === selectedShipId && (
          <div className="bg-warn/10 border border-warn rounded-sm p-2 animate-fade-in-up">
            <div className="font-display text-xs text-warn mb-1">INCOMING DIRECTIVE</div>
            <div className="font-mono text-xs text-text">{latestDirective.command}</div>
            <div className="mt-2">
              <textarea rows={2} placeholder="Your response to command..."
                className="w-full bg-void border border-warn/50 rounded-sm px-2 py-1 font-mono text-xs text-text placeholder-text-mute focus:border-warn focus:outline-none resize-none"
                value={responseText} onChange={e => setResponseText(e.target.value)} />
              <button onClick={handleResponse} className="btn btn-warn w-full mt-1">SEND RESPONSE</button>
            </div>
          </div>
        )}

        {/* Distress message */}
        <div>
          <div className="section-label">Distress Signal</div>
          <textarea rows={3} placeholder="Describe emergency situation... (AI will parse severity and type)"
            className="w-full bg-surface border border-border rounded-sm px-2 py-1 font-mono text-xs text-text placeholder-text-mute focus:border-danger focus:outline-none resize-none mb-2"
            value={distressText} onChange={e => setDistressText(e.target.value)} />
          <button onClick={handleDistress} disabled={!selectedShipId || !distressText.trim()}
            className={`btn btn-danger w-full py-2 ${(!selectedShipId || !distressText.trim()) ? 'opacity-40 cursor-not-allowed' : ''}`}>
            ⚠ TRANSMIT DISTRESS SIGNAL
          </button>
        </div>

        {/* Captain log */}
        {captainLog.length > 0 && (
          <div>
            <div className="section-label">Captain Transmission Log</div>
            <div className="space-y-1">
              {captainLog.map((entry, i) => (
                <div key={i} className={`p-1.5 rounded-sm border font-mono text-xs ${entry.type === 'distress' ? 'border-danger/40 bg-danger/5 text-danger' : 'border-accent/40 bg-accent/5 text-accent'}`}>
                  <span className="text-text-mute">{entry.time} </span>{entry.text}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
