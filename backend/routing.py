"""
routing.py — Shapely geometry: navigable polygon, restricted zones, A* pathfinding.
Uses inline haversine_km (no external geopy).
"""
import math
import heapq
from typing import List, Tuple, Optional
from shapely.geometry import Point, Polygon, LineString, MultiPolygon
from shapely.ops import unary_union


# ---------------------------------------------------------------------------
# Haversine distance (inline — no external dependency)
# ---------------------------------------------------------------------------

def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in kilometres between two lat/lng points."""
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ---------------------------------------------------------------------------
# Navigable water polygon (built from fleet.json at startup)
# ---------------------------------------------------------------------------

_navigable_polygon: Optional[Polygon] = None


def build_navigable_polygon(coords: List[List[float]]) -> None:
    """Build the Shapely navigable-water polygon from fleet.json coords.

    BUG-03 FIX: Wrapped in try/except. A degenerate polygon (e.g. < 3 unique
    points, or collinear) raises TopologicalError from Shapely. We log a
    warning and leave _navigable_polygon as None rather than crashing startup.
    """
    global _navigable_polygon
    if len(coords) < 3:
        print("[routing] WARNING: navigableWater has fewer than 3 points — skipping polygon build.")
        return
    try:
        shapely_coords = [(c[1], c[0]) for c in coords]  # [lat,lng] → (x=lng, y=lat)
        _navigable_polygon = Polygon(shapely_coords).buffer(0)  # buffer(0) fixes self-intersections
    except Exception as e:
        print(f"[routing] WARNING: Could not build navigable polygon: {e}")
        _navigable_polygon = None


def get_navigable_polygon() -> Optional[Polygon]:
    return _navigable_polygon


def is_navigable(lat: float, lng: float) -> bool:
    """Return True if the (lat, lng) point is inside the navigable water polygon.

    If the polygon was never built (degenerate data), we default to True so
    the simulation doesn't freeze every ship.
    """
    if _navigable_polygon is None:
        return True
    return _navigable_polygon.contains(Point(lng, lat))


# ---------------------------------------------------------------------------
# Restricted zones
# ---------------------------------------------------------------------------

def build_zone_polygon(polygon_coords: List[List[float]]) -> Optional[Polygon]:
    """Convert a list of [lat, lng] pairs to a Shapely Polygon.

    Returns None on degenerate input (fewer than 3 points or topology error)
    so callers must guard against None before calling .contains().
    """
    if len(polygon_coords) < 3:
        return None
    try:
        shapely_coords = [(c[1], c[0]) for c in polygon_coords]
        return Polygon(shapely_coords).buffer(0)
    except Exception:
        return None


def is_in_restricted_zone(lat: float, lng: float, zones: List[dict]) -> Optional[str]:
    """
    Returns the zoneId of the first active restricted zone containing (lat, lng),
    or None if the point is not in any zone.
    Guards against None polygons from build_zone_polygon (BUG-03 fix).
    """
    pt = Point(lng, lat)
    for zone in zones:
        if not zone.get("active", True):
            continue
        poly = build_zone_polygon(zone["polygon"])
        if poly is None:
            continue  # degenerate zone — skip safely
        if poly.contains(pt):
            return zone["zoneId"]
    return None


def point_in_any_zone(lat: float, lng: float, zones: List[dict]) -> bool:
    return is_in_restricted_zone(lat, lng, zones) is not None


# ---------------------------------------------------------------------------
# A* pathfinding with restricted zone avoidance
# ---------------------------------------------------------------------------

def _lat_lng_to_key(lat: float, lng: float, precision: int = 3) -> Tuple[float, float]:
    return (round(lat, precision), round(lng, precision))


def compute_route(
    start: List[float],
    dest: List[float],
    zones: List[dict],
    grid_step: float = 0.2,
    max_nodes: int = 5000,
) -> List[List[float]]:
    """
    A* route from start [lat, lng] to dest [lat, lng] avoiding LAND and
    restricted polygons. The navigable water polygon is the primary constraint;
    any point outside it is treated as land / impassable.
    Falls back to straight line if A* exceeds max_nodes.
    Returns list of [lat, lng] waypoints including start and dest.
    """
    # Build restricted-zone obstacle (may be empty)
    active_zones = [z for z in zones if z.get("active", True)]
    obstacle = None
    if active_zones:
        zone_polys = [p for p in
                      (build_zone_polygon(z["polygon"]) for z in active_zones)
                      if p is not None]
        if zone_polys:
            obstacle = unary_union([p.buffer(0.05) for p in zone_polys])

    def blocked(lat: float, lng: float) -> bool:
        """A cell is blocked if it is on land OR inside a restricted zone."""
        if not is_navigable(lat, lng):
            return True  # on land
        if obstacle is not None and obstacle.contains(Point(lng, lat)):
            return True  # inside restricted zone
        return False

    def h(a: Tuple[float, float], b: Tuple[float, float]) -> float:
        return haversine_km(a[0], a[1], b[0], b[1])

    start_k = _lat_lng_to_key(start[0], start[1])
    dest_k = _lat_lng_to_key(dest[0], dest[1])

    open_set: List[Tuple[float, Tuple[float, float]]] = []
    heapq.heappush(open_set, (0.0, start_k))
    came_from: dict = {}
    g_score: dict = {start_k: 0.0}
    visited = set()

    # 8-directional movement on a lat/lng grid
    directions = [
        (grid_step, 0), (-grid_step, 0), (0, grid_step), (0, -grid_step),
        (grid_step, grid_step), (grid_step, -grid_step),
        (-grid_step, grid_step), (-grid_step, -grid_step),
    ]

    nodes_explored = 0
    while open_set:
        if nodes_explored > max_nodes:
            # Fallback: straight line (better than no movement)
            print(f"[routing] A* exceeded {max_nodes} nodes, falling back to straight line")
            return [start, dest]

        _, current = heapq.heappop(open_set)
        if current in visited:
            continue
        visited.add(current)
        nodes_explored += 1

        if haversine_km(current[0], current[1], dest_k[0], dest_k[1]) < grid_step * 111:
            # Reconstruct path
            path = [dest]
            node = current
            while node in came_from:
                path.append([node[0], node[1]])
                node = came_from[node]
            path.append(start)
            path.reverse()
            return path

        for dlat, dlng in directions:
            neighbor = _lat_lng_to_key(current[0] + dlat, current[1] + dlng)
            if blocked(neighbor[0], neighbor[1]):
                continue
            tentative_g = g_score[current] + haversine_km(current[0], current[1], neighbor[0], neighbor[1])
            if neighbor not in g_score or tentative_g < g_score[neighbor]:
                came_from[neighbor] = current
                g_score[neighbor] = tentative_g
                f = tentative_g + h(neighbor, dest_k)
                heapq.heappush(open_set, (f, neighbor))

    # No path found — fall back to straight line
    print("[routing] A* found no path, falling back to straight line")
    return [start, dest]


# ---------------------------------------------------------------------------
# Segment intersection check (for real-time crossing detection)
# ---------------------------------------------------------------------------

def route_crosses_zone(waypoints: List[List[float]], zone: dict) -> bool:
    """Returns True if the polyline through waypoints crosses the restricted zone."""
    if len(waypoints) < 2:
        return False
    shapely_line = LineString([(w[1], w[0]) for w in waypoints])
    zone_poly = build_zone_polygon(zone["polygon"])
    return shapely_line.intersects(zone_poly)
