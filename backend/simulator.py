"""
simulator.py — 1 Hz physics loop. Advances ship positions, applies fuel burn,
checks geofences and proximity. Broadcasts state via callback to main.py.
NEVER hardcodes the fleet size — always driven by len(fleet_state).
"""
import asyncio
import math
import copy
from typing import Dict, List, Any, Callable, Optional

from routing import haversine_km, is_in_restricted_zone, compute_route, is_navigable
from weather import fetch_weather, apply_fuel_penalty
from alerts import (
    check_fuel_alert, check_proximity_alert, check_geofence_alert,
    get_all_alerts_serializable,
)

# ---------------------------------------------------------------------------
# Live state — all in memory, never persisted between restarts
# ---------------------------------------------------------------------------
fleet_state: Dict[str, Dict[str, Any]] = {}   # keyed by shipId
ports_map: Dict[str, Dict[str, Any]] = {}     # keyed by port id
restricted_zones: List[Dict[str, Any]] = []
directives: Dict[str, List[Dict]] = {}        # shipId → list of directives
current_weather: Dict[str, Any] = {}
tick_count: int = 0

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
KNOTS_TO_KMH = 1.852
FUEL_BURN_BASE = 0.001   # tons per second at 1 knot (scaled by speed)
PROXIMITY_THRESHOLD_KM = 2.0
ARRIVAL_THRESHOLD_KM = 3.0
WAYPOINT_ARRIVAL_KM = 5.0  # pop waypoint when ship is within this distance

# Simulation speed multiplier: 1 real second = SIM_SPEED simulation seconds.
# At 60x, a 20-knot ship moves ~0.6 km/tick which is clearly visible on the
# Strait of Hormuz map at zoom-6 (≈ 0.9 px/tick). Fuel and travel time
# scale proportionally — ships reach ports and deplete fuel in realistic
# demo timeframes.
import os as _os
SIM_SPEED = int(_os.getenv("SIM_SPEED", "60"))

# ---------------------------------------------------------------------------
# Initialise from fleet.json data
# ---------------------------------------------------------------------------

def init_fleet(fleet_data: List[Dict], ports_data: List[Dict]) -> None:
    global fleet_state, ports_map, directives
    for port in ports_data:
        ports_map[port["id"]] = port

    for ship in fleet_data:
        fleet_state[ship["shipId"]] = {
            **ship,
            "fuel_penalty_active": False,
            "directives": [],
            "route": [],
        }
        directives[ship["shipId"]] = []

    # Pre-compute A* routes for every ship that has a destination
    for sid, ship in fleet_state.items():
        dest_id = ship.get("destination")
        if dest_id and dest_id in ports_map:
            dest_pos = ports_map[dest_id]["position"]
            try:
                route = compute_route(ship["position"], dest_pos, [])
                # Drop the first waypoint if it's the ship's own position
                if len(route) > 1:
                    route = route[1:]
                fleet_state[sid]["route"] = route
                print(f"[simulator] {ship['name']} route computed: {len(route)} waypoints")
            except Exception as e:
                print(f"[simulator] route computation failed for {ship['name']}: {e}")
                fleet_state[sid]["route"] = [dest_pos]


# ---------------------------------------------------------------------------
# Physics helpers
# ---------------------------------------------------------------------------

def _advance_position(lat: float, lng: float, heading_deg: float, speed_knots: float, dt: float) -> tuple:
    """
    Flat-earth approximation. Returns (new_lat, new_lng).
    dt: seconds. speed_knots: knots.

    BUG-04 FIX: Clamp lat to [-89.9, 89.9] before the cos() call to prevent
    ZeroDivisionError at the poles. Ships in this scenario are at 22-30N so
    this won't trigger naturally, but protects against injected test data.
    """
    speed_ms = speed_knots * 1852 / 3600  # metres per second
    distance_m = speed_ms * dt
    heading_rad = math.radians(heading_deg)

    # 1 degree latitude ≈ 111,320 m
    dlat = (distance_m * math.cos(heading_rad)) / 111320
    # 1 degree longitude ≈ 111,320 * cos(lat) m
    # Clamp lat to avoid division-by-zero at ±90° (BUG-04)
    safe_lat = max(-89.9, min(89.9, lat))
    dlng = (distance_m * math.sin(heading_rad)) / (111320 * math.cos(math.radians(safe_lat)))

    return lat + dlat, lng + dlng


