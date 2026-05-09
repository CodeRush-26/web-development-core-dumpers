import { useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Polygon, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet-draw';
import { STATUS_COLORS } from '../config.js';

// ── Ship SVG marker factory ──────────────────────────────────────────────────

function createShipIcon(heading, status, isSelected = false) {
  const color = STATUS_COLORS[status] || STATUS_COLORS.normal;
  const rot   = heading - 90; // SVG arrow points right by default
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
      <g transform="translate(4, 4)">
        <g transform="rotate(${rot}, 14, 14)">
          <polygon points="14,3 24,22 14,18 4,22" fill="${color}" opacity="0.9"/>
          <polygon points="14,3 24,22 14,18 4,22" fill="none" stroke="${color}" stroke-width="1"/>
        </g>
        ${status === 'distress' || status === 'critical' ? `
          <circle cx="14" cy="14" r="12" fill="none" stroke="${color}" stroke-width="1" opacity="0.4">
            <animate attributeName="r" values="10;16;10" dur="1.5s" repeatCount="indefinite"/>
            <animate attributeName="opacity" values="0.6;0;0.6" dur="1.5s" repeatCount="indefinite"/>
          </circle>` : ''}
        ${isSelected ? `
          <circle cx="14" cy="14" r="16" fill="none" stroke="#00f2ff" stroke-width="2" opacity="0.8">
            <animate attributeName="r" values="14;18;14" dur="2s" repeatCount="indefinite"/>
            <animate attributeName="stroke-opacity" values="0.8;0.2;0.8" dur="2s" repeatCount="indefinite"/>
          </circle>` : ''}
      </g>
    </svg>`;
  return L.divIcon({
    html: svg,
    className: `ship-marker-icon ${status} ${isSelected ? 'selected' : ''}`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -18],
  });
}

// ── DrawControl inner component ─────────────────────────────────────────────

function DrawControl({ onZoneDrawn }) {
  const map = useMap();
  const drawRef = useRef(null);

  useEffect(() => {
    if (drawRef.current) return;

    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    const drawControl = new L.Control.Draw({
      edit: { featureGroup: drawnItems },
      draw: {
        polygon: {
          allowIntersection: false,
          showArea: true,
          shapeOptions: { color: '#ff2d55', fillColor: '#ff2d55', fillOpacity: 0.15, weight: 2 },
        },
        rectangle: {
          shapeOptions: { color: '#ff2d55', fillColor: '#ff2d55', fillOpacity: 0.15, weight: 2 },
        },
        polyline: false, circle: false, circlemarker: false, marker: false,
      },
    });
    map.addControl(drawControl);
    drawRef.current = drawControl;

    map.on(L.Draw.Event.CREATED, (e) => {
      const layer = e.layer;
      drawnItems.addLayer(layer);
      const latlngs = layer.getLatLngs()[0] || layer.getLatLngs();
      const flat = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs;
      const polygon = flat.map(ll => [ll.lat, ll.lng]);
      onZoneDrawn(polygon);
    });

    return () => {
      map.removeControl(drawControl);
      map.removeLayer(drawnItems);
      map.off(L.Draw.Event.CREATED);
      drawRef.current = null;
    };
  }, [map, onZoneDrawn]);

  return null;
}

// ── Ship markers layer (uses requestAnimationFrame interpolation) ─────────────

function ShipMarkers({ ships, selectedShip, onShipClick }) {
  const map = useMap();
  const markersRef = useRef({});   // shipId → { marker, prevPos, targetPos, heading }
  const rafRef = useRef(null);
  const interpProgress = useRef({}); // shipId → progress 0..1

  // Update targets when ships state changes (1 Hz server ticks)
  useEffect(() => {
    ships.forEach(ship => {
      const sid = ship.shipId;
      const [lat, lng] = ship.position;
      const isSelected = selectedShip?.shipId === sid;

      if (!markersRef.current[sid]) {
        // Create new marker.
        const icon = createShipIcon(ship.heading, ship.status, isSelected);
        const marker = L.marker([lat, lng], { icon, zIndexOffset: isSelected ? 1000 : 100 })
          .addTo(map)
          .on('click', () => onShipClick(markersRef.current[sid]?.data ?? ship));

        markersRef.current[sid] = {
          marker,
          prevPos: [lat, lng],
          targetPos: [lat, lng],
          heading: ship.heading,
          status: ship.status,
          isSelected,
          data: ship,   // always kept up-to-date below
        };
        interpProgress.current[sid] = 1;
      } else {
        const entry = markersRef.current[sid];
        const cur = entry.marker.getLatLng();
        entry.prevPos = [cur.lat, cur.lng];
        entry.targetPos = [lat, lng];
        entry.heading = ship.heading;
        entry.status = ship.status;
        entry.data = ship;
        interpProgress.current[sid] = 0;
        
        // Update icon if status, heading, or selection changed
        if (entry.status !== ship.status || entry.heading !== ship.heading || entry.isSelected !== isSelected) {
          entry.isSelected = isSelected;
          entry.marker.setIcon(createShipIcon(ship.heading, ship.status, isSelected));
          entry.marker.setZIndexOffset(isSelected ? 1000 : 100);
        }
      }
    });

    // Remove markers for ships that no longer exist
    const activeIds = new Set(ships.map(s => s.shipId));
    Object.keys(markersRef.current).forEach(sid => {
      if (!activeIds.has(sid)) {
        markersRef.current[sid].marker.remove();
        delete markersRef.current[sid];
        delete interpProgress.current[sid];
      }
    });
  }, [ships, map, onShipClick, selectedShip]);

  // Smooth interpolation loop
  useEffect(() => {
    let last = performance.now();

    const animate = (now) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;

      Object.entries(markersRef.current).forEach(([sid, entry]) => {
        const prog = interpProgress.current[sid] ?? 1;
        if (prog >= 1) return;

        const newProg = Math.min(1, prog + dt);
        interpProgress.current[sid] = newProg;

        const [lat0, lng0] = entry.prevPos;
        const [lat1, lng1] = entry.targetPos;
        const t = easeInOut(newProg);
        entry.marker.setLatLng([lat0 + (lat1 - lat0) * t, lng0 + (lng1 - lng0) * t]);
      });

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return null;
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

function ZoneOverlays({ zones }) {
  return zones
    .filter(z => z.active)
    .map(zone => (
      <Polygon
        key={zone.zoneId}
        positions={zone.polygon.map(([lat, lng]) => [lat, lng])}
        pathOptions={{ color: '#ff2d55', fillColor: '#ff2d55', fillOpacity: 0.12, weight: 2, dashArray: '6 4' }}
      >
        <Popup>
          <div className="font-mono text-xs text-danger">
            <div className="font-display text-sm mb-1">{zone.name}</div>
            <div>Zone ID: {zone.zoneId}</div>
            <div className="text-text-mute">Active</div>
          </div>
        </Popup>
      </Polygon>
    ));
}

// ── Map controller for auto-centering ────────────────────────────────────────

function MapController({ selectedShip }) {
    const map = useMap();
    const lastId = useRef(null);

    useEffect(() => {
        if (!selectedShip) return;
        
        // Only fly if the ID actually changed (don't fly every tick)
        if (selectedShip.shipId !== lastId.current) {
            lastId.current = selectedShip.shipId;
            const [lat, lng] = selectedShip.position;
            map.flyTo([lat, lng], 8, { duration: 1.5 });
        }
    }, [selectedShip, map]);

    return null;
}

// ── Main MapView export ───────────────────────────────────────────────────────

export default function MapView({ ships, zones, selectedShip, onShipClick, onZoneDrawn, drawingEnabled }) {
  const handleZoneDrawn = useCallback((polygon) => {
    onZoneDrawn(polygon);
  }, [onZoneDrawn]);

  return (
    <div className="relative w-full h-full">
      <MapContainer
        center={[26.5, 54.0]}
        zoom={6}
        style={{ width: '100%', height: '100%', background: '#020d1f' }}
        zoomControl={true}
        attributionControl={false}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution=""
        />
        <ZoneOverlays zones={zones} />
        <ShipMarkers ships={ships} selectedShip={selectedShip} onShipClick={onShipClick} />
        <MapController selectedShip={selectedShip} />
        {drawingEnabled && <DrawControl onZoneDrawn={handleZoneDrawn} />}
      </MapContainer>

      {/* Corner HUD overlays */}
      <div className="absolute top-3 left-3 z-[1000] font-mono text-xs text-text-mute pointer-events-none">
        <div className="glow-accent text-accent font-display text-xs">STRAIT OF HORMUZ</div>
        <div>{ships.length} VESSELS TRACKED</div>
      </div>

      <div className="absolute bottom-3 right-3 z-[1000] font-mono text-xs text-text-mute pointer-events-none text-right">
        <div>26°N 54°E</div>
        <div>PERSIAN GULF / GULF OF OMAN</div>
      </div>
    </div>
  );
}
