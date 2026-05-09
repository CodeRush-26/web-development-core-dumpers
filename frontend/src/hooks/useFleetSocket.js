import { useState, useEffect, useRef, useCallback } from 'react';
import { WS_URL } from '../config.js';

// BUG-08 FIX: Exponential backoff instead of fixed 3s delay.
// Delay = min(BASE_DELAY_MS * 2^attempt, MAX_DELAY_MS) * jitter(0.8..1.2)
const BASE_DELAY_MS  = 1000;
const MAX_DELAY_MS   = 30000;
const MAX_RECONNECT_ATTEMPTS = 20;

function getBackoffDelay(attempt) {
  const exp = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
  const jitter = 0.8 + Math.random() * 0.4; // 0.8..1.2
  return Math.floor(exp * jitter);
}

/**
 * useFleetSocket — manages WebSocket connection to the backend.
 * Handles auto-reconnection, parse incoming state into React state.
 */
export function useFleetSocket() {
  const [ships, setShips]             = useState([]);
  const [alerts, setAlerts]           = useState([]);
  const [zones, setZones]             = useState([]);
  const [weather, setWeather]         = useState({});
  const [tick, setTick]               = useState(0);
  const [connected, setConnected]     = useState(false);
  const [lastEvent, setLastEvent]     = useState(null);  // latest non-fleet_update message

  const wsRef               = useRef(null);
  const reconnectCount      = useRef(0);
  const reconnectTimerRef   = useRef(null);
  const mountedRef          = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setConnected(true);
      reconnectCount.current = 0;
    };

    ws.onmessage = (e) => {
      if (!mountedRef.current) return;
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'fleet_update') {
          setShips(msg.ships ?? []);
          setAlerts(msg.alerts ?? []);
          setZones(msg.restricted_zones ?? []);
          setWeather(msg.weather ?? {});
          setTick(msg.tick ?? 0);
        } else {
          // Bubble up other events (directive_issued, distress_parsed, etc.)
          setLastEvent(msg);
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onerror = () => {
      // onclose fires after onerror — reconnect logic handled there
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnected(false);
      wsRef.current = null;
      if (reconnectCount.current < MAX_RECONNECT_ATTEMPTS) {
        const delay = getBackoffDelay(reconnectCount.current);
        reconnectCount.current += 1;
        reconnectTimerRef.current = setTimeout(connect, delay);
      }
    };
  }, []);

  // Send a message over the WebSocket
  const send = useCallback((type, payload) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, payload }));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { ships, alerts, zones, weather, tick, connected, lastEvent, send };
}
