"""
alerts.py — Alert creation, deduplication, and priority queue management.
"""
import uuid
from datetime import datetime
from typing import List, Dict, Optional
from models import Alert, AlertType, AlertPriority

# In-memory alert store (recent alerts, capped to prevent unbounded growth)
_alerts: List[Alert] = []
_dedup_seen: Dict[str, datetime] = {}   # dedup_key → last_seen timestamp
_MAX_ALERTS = 500
_DEDUP_COOLDOWN_SECONDS = 300           # suppress re-triggering the same alert

# Proximity hysteresis: tracks pairs currently considered "in proximity"
# A pair must reach PROXIMITY_CLEAR_KM before it can re-trigger
_proximity_active: set = set()          # set of sorted pair strings e.g. "MV-1-MV-3"
PROXIMITY_TRIGGER_KM = 2.0
PROXIMITY_CLEAR_KM   = 2.2             # 10% hysteresis band


def _make_dedup_key(type: AlertType, ship_id: Optional[str], extra: str = "") -> str:
    return f"{type.value}:{ship_id or 'global'}:{extra}"


def create_alert(
    alert_type: AlertType,
    priority: AlertPriority,
    message: str,
    ship_id: Optional[str] = None,
    extra: str = "",
    force: bool = False,
) -> Optional[Alert]:
    """
    Create and store an alert. Returns None if deduplicated.
    Pass force=True to bypass deduplication (e.g., operator-triggered alerts).
    """
    dedup_key = _make_dedup_key(alert_type, ship_id, extra)
    now = datetime.utcnow()

    if not force:
        if dedup_key in _dedup_seen:
            elapsed = (now - _dedup_seen[dedup_key]).total_seconds()
            if elapsed < _DEDUP_COOLDOWN_SECONDS:
                return None  # Suppressed

    _dedup_seen[dedup_key] = now

    alert = Alert(
        alertId=str(uuid.uuid4()),
        type=alert_type,
        priority=priority,
        shipId=ship_id,
        message=message,
        created_at=now,
        dedup_key=dedup_key,
    )

    _alerts.append(alert)

    # Cap to _MAX_ALERTS most recent
    if len(_alerts) > _MAX_ALERTS:
        _alerts[:] = _alerts[-_MAX_ALERTS:]

    return alert


def get_active_alerts(limit: int = 100) -> List[Alert]:
    """Return the most recent `limit` unresolved alerts, highest priority first."""
    priority_order = {
        AlertPriority.critical: 0,
        AlertPriority.high: 1,
        AlertPriority.medium: 2,
        AlertPriority.low: 3,
    }
    active = [a for a in _alerts if not a.resolved]
    active_sorted = sorted(active, key=lambda a: priority_order.get(a.priority, 9))
    return active_sorted[:limit]


def resolve_alert(alert_id: str) -> bool:
    """Mark an alert as resolved. Returns True if found."""
    for alert in _alerts:
        if alert.alertId == alert_id:
            alert.resolved = True
            return True
    return False


def get_all_alerts_serializable() -> List[Dict]:
    return [a.model_dump(mode="json") for a in get_active_alerts()]


def check_fuel_alert(ship_id: str, ship_name: str, fuel: float) -> Optional[Alert]:
    """Create a fuel-low alert if fuel drops below threshold.

    BUG-01 FIX: The dedup 'extra' key is now a static severity tier string
    ('tier_critical' or 'tier_low'), NOT the rolling fuel quantity.
    Previously, extra=f'fuel_{int(fuel//100)*100}' generated a new unique key
    every time the ship crossed a 100t boundary, bypassing the 30s cooldown.
    """
    if fuel < 300:
        msg = f"{ship_name} CRITICAL FUEL: {fuel:.0f} tons remaining"
        return create_alert(AlertType.fuel_low, AlertPriority.critical, msg,
                            ship_id=ship_id, extra="tier_critical")
    if fuel < 1000:
        msg = f"{ship_name} LOW FUEL: {fuel:.0f} tons remaining"
        return create_alert(AlertType.fuel_low, AlertPriority.high, msg,
                            ship_id=ship_id, extra="tier_low")
    return None


def check_proximity_alert(ship1_id: str, ship1_name: str, ship2_id: str, ship2_name: str, dist_km: float) -> Optional[Alert]:
    """Create a proximity alert with hysteresis to prevent boundary strobing.

    BUG-05 FIX: Uses a _proximity_active set. A pair only fires an alert
    when it ENTERS the trigger zone (crosses below PROXIMITY_TRIGGER_KM).
    It is only removed from active when it clears PROXIMITY_CLEAR_KM.
    This prevents the alert from toggling every tick when ships hover at exactly 2.0 km.
    """
    global _proximity_active
    pair = "-".join(sorted([ship1_id, ship2_id]))

    if dist_km < PROXIMITY_TRIGGER_KM:
        if pair not in _proximity_active:
            _proximity_active.add(pair)
            msg = f"PROXIMITY WARNING: {ship1_name} & {ship2_name} are {dist_km:.2f} km apart"
            return create_alert(AlertType.proximity, AlertPriority.high, msg, extra=pair, force=True)
    elif dist_km >= PROXIMITY_CLEAR_KM:
        _proximity_active.discard(pair)
    return None


def check_geofence_alert(ship_id: str, ship_name: str, zone_id: str) -> Optional[Alert]:
    """Create a geofence violation alert."""
    msg = f"GEOFENCE VIOLATION: {ship_name} entered restricted zone {zone_id}"
    return create_alert(AlertType.geofence, AlertPriority.critical, msg, ship_id=ship_id, extra=zone_id)
