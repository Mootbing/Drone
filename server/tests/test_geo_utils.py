"""Tests for navigation.geo_utils — haversine distance calculation."""

import pytest
from navigation.geo_utils import haversine_m


class TestHaversineM:
    def test_same_point_returns_zero(self):
        assert haversine_m(40.7128, -74.0060, 40.7128, -74.0060) == 0.0

    def test_known_distance_nyc_to_la(self):
        # NYC to LA is approximately 3,944 km
        dist = haversine_m(40.7128, -74.0060, 34.0522, -118.2437)
        assert 3_930_000 < dist < 3_960_000

    def test_known_distance_short(self):
        # ~111 km per degree of latitude at equator
        dist = haversine_m(0.0, 0.0, 1.0, 0.0)
        assert 110_000 < dist < 112_000

    def test_symmetric(self):
        d1 = haversine_m(40.0, -74.0, 41.0, -73.0)
        d2 = haversine_m(41.0, -73.0, 40.0, -74.0)
        assert abs(d1 - d2) < 0.01

    def test_very_close_points(self):
        # ~10 meters apart
        dist = haversine_m(40.7128, -74.0060, 40.71289, -74.0060)
        assert 5 < dist < 15

    def test_antipodal_points(self):
        # North pole to south pole — half circumference (~20,000 km)
        dist = haversine_m(90.0, 0.0, -90.0, 0.0)
        assert 20_000_000 < dist < 20_050_000
