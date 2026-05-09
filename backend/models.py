from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from enum import Enum
from datetime import datetime


class ShipStatus(str, Enum):
    normal = "normal"
    warning = "warning"
    critical = "critical"
    distress = "distress"
    anchored = "anchored"
    diverted = "diverted"


class AlertPriority(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class AlertType(str, Enum):
    geofence = "geofence"
    proximity = "proximity"
    fuel_low = "fuel_low"
    distress = "distress"
    weather = "weather"
    directive = "directive"


class Ship(BaseModel):
    shipId: str
    name: str
    position: List[float]          # [lat, lng]
    speed: float                   # knots
    heading: float                 # degrees true north 0-360
    destination: str               # port ID
    fuel: float                    # tons
    cargo: str
    status: ShipStatus = ShipStatus.normal
    fuel_penalty_active: bool = False
    directives: List[str] = Field(default_factory=list)
    route: List[List[float]] = Field(default_factory=list)


class Port(BaseModel):
    id: str
    name: str
    position: List[float]          # [lat, lng]


class RestrictedZone(BaseModel):
    zoneId: str
    name: str
    polygon: List[List[float]]     # list of [lat, lng] pairs
    created_at: datetime = Field(default_factory=datetime.utcnow)
    active: bool = True


class Directive(BaseModel):
    directiveId: str
    shipId: str
    command: str                   # e.g. "DIVERT", "ANCHOR", "RESUME", "SPEED_REDUCE"
    message: str
    issued_at: datetime = Field(default_factory=datetime.utcnow)
    acknowledged: bool = False
    response: Optional[str] = None


class Alert(BaseModel):
    alertId: str
    type: AlertType
    priority: AlertPriority
    shipId: Optional[str] = None
    message: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    resolved: bool = False
    dedup_key: str = ""            # used for deduplication


class DistressMessage(BaseModel):
    shipId: str
    raw_text: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class ParsedDistress(BaseModel):
    shipId: str
    raw_text: str
    severity: str                  # "low" | "medium" | "high" | "critical"
    incident_type: str             # e.g. "engine failure", "fire", "medical"
    recommended_action: str
    coordinates_mentioned: Optional[List[float]] = None
    parsed_at: datetime = Field(default_factory=datetime.utcnow)


class FleetSnapshot(BaseModel):
    snapshot_id: Optional[int] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    ships: List[Dict[str, Any]]
    alerts_count: int
    restricted_zones_count: int


class WebSocketMessage(BaseModel):
    type: str
    payload: Dict[str, Any]


class FleetStateUpdate(BaseModel):
    type: str = "fleet_update"
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    ships: List[Dict[str, Any]]
    alerts: List[Dict[str, Any]]
    restricted_zones: List[Dict[str, Any]]
    weather: Dict[str, Any] = Field(default_factory=dict)
    tick: int = 0
