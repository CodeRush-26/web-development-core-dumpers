import { useState } from 'react';
import { PRIORITY_COLORS } from '../config.js';

const TYPE_ICONS = {
  geofence:  '⬡',
  proximity: '◉',
  fuel_low:  '▲',
  distress:  '⚠',
  weather:   '⛈',
  directive: '◈',
};

const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function AlertItem({ alert, onResolve }) {
  const color = PRIORITY_COLORS[alert.priority] || PRIORITY_COLORS.medium;
  const icon  = TYPE_ICONS[alert.type] || '●';
  const time  = new Date(alert.created_at).toLocaleTimeString('en-GB', { hour12: false });

  return (
    <div
      id={`alert-${alert.alertId}`}
      className={`p-2 mb-1 rounded-sm border transition-all animate-fade-in-up ${alert.priority === 'critical' ? 'alert-critical' : ''}`}
      style={{ borderColor: color, background: `${color}15` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <span className={`font-mono text-lg mt-0 shrink-0 ${alert.priority === 'critical' ? 'glitch-text' : ''}`} style={{ color }}>{icon}</span>
          <div className="min-w-0">
            <div className={`font-mono text-[11px] font-semibold uppercase tracking-wider text-text leading-tight break-words ${alert.priority === 'critical' ? 'glitch-text text-danger' : ''}`}>{alert.message}</div>
            <div className="flex gap-2 mt-1">
              <span className="font-mono text-[10px] tracking-widest" style={{ color }}>{alert.priority.toUpperCase()}</span>
              <span className="font-mono text-[10px] tracking-widest text-text-mute">{alert.type.toUpperCase()}</span>
              <span className="font-mono text-[10px] tracking-widest text-text-mute">{time}</span>
            </div>
          </div>
        </div>
        <button onClick={() => onResolve(alert.alertId)} className="shrink-0 btn btn-primary text-[10px] py-1 px-2 border border-accent/30 hover:border-accent">ACK</button>
      </div>
    </div>
  );
}

export default function AlertPanel({ alerts, onResolve }) {
  const [filter, setFilter] = useState('all');
  const sorted = [...alerts]
    .filter(a => !a.resolved)
    .filter(a => filter === 'all' || a.priority === filter || a.type === filter)
    .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9));
  const criticalCount = alerts.filter(a => !a.resolved && a.priority === 'critical').length;

  return (
    <div className="flex flex-col h-full panel">
      <div className="p-2 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <div className="section-label mb-0">Alert Console {criticalCount > 0 && <span className="ml-2 font-mono text-danger animate-blink">{criticalCount} CRITICAL</span>}</div>
          <span className="font-mono text-xs text-text-mute">{sorted.length} active</span>
        </div>
        <div className="flex gap-1 flex-wrap">
          {['all','critical','high','geofence','proximity','fuel_low','distress'].map(f => (
            <button key={f} onClick={() => setFilter(filter === f ? 'all' : f)}
              className={`font-mono text-xs px-2 py-0.5 rounded-sm border transition-all ${filter===f?'border-accent text-accent bg-accent/10':'border-border text-text-mute hover:border-accent/50'}`}>
              {f.toUpperCase().replace('_',' ')}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {sorted.length === 0
          ? <div className="text-text-mute font-mono text-xs text-center py-6"><div className="text-2xl mb-2 text-success">◉</div>ALL CLEAR</div>
          : sorted.map(alert => <AlertItem key={alert.alertId} alert={alert} onResolve={onResolve} />)}
      </div>
    </div>
  );
}
