"""Tests for state_machine — drone mission state transitions."""

import pytest
from state_machine import StateMachine, DroneState, MissionContext


class TestStateMachine:
    def setup_method(self):
        self.sm = StateMachine()

    def test_initial_state_is_input(self):
        assert self.sm.state == DroneState.INPUT

    def test_initial_context(self):
        ctx = self.sm.context
        assert ctx.target_address == ""
        assert ctx.target_lat == 0.0
        assert ctx.target_lng == 0.0
        assert ctx.reference_photo_bytes is None
        assert ctx.waypoints == []

    def test_valid_transition_input_to_navigation(self):
        result = self.sm.transition(DroneState.NAVIGATION)
        assert result is True
        assert self.sm.state == DroneState.NAVIGATION

    def test_invalid_transition_input_to_identification(self):
        result = self.sm.transition(DroneState.IDENTIFICATION)
        assert result is False
        assert self.sm.state == DroneState.INPUT

    def test_full_mission_flow(self):
        assert self.sm.transition(DroneState.NAVIGATION) is True
        assert self.sm.transition(DroneState.IDENTIFICATION) is True
        assert self.sm.transition(DroneState.APPROACH) is True
        assert self.sm.transition(DroneState.DELIVERY) is True
        assert self.sm.transition(DroneState.DONE) is True
        assert self.sm.state == DroneState.DONE

    def test_done_to_input_restart(self):
        self.sm.transition(DroneState.NAVIGATION)
        self.sm.transition(DroneState.IDENTIFICATION)
        self.sm.transition(DroneState.APPROACH)
        self.sm.transition(DroneState.DELIVERY)
        self.sm.transition(DroneState.DONE)
        result = self.sm.transition(DroneState.INPUT)
        assert result is True
        assert self.sm.state == DroneState.INPUT

    def test_approach_can_go_back_to_identification(self):
        self.sm.transition(DroneState.NAVIGATION)
        self.sm.transition(DroneState.IDENTIFICATION)
        self.sm.transition(DroneState.APPROACH)
        result = self.sm.transition(DroneState.IDENTIFICATION)
        assert result is True
        assert self.sm.state == DroneState.IDENTIFICATION

    def test_abort_from_navigation(self):
        self.sm.transition(DroneState.NAVIGATION)
        result = self.sm.abort()
        assert result is True
        assert self.sm.state == DroneState.HOVER

    def test_abort_from_identification(self):
        self.sm.transition(DroneState.NAVIGATION)
        self.sm.transition(DroneState.IDENTIFICATION)
        result = self.sm.abort()
        assert result is True
        assert self.sm.state == DroneState.HOVER

    def test_abort_from_approach(self):
        self.sm.transition(DroneState.NAVIGATION)
        self.sm.transition(DroneState.IDENTIFICATION)
        self.sm.transition(DroneState.APPROACH)
        result = self.sm.abort()
        assert result is True
        assert self.sm.state == DroneState.HOVER

    def test_abort_from_done_fails(self):
        self.sm.transition(DroneState.NAVIGATION)
        self.sm.transition(DroneState.IDENTIFICATION)
        self.sm.transition(DroneState.APPROACH)
        self.sm.transition(DroneState.DELIVERY)
        self.sm.transition(DroneState.DONE)
        result = self.sm.abort()
        assert result is False
        assert self.sm.state == DroneState.DONE

    def test_abort_from_hover_fails(self):
        self.sm.transition(DroneState.NAVIGATION)
        self.sm.abort()
        result = self.sm.abort()
        assert result is False
        assert self.sm.state == DroneState.HOVER

    def test_hover_transitions(self):
        self.sm.transition(DroneState.NAVIGATION)
        self.sm.abort()
        assert self.sm.state == DroneState.HOVER
        # Can resume navigation
        result = self.sm.transition(DroneState.NAVIGATION)
        assert result is True
        assert self.sm.state == DroneState.NAVIGATION

    def test_hover_to_input(self):
        self.sm.transition(DroneState.NAVIGATION)
        self.sm.abort()
        result = self.sm.transition(DroneState.INPUT)
        assert result is True
        assert self.sm.state == DroneState.INPUT

    def test_set_target(self):
        self.sm.set_target("123 Main St", 40.7, -74.0, b"photo_data", "Hello!")
        ctx = self.sm.context
        assert ctx.target_address == "123 Main St"
        assert ctx.target_lat == 40.7
        assert ctx.target_lng == -74.0
        assert ctx.reference_photo_bytes == b"photo_data"
        assert ctx.delivery_message == "Hello!"

    def test_set_route(self):
        waypoints = [{"lat": 40.0, "lng": -74.0}, {"lat": 40.1, "lng": -74.1}]
        self.sm.set_route(waypoints)
        assert self.sm.context.waypoints == waypoints
        assert self.sm.context.current_waypoint_idx == 0

    def test_update_position(self):
        self.sm.update_position(40.7, -74.0, 30.0)
        assert self.sm.context.current_lat == 40.7
        assert self.sm.context.current_lng == -74.0
        assert self.sm.context.current_alt == 30.0

    def test_state_entered_at_updates_on_transition(self):
        t1 = self.sm.context.state_entered_at
        import time
        time.sleep(0.01)
        self.sm.transition(DroneState.NAVIGATION)
        t2 = self.sm.context.state_entered_at
        assert t2 > t1

    def test_listener_called_on_transition(self):
        calls = []
        self.sm.add_listener(lambda old, new, ctx: calls.append((old, new)))
        self.sm.transition(DroneState.NAVIGATION)
        assert len(calls) == 1
        assert calls[0] == (DroneState.INPUT, DroneState.NAVIGATION)

    def test_listener_called_on_abort(self):
        calls = []
        self.sm.transition(DroneState.NAVIGATION)
        self.sm.add_listener(lambda old, new, ctx: calls.append((old, new)))
        self.sm.abort()
        assert len(calls) == 1
        assert calls[0] == (DroneState.NAVIGATION, DroneState.HOVER)

    def test_listener_exception_does_not_break_transition(self):
        def bad_listener(old, new, ctx):
            raise RuntimeError("boom")
        self.sm.add_listener(bad_listener)
        result = self.sm.transition(DroneState.NAVIGATION)
        assert result is True
        assert self.sm.state == DroneState.NAVIGATION
