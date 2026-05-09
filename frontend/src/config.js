/**
 * config.js — Central configuration for the Hormuz Command frontend.
 * WebSocket URL is determined dynamically:
 *   1. Use VITE_WS_URL env var if set (production/Render deployment)
 *   2. Fall back to localhost for local dev
 */

export const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws';

export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

// Map initial view centered on the Strait of Hormuz
export const MAP_CENTER = [26.5, 54.0];
export const MAP_ZOOM = 6;

// Ship status → display colour
export const STATUS_COLORS = {
  normal:   '#00d4ff',
  warning:  '#ff8c00',
  critical: '#ff2d55',
  distress: '#ff2d55',
  anchored: '#6b8fb5',
  diverted: '#a855f7',
};

// Alert priority → colour
export const PRIORITY_COLORS = {
  low:      '#6b8fb5',
  medium:   '#ff8c00',
  high:     '#ff6b35',
  critical: '#ff2d55',
};
