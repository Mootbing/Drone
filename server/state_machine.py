"""Drone mission state machine.

States: INPUT → NAVIGATION → IDENTIFICATION → APPROACH → DELIVERY → DONE
Any state can transition to HOVER (abort/safety).
"""

from enum import Enum
from dataclasses import dataclass, field
from typing import Optional
import logging
import time

logger = logging.getLogger(__name__)


class DroneState(str, Enum):
    INPUT = "input"
    NAVIGATION = "navigation"
    IDENTIFICATION = "identification"
    APPROACH = "approach"
    DELIVERY = "delivery"
    DONE = "done"
    HOVER = "hover"


VALID_TRANSITIONS = {
    DroneState.INPUT: {DroneState.NAVIGATION, DroneState.HOVER},
    DroneState.NAVIGATION: {DroneState.IDENTIFICATION, DroneState.HOVER},
    DroneState.IDENTIFICATION: {DroneState.APPROACH, DroneState.HOVER},
    DroneState.APPROACH: {DroneState.DELIVERY, DroneState.IDENTIFICATION, DroneState.HOVER},
    DroneState.DELIVERY: {DroneState.DONE, DroneState.HOVER},
    DroneState.DONE: set(),
    DroneState.HOVER: {DroneState.NAVIGATION, DroneState.IDENTIFICATION, DroneState.INPUT},
}


@dataclass
class MissionContext:
    """Holds all mission data across state transitions."""
    # Target info (set during INPUT)
    target_address: str = ""
    target_lat: float = 0.0
    target_lng: float = 0.0
    reference_photo_bytes: Optional[bytes] = None
    delivery_message: str = ""

    # Route (set during NAVIGATION start)
    waypoints: list = field(default_factory=list)
    current_waypoint_idx: int = 0

    # Current drone position (updated each frame)
    current_lat: float = 0.0
    current_lng: float = 0.0
    current_alt: float = 0.0

    # Identification results
    target_bbox: Optional[list] = None
    match_confidence: float = 0.0

    # Timing
    state_entered_at: float = 0.0


class StateMachine:
    """Manages drone mission state transitions."""

    def __init__(self):
        self.state = DroneState.INPUT
        self.context = MissionContext()
        self.context.state_entered_at = time.time()
        self._listeners: list = []

    def add_listener(self, callback):
        """Register a callback for state changes: callback(old_state, new_state, context)."""
        self._listeners.append(callback)

    def transition(self, new_state: DroneState) -> bool:
        """Attempt to transition to a new state. Returns True if successful."""
        if new_state not in VALID_TRANSITIONS.get(self.state, set()):
            logger.warning(
                "Invalid transition: %s → %s (allowed: %s)",
                self.state, new_state, VALID_TRANSITIONS.get(self.state, set())
            )
            return False

        old_state = self.state
        self.state = new_state
        self.context.state_entered_at = time.time()
        logger.info("State transition: %s → %s", old_state, new_state)

        for listener in self._listeners:
            try:
                listener(old_state, new_state, self.context)
            except Exception:
                logger.exception("State change listener error")

        return True

    def abort(self) -> bool:
        """Emergency hover — allowed from any active state."""
        if self.state in (DroneState.DONE, DroneState.HOVER):
            return False
        old_state = self.state
        self.state = DroneState.HOVER
        self.context.state_entered_at = time.time()
        logger.warning("ABORT: %s → HOVER", old_state)
        for listener in self._listeners:
            try:
                listener(old_state, DroneState.HOVER, self.context)
            except Exception:
                logger.exception("State change listener error")
        return True

    def set_target(self, address: str, lat: float, lng: float,
                   reference_photo: bytes, delivery_message: str):
        """Set mission target during INPUT state."""
        ctx = self.context
        ctx.target_address = address
        ctx.target_lat = lat
        ctx.target_lng = lng
        ctx.reference_photo_bytes = reference_photo
        ctx.delivery_message = delivery_message

    def set_route(self, waypoints: list):
        """Set navigation waypoints."""
        self.context.waypoints = waypoints
        self.context.current_waypoint_idx = 0

    def update_position(self, lat: float, lng: float, alt: float):
        """Update current drone GPS position."""
        self.context.current_lat = lat
        self.context.current_lng = lng
        self.context.current_alt = alt
