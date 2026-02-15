"""Tests for identification.approach — bbox-based approach guidance."""

import pytest
from identification.approach import compute_approach_command


FRAME_W = 1280
FRAME_H = 720


class TestComputeApproachCommand:
    def test_arrived_when_bbox_fills_frame(self):
        # Person occupies >15% of frame → arrived
        # 15% of 1280*720 = 138,240 px. bbox 500x300 = 150,000 px
        cmd = compute_approach_command([390, 210, 890, 510], FRAME_W, FRAME_H)
        assert cmd.get("arrived") is True

    def test_not_arrived_when_bbox_small(self):
        # Small bbox in center
        cmd = compute_approach_command([600, 320, 680, 400], FRAME_W, FRAME_H)
        assert cmd.get("arrived") is not True
        assert "direction" in cmd

    def test_centered_small_bbox_goes_forward(self):
        # Small person centered in frame → forward
        cmd = compute_approach_command([590, 310, 690, 410], FRAME_W, FRAME_H)
        assert cmd["direction"] == "forward"

    def test_person_on_right_goes_right(self):
        # Person on the right side of frame
        cmd = compute_approach_command([900, 310, 1000, 410], FRAME_W, FRAME_H)
        assert cmd["direction"] == "right"

    def test_person_on_left_goes_left(self):
        # Person on the left side of frame
        cmd = compute_approach_command([100, 310, 200, 410], FRAME_W, FRAME_H)
        assert cmd["direction"] == "left"

    def test_person_above_goes_up(self):
        # Person at top of frame
        cmd = compute_approach_command([590, 50, 690, 150], FRAME_W, FRAME_H)
        assert cmd["direction"] == "up"

    def test_person_below_goes_down(self):
        # Person at bottom of frame
        cmd = compute_approach_command([590, 550, 690, 680], FRAME_W, FRAME_H)
        assert cmd["direction"] == "down"

    def test_intensity_proportional_to_offset(self):
        # Far right → higher intensity than slightly right
        cmd_far = compute_approach_command([1100, 310, 1200, 410], FRAME_W, FRAME_H)
        cmd_near = compute_approach_command([700, 310, 800, 410], FRAME_W, FRAME_H)
        assert cmd_far["intensity"] > cmd_near["intensity"]

    def test_intensity_capped_at_0_8(self):
        cmd = compute_approach_command([1200, 310, 1280, 410], FRAME_W, FRAME_H)
        assert cmd["intensity"] <= 0.8

    def test_command_has_duration(self):
        cmd = compute_approach_command([590, 310, 690, 410], FRAME_W, FRAME_H)
        assert "duration_ms" in cmd
        assert cmd["duration_ms"] > 0

    def test_zero_area_frame_no_crash(self):
        cmd = compute_approach_command([0, 0, 0, 0], 0, 0)
        # Should not crash — frame_area max(0,1) = 1
        assert cmd is not None
