"""
main.py — FastAPI orchestration: CORS, WebSocket manager, route registration.
"""
import asyncio
import json
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Dict, List, Set

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError

import simulator
import history
from routing import build_navigable_polygon
from alerts import create_alert, resolve_alert, get_all_alerts_serializable
from models import AlertType, AlertPriority
from ai_nlp import parse_distress_message
from models import DistressMessage

# ---------------------------------------------------------------------------
# Load fleet data from fleet.json
# ---------------------------------------------------------------------------

def _load_fleet_json() -> dict:
    """Load fleet.json with a clear, actionable error message on failure.

    PHASE1-A: Previously a raw FileNotFoundError / JSONDecodeError would
    propagate through lifespan() and produce an opaque uvicorn traceback.
    Now we catch both and re-raise with a human-readable message so the
    operator knows exactly what to fix.
    """
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(here, "fleet.json")
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        raise RuntimeError(
            f"[main] FATAL: fleet.json not found at {path}. "
            "Restore the file or set a FLEET_JSON_PATH env variable."
        )
    except json.JSONDecodeError as e:
        raise RuntimeError(
            f"[main] FATAL: fleet.json is malformed — {e}. "
            "Fix the JSON syntax and restart."
        )
    # Validate required top-level keys
    for key in ("fleet", "ports", "navigableWater"):
        if key not in data:
            raise RuntimeError(
                f"[main] FATAL: fleet.json is missing required key '{key}'."
            )
    return data


# ---------------------------------------------------------------------------
# WebSocket connection manager
# ---------------------------------------------------------------------------

class ConnectionManager:
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.active_connections.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self.active_connections.discard(ws)

    async def broadcast(self, data: dict) -> None:
        dead: List[WebSocket] = []
        message = json.dumps(data, default=str)
        for ws in list(self.active_connections):
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()
_stop_event = asyncio.Event()