def _heading_toward(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Bearing from point 1 to point 2 in degrees true north."""
    dlng = math.radians(lng2 - lng1)
    lat1r, lat2r = math.radians(lat1), math.radians(lat2)
    x = math.sin(dlng) * math.cos(lat2r)
    y = math.cos(lat1r) * math.sin(lat2r) - math.sin(lat1r) * math.cos(lat2r) * math.cos(dlng)
    bearing = math.degrees(math.atan2(x, y))
    return (bearing + 360) % 360


# ---------------------------------------------------------------------------
# Main tick function
# ---------------------------------------------------------------------------

async def tick(
    broadcast_cb: Callable[[Dict[str, Any]], None],
    dt: float = 1.0,
) -> None:
    """
    Called at 1 Hz. Mutates fleet_state in place, then calls broadcast_cb
    with the current serialisable state dict.
    """
    global current_weather, tick_count

    tick_count += 1

    # Fetch weather every 10 minutes (weather.py handles caching).
    # BUG-02 FIX: Wrapped in its own try/except. asyncio.CancelledError is
    # deliberately re-raised so it propagates to simulation_loop correctly
    # (CancelledError must never be swallowed). Any other exception keeps the
    # last known weather dict rather than crashing the tick.
    if tick_count % 600 == 1:
        try:
            current_weather = await fetch_weather()
        except asyncio.CancelledError:
            raise  # Always propagate cancellation
        except Exception as e:
            print(f"[simulator] weather fetch failed, using cached value: {e}")
            # current_weather retains its last value — safe default already in place

    ships_list = list(fleet_state.values())

    for ship in ships_list:
        sid = ship["shipId"]

        # Skip if anchored
        if ship["status"] == "anchored":
            continue

        lat, lng = ship["position"]
        heading = ship["heading"]
        speed = ship["speed"]

        # ---- Steer toward destination via computed waypoints ----
        dest_id = ship.get("destination")
        if dest_id and dest_id in ports_map:
            dest_pos = ports_map[dest_id]["position"]
            dist_to_dest = haversine_km(lat, lng, dest_pos[0], dest_pos[1])

            if dist_to_dest < ARRIVAL_THRESHOLD_KM:
                # Arrived — anchor
                fleet_state[sid]["status"] = "anchored"
                fleet_state[sid]["speed"] = 0
                fleet_state[sid]["position"] = [dest_pos[0], dest_pos[1]]
                fleet_state[sid]["route"] = []
                continue

            # If route is empty or was never computed, compute one now
            route = fleet_state[sid].get("route", [])
            if not route:
                try:
                    route = compute_route([lat, lng], dest_pos, restricted_zones)
                    if len(route) > 1:
                        route = route[1:]  # drop start position
                    fleet_state[sid]["route"] = route
                except Exception:
                    route = [dest_pos]
                    fleet_state[sid]["route"] = route

            # Pop waypoints we've already reached
            while len(route) > 1:
                wp = route[0]
                dist_to_wp = haversine_km(lat, lng, wp[0], wp[1])
                if dist_to_wp < WAYPOINT_ARRIVAL_KM:
                    route.pop(0)
                else:
                    break

            # Steer toward the current waypoint
            if route:
                target = route[0]
                heading = _heading_toward(lat, lng, target[0], target[1])
                fleet_state[sid]["heading"] = heading

        # ---- Advance position (scaled by SIM_SPEED for visual clarity) ----
        sim_dt = dt * SIM_SPEED
        new_lat, new_lng = _advance_position(lat, lng, heading, speed, sim_dt)

        # ---- Land collision failsafe: do NOT move onto land ----
        if not is_navigable(new_lat, new_lng):
            # Ship would move onto land — hold position, don't update
            fleet_state[sid]["position"] = [lat, lng]
        else:
            fleet_state[sid]["position"] = [new_lat, new_lng]

        # ---- Fuel consumption (proportional to actual distance covered) ----
        base_burn = FUEL_BURN_BASE * speed * sim_dt
        actual_burn = apply_fuel_penalty(base_burn, current_weather)
        fleet_state[sid]["fuel"] = max(0.0, ship["fuel"] - actual_burn)
        fleet_state[sid]["fuel_penalty_active"] = current_weather.get("penalty_active", False)

        if fleet_state[sid]["fuel"] <= 0:
            fleet_state[sid]["status"] = "critical"
            fleet_state[sid]["speed"] = 0

        # ---- Fuel alerts ----
        check_fuel_alert(sid, ship["name"], fleet_state[sid]["fuel"])

        # ---- Geofence check ----
        zone_id = is_in_restricted_zone(new_lat, new_lng, restricted_zones)
        if zone_id:
            fleet_state[sid]["status"] = "warning"
            check_geofence_alert(sid, ship["name"], zone_id)

    # ---- Proximity checks (O(n²) but n is always small) ----
    ship_ids = list(fleet_state.keys())
    for i in range(len(ship_ids)):
        for j in range(i + 1, len(ship_ids)):
            s1 = fleet_state[ship_ids[i]]
            s2 = fleet_state[ship_ids[j]]
            if s1["status"] == "anchored" or s2["status"] == "anchored":
                continue
            dist = haversine_km(
                s1["position"][0], s1["position"][1],
                s2["position"][0], s2["position"][1],
            )
            if dist < PROXIMITY_THRESHOLD_KM:
                check_proximity_alert(s1["shipId"], s1["name"], s2["shipId"], s2["name"], dist)

    # ---- Build and broadcast state ----
    state = {
        "type": "fleet_update",
        "tick": tick_count,
        "ships": [copy.deepcopy(s) for s in fleet_state.values()],
        "alerts": get_all_alerts_serializable(),
        "restricted_zones": restricted_zones,
        "weather": current_weather,
    }
    await broadcast_cb(state)


# ---------------------------------------------------------------------------
# Background runner
# ---------------------------------------------------------------------------

async def simulation_loop(broadcast_cb: Callable, stop_event: asyncio.Event) -> None:
    """Run tick() at 1 Hz until stop_event is set."""
    while not stop_event.is_set():
        start = asyncio.get_event_loop().time()
        try:
            await tick(broadcast_cb)
        except Exception as e:
            print(f"[simulator] tick error: {e}")
        elapsed = asyncio.get_event_loop().time() - start
        await asyncio.sleep(max(0.0, 1.0 - elapsed))


# ---------------------------------------------------------------------------
# Directive application
# ---------------------------------------------------------------------------

def apply_directive(ship_id: str, command: str, message: str) -> bool:
    """Apply a command directive to a ship. Returns True if applied."""
    if ship_id not in fleet_state:
        return False

    cmd = command.upper()
    if cmd == "ANCHOR":
        fleet_state[ship_id]["status"] = "anchored"
        fleet_state[ship_id]["speed"] = 0
    elif cmd == "RESUME":
        fleet_state[ship_id]["status"] = "normal"
        # Restore a default speed (half original is safe)
        fleet_state[ship_id]["speed"] = max(5, fleet_state[ship_id]["speed"])
    elif cmd == "SPEED_REDUCE":
        fleet_state[ship_id]["speed"] = max(3, fleet_state[ship_id]["speed"] * 0.6)
    elif cmd == "DIVERT":
        fleet_state[ship_id]["status"] = "diverted"
    elif cmd.startswith("HEADING:"):
        try:
            new_heading = float(cmd.split(":")[1])
            fleet_state[ship_id]["heading"] = new_heading % 360
        except ValueError:
            pass
    elif cmd.startswith("DESTINATION:"):
        new_dest = cmd.split(":")[1].strip()
        fleet_state[ship_id]["destination"] = new_dest
        # Recompute route for new destination
        if new_dest in ports_map:
            try:
                pos = fleet_state[ship_id]["position"]
                dest_pos = ports_map[new_dest]["position"]
                route = compute_route(pos, dest_pos, restricted_zones)
                if len(route) > 1:
                    route = route[1:]
                fleet_state[ship_id]["route"] = route
            except Exception:
                fleet_state[ship_id]["route"] = [ports_map[new_dest]["position"]]

    fleet_state[ship_id].setdefault("directives", []).append({"command": command, "message": message})
    return True


def get_state_snapshot() -> Dict[str, Any]:
    """Return a snapshot dict for history writing."""
    return {
        "ships": [copy.deepcopy(s) for s in fleet_state.values()],
        "alerts_count": len([a for a in get_all_alerts_serializable() if not a.get("resolved")]),
        "zones_count": len(restricted_zones),
    }
