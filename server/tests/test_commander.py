"""Tests for navigation.commander — GPS bearing and movement commands."""

import pytest
from navigation.commander import compute_navigation_command, _compute_bearing


class TestComputeBearing:
    def test_due_north(self):
        # Target is directly north
        bearing = _compute_bearing(40.0, -74.0, 41.0, -74.0)
        assert 359 < bearing or bearing < 1

    def test_due_east(self):
        bearing = _compute_bearing(40.0, -74.0, 40.0, -73.0)
        assert 89 < bearing < 91

    def test_due_south(self):
        bearing = _compute_bearing(41.0, -74.0, 40.0, -74.0)
        assert 179 < bearing < 181

    def test_due_west(self):
        bearing = _compute_bearing(40.0, -73.0, 40.0, -74.0)
        assert 269 < bearing < 271

    def test_northeast(self):
        bearing = _compute_bearing(40.0, -74.0, 41.0, -73.0)
        assert 30 < bearing < 60

    def test_bearing_always_positive(self):
        # All bearings should be in [0, 360)
        for lat2, lng2 in [(41, -74), (39, -74), (40, -73), (40, -75)]:
            b = _compute_bearing(40.0, -74.0, lat2, lng2)
            assert 0 <= b < 360


class TestComputeNavigationCommand:
    def test_target_ahead_returns_forward(self):
        # Target due north, heading north
        cmd = compute_navigation_command(40.0, -74.0, 41.0, -74.0, drone_heading=0.0)
        assert cmd["direction"] == "forward"
        assert 0 < cmd["intensity"] <= 1.0

    def test_target_behind_returns_rotate(self):
        # Target due south, heading north
        cmd = compute_navigation_command(41.0, -74.0, 40.0, -74.0, drone_heading=0.0)
        assert cmd["direction"] in ("rotate_cw", "rotate_ccw")

    def test_target_right_returns_rotate_cw(self):
        # Target due east, heading north
        cmd = compute_navigation_command(40.0, -74.0, 40.0, -73.0, drone_heading=0.0)
        assert cmd["direction"] == "rotate_cw"

    def test_target_left_returns_rotate_ccw(self):
        # Target due west, heading north
        cmd = compute_navigation_command(40.0, -73.0, 40.0, -74.0, drone_heading=0.0)
        assert cmd["direction"] == "rotate_ccw"

    def test_intensity_scales_with_distance(self):
        # Far away → high intensity
        cmd_far = compute_navigation_command(40.0, -74.0, 41.0, -74.0, drone_heading=0.0)
        # Close → low intensity
        cmd_close = compute_navigation_command(40.0, -74.0, 40.0001, -74.0, drone_heading=0.0)
        assert cmd_far["intensity"] >= cmd_close["intensity"]

    def test_heading_aligned_goes_forward(self):
        # Target is east, drone is facing east (heading=90)
        cmd = compute_navigation_command(40.0, -74.0, 40.0, -73.0, drone_heading=90.0)
        assert cmd["direction"] == "forward"

    def test_default_heading_is_zero(self):
        cmd = compute_navigation_command(40.0, -74.0, 41.0, -74.0)
        assert cmd["direction"] == "forward"

    def test_command_has_duration(self):
        cmd = compute_navigation_command(40.0, -74.0, 41.0, -74.0)
        assert "duration_ms" in cmd
        assert cmd["duration_ms"] > 0