# ---------------------------------------------------------------------------
# Lifespan: startup / shutdown
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load fleet
    data = _load_fleet_json()
    build_navigable_polygon(data["navigableWater"])
    simulator.init_fleet(data["fleet"], data["ports"])

    # Init DB (optional — gracefully disabled if no DATABASE_URL)
    await history.init_db()

    # Start simulation loop
    sim_task = asyncio.create_task(
        simulator.simulation_loop(manager.broadcast, _stop_event)
    )

    # Start history snapshot loop
    snap_task = asyncio.create_task(
        history.snapshot_loop(simulator.get_state_snapshot)
    )

    print("[main] Simulation started.")
    yield

    # Shutdown
    _stop_event.set()
    sim_task.cancel()
    snap_task.cancel()
    await history.close_db()
    print("[main] Shutdown complete.")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="Hormuz Command API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    initial_state = {
        "type": "fleet_update",
        "tick": simulator.tick_count,
        "ships": list(simulator.fleet_state.values()),
        "alerts": get_all_alerts_serializable(),
        "restricted_zones": simulator.restricted_zones,
        "weather": simulator.current_weather,
    }
    await websocket.send_text(json.dumps(initial_state, default=str))

    try:
        while True:
            raw = await websocket.receive_text()
            # Step 1: JSON parse guard
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_text(json.dumps({"type": "error", "message": "Invalid JSON"}))
                continue

            # Step 2: PHASE1-B per-message dispatch guard.
            # Any runtime exception returns an error frame but does NOT kill the loop.
            msg_type = ""
            try:
                if not isinstance(msg, dict):
                    await websocket.send_text(json.dumps({"type": "error", "message": "Message must be a JSON object"}))
                    continue
                msg_type = msg.get("type", "")
                payload = msg.get("payload", {})
                if not isinstance(payload, dict):
                    payload = {}

                if msg_type == "draw_zone":
                    raw_polygon = payload.get("polygon", [])
                    if not isinstance(raw_polygon, list) or len(raw_polygon) < 3:
                        await websocket.send_text(json.dumps({
                            "type": "error",
                            "message": "draw_zone: polygon must be a list of at least 3 [lat, lng] pairs",
                        }))
                        continue
                    validated_polygon = []
                    for pt in raw_polygon:
                        if not (isinstance(pt, (list, tuple)) and len(pt) == 2):
                            await websocket.send_text(json.dumps({"type": "error", "message": "draw_zone: each point must be [lat, lng]"}))
                            break
                        try:
                            validated_polygon.append([float(pt[0]), float(pt[1])])
                        except (TypeError, ValueError):
                            await websocket.send_text(json.dumps({"type": "error", "message": "draw_zone: lat/lng must be numeric"}))
                            break
                    else:
                        zone = {
                            "zoneId": str(payload.get("zoneId", str(uuid.uuid4())[:8]))[:16],
                            "name": str(payload.get("name", "Restricted Zone"))[:64],
                            "polygon": validated_polygon,
                            "created_at": datetime.utcnow().isoformat(),
                            "active": True,
                        }
                        simulator.restricted_zones.append(zone)
                        create_alert(AlertType.geofence, AlertPriority.medium,
                                     f"New restricted zone '{zone['name']}' activated.", force=True)
                        await websocket.send_text(json.dumps({"type": "zone_created", "zone": zone}, default=str))

                elif msg_type == "remove_zone":
                    zone_id = payload.get("zoneId")
                    simulator.restricted_zones = [z for z in simulator.restricted_zones if z["zoneId"] != zone_id]
                    await websocket.send_text(json.dumps({"type": "zone_removed", "zoneId": zone_id}))

                elif msg_type == "issue_directive":
                    ship_id      = str(payload.get("shipId", ""))[:16]
                    command      = str(payload.get("command", ""))[:128]
                    message_text = str(payload.get("message", ""))[:512]
                    directive_id = str(uuid.uuid4())[:8]
                    if not ship_id:
                        await websocket.send_text(json.dumps({"type": "error", "message": "issue_directive: shipId required"}))
                        continue
                    applied = simulator.apply_directive(ship_id, command, message_text)
                    await manager.broadcast({
                        "type": "directive_issued",
                        "directiveId": directive_id,
                        "shipId": ship_id,
                        "command": command,
                        "applied": applied,
                    })

                elif msg_type == "directive_response":
                    await manager.broadcast({
                        "type": "captain_response",
                        "shipId": str(payload.get("shipId", "")),
                        "directiveId": str(payload.get("directiveId", "")),
                        "response": str(payload.get("response", ""))[:512],
                        "timestamp": datetime.utcnow().isoformat(),
                    })

                elif msg_type == "distress_message":
                    distress_msg = DistressMessage(
                        shipId=payload.get("shipId", ""),
                        raw_text=payload.get("text", ""),
                    )
                    parsed = await parse_distress_message(distress_msg)
                    if parsed.shipId in simulator.fleet_state:
                        if parsed.severity == "critical":
                            simulator.fleet_state[parsed.shipId]["status"] = "distress"
                        elif parsed.severity == "high":
                            simulator.fleet_state[parsed.shipId]["status"] = "critical"
                    create_alert(
                        AlertType.distress,
                        AlertPriority.critical if parsed.severity == "critical" else AlertPriority.high,
                        f"DISTRESS [{parsed.shipId}]: {parsed.incident_type} " + "\u2014" + f" {parsed.recommended_action}",
                        ship_id=parsed.shipId, force=True,
                    )
                    await manager.broadcast({"type": "distress_parsed", "parsed": parsed.model_dump(mode="json")})

                elif msg_type == "resolve_alert":
                    alert_id = payload.get("alertId")
                    resolve_alert(alert_id)
                    await websocket.send_text(json.dumps({"type": "alert_resolved", "alertId": alert_id}))

                else:
                    await websocket.send_text(json.dumps({"type": "error", "message": f"Unknown type: {msg_type}"}))

            except asyncio.CancelledError:
                raise
            except Exception as dispatch_err:
                print(f"[ws] dispatch error type={msg_type!r}: {dispatch_err}")
                try:
                    await websocket.send_text(json.dumps({
                        "type": "error", "message": "Internal error \u2014 please retry.",
                    }))
                except Exception:
                    pass

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as conn_err:
        # PHASE1-C: unexpected connection-level errors (network reset etc.)
        print(f"[ws] connection error: {conn_err}")
        manager.disconnect(websocket)

# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {"status": "ok", "tick": simulator.tick_count, "ships": len(simulator.fleet_state)}


@app.get("/fleet")
async def get_fleet():
    return JSONResponse(content={"ships": list(simulator.fleet_state.values())})


@app.get("/alerts")
async def get_alerts():
    return JSONResponse(content={"alerts": get_all_alerts_serializable()})


@app.get("/zones")
async def get_zones():
    return JSONResponse(content={"zones": simulator.restricted_zones})


@app.get("/history/snapshots")
async def get_history(limit: int = 120, offset: int = 0):
    snapshots = await history.get_snapshots(limit=limit, offset=offset)
    return JSONResponse(content={"snapshots": snapshots, "total": len(snapshots)})


@app.get("/history/count")
async def get_history_count():
    count = await history.get_snapshot_count()
    return JSONResponse(content={"count": count, "max": 120, "interval_seconds": 30})


@app.get("/ports")
async def get_ports():
    return JSONResponse(content={"ports": list(simulator.ports_map.values())})


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
