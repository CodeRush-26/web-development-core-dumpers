import { useState } from 'react';
import { STATUS_COLORS } from '../config.js';

const STATUS_LABELS = {
  normal:   'NOMINAL',
  warning:  'WARNING',
  critical: 'CRITICAL',
  distress: 'DISTRESS',
  anchored: 'ANCHORED',
  diverted: 'DIVERTED',
};

function FuelBar({ fuel, maxFuel = 9000 }) {
  const pct = Math.max(0, Math.min(100, (fuel / maxFuel) * 100));
  const color = pct < 10 ? 'var(--danger)' : pct < 30 ? 'var(--warn)' : 'var(--accent)';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 bg-surface rounded overflow-hidden">
        <div
          className="h-full transition-all duration-1000"
          style={{ width: `${pct}%`, background: color, boxShadow: `0 0 6px ${color}` }}
        />
      </div>
      <span className="font-mono text-xs" style={{ color }}>{fuel.toFixed(0)}t</span>
    </div>
  );
}

function ShipRow({ ship, selected, onClick }) {
  const color = STATUS_COLORS[ship.status] || STATUS_COLORS.normal;
  const isDistress = ship.status === 'distress' || ship.status === 'critical';

  return (
    <div
      id={`ship-row-${ship.shipId}`}
      onClick={() => onClick(ship)}
      className={`
        cursor-pointer p-2 rounded-sm border transition-all duration-200 mb-1
        ${selected ? 'bg-surface border-accent' : 'bg-void border-border hover:border-accent/50'}
        ${isDistress ? 'alert-critical' : ''}
      `}
      style={selected ? { boxShadow: `0 0 12px ${color}40` } : {}}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
          <span className="font-display text-xs text-text">{ship.name}</span>
          <span className="font-mono text-xs text-text-mute">{ship.shipId}</span>
        </div>
        <span className="status-badge font-mono text-xs" style={{ color, borderColor: color }}>
          {STATUS_LABELS[ship.status] || ship.status}
        </span>
      </div>
      <FuelBar fuel={ship.fuel} />
      <div className="mt-1 flex gap-3 font-mono text-xs text-text-mute">
        <span>HDG {ship.heading.toFixed(0)}°</span>
        <span>{ship.speed.toFixed(1)} kts</span>
        <span className="truncate">{ship.cargo}</span>
      </div>
      {ship.fuel_penalty_active && (
        <div className="text-xs font-mono mt-0.5" style={{ color: 'var(--warn)' }}>
          ⚡ WEATHER PENALTY ACTIVE
        </div>
      )}
    </div>
  );
}

export default function ShipPanel({ ships, selectedShip, onSelectShip }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const filtered = ships
    .filter(s => filter === 'all' || s.status === filter)
    .filter(s =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.shipId.toLowerCase().includes(search.toLowerCase()) ||
      s.cargo.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      const order = { distress: 0, critical: 1, warning: 2, diverted: 3, normal: 4, anchored: 5 };
      return (order[a.status] ?? 9) - (order[b.status] ?? 9);
    });

  const statusCounts = ships.reduce((acc, s) => {
    acc[s.status] = (acc[s.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col h-full panel">
      {/* Header */}
      <div className="p-2 border-b border-border">
        <div className="section-label mb-2">Fleet Registry — {ships.length} vessels</div>
        {/* Quick status counts */}
        <div className="flex gap-1 mb-2 flex-wrap">
          {Object.entries(statusCounts).map(([status, count]) => (
            <button
              key={status}
              onClick={() => setFilter(filter === status ? 'all' : status)}
              className="font-mono text-xs px-2 py-0.5 rounded-sm border transition-all"
              style={{
                color: STATUS_COLORS[status],
                borderColor: filter === status ? STATUS_COLORS[status] : 'transparent',
                background: filter === status ? `${STATUS_COLORS[status]}18` : 'transparent',
              }}
            >
              {count} {status.toUpperCase()}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="SEARCH VESSEL..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-surface border border-border rounded-sm px-2 py-1 font-mono text-xs text-text placeholder-text-mute focus:border-accent focus:outline-none"
        />
      </div>

      {/* Ship list */}
      <div className="flex-1 overflow-y-auto p-2">
        {filtered.length === 0 ? (
          <div className="text-text-mute font-mono text-xs text-center py-4">NO VESSELS MATCH</div>
        ) : (
          filtered.map(ship => (
            <ShipRow
              key={ship.shipId}
              ship={ship}
              selected={selectedShip?.shipId === ship.shipId}
              onClick={onSelectShip}
            />
          ))
        )}
      </div>

      {/* Selected ship detail */}
      {selectedShip && (
        <div className="border-t border-border p-2 bg-surface/50">
          <div className="section-label">SELECTED — {selectedShip.name}</div>
          <div className="font-mono text-xs text-text-dim grid grid-cols-2 gap-1">
            <span>LAT: {selectedShip.position[0].toFixed(4)}°</span>
            <span>LNG: {selectedShip.position[1].toFixed(4)}°</span>
            <span>DEST: {selectedShip.destination}</span>
            <span>CARGO: {selectedShip.cargo}</span>
          </div>
        </div>
      )}
    </div>
  );
}
