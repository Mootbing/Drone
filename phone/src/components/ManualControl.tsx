/**
 * ManualControl — Fallback manual drag-to-fly touch pad.
 * Allows user to manually send directional commands when auto-nav is disabled.
 */

import React, { useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  GestureResponderEvent,
  PanResponderGestureState,
} from 'react-native';
import wsService from '../services/WebSocketService';
import { Direction } from '../types/protocol';

const DEAD_ZONE = 20; // pixels before movement registers
const PAD_SIZE = 150;

export default function ManualControl() {
  const sendCommand = useCallback((direction: Direction, intensity: number) => {
    wsService.send({
      type: 'status',
      battery: 100,
      signal: 'strong',
      mode: 'navigation',
    });
    // Send as a frame-like message that triggers server command echo,
    // or directly inject via drone control
    const { droneControl } = require('../services/DroneControl');
    droneControl.executeCommand({
      type: 'command',
      action: 'move',
      direction,
      intensity,
      duration_ms: 300,
    });
  }, []);

  // Right pad: forward/back/left/right
  const rightPad = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_: GestureResponderEvent, gs: PanResponderGestureState) => {
        const { dx, dy } = gs;
        if (Math.abs(dx) < DEAD_ZONE && Math.abs(dy) < DEAD_ZONE) return;

        const intensity = Math.min(1, Math.max(Math.abs(dx), Math.abs(dy)) / 100);

        if (Math.abs(dx) > Math.abs(dy)) {
          sendCommand(dx > 0 ? 'right' : 'left', intensity);
        } else {
          sendCommand(dy < 0 ? 'forward' : 'back', intensity);
        }
      },
    }),
  ).current;

  // Left pad: up/down/rotate
  const leftPad = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_: GestureResponderEvent, gs: PanResponderGestureState) => {
        const { dx, dy } = gs;
        if (Math.abs(dx) < DEAD_ZONE && Math.abs(dy) < DEAD_ZONE) return;

        const intensity = Math.min(1, Math.max(Math.abs(dx), Math.abs(dy)) / 100);

        if (Math.abs(dx) > Math.abs(dy)) {
          sendCommand(dx > 0 ? 'rotate_cw' : 'rotate_ccw', intensity);
        } else {
          sendCommand(dy < 0 ? 'up' : 'down', intensity);
        }
      },
    }),
  ).current;

  return (
    <View style={styles.container}>
      {/* Left pad: altitude + yaw */}
      <View style={styles.padWrapper}>
        <Text style={styles.padLabel}>ALT / YAW</Text>
        <View style={styles.pad} {...leftPad.panHandlers}>
          <Text style={styles.padCenter}>+</Text>
        </View>
      </View>

      {/* Right pad: pitch + roll */}
      <View style={styles.padWrapper}>
        <Text style={styles.padLabel}>FWD / STRAFE</Text>
        <View style={styles.pad} {...rightPad.panHandlers}>
          <Text style={styles.padCenter}>+</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 100,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 30,
  },
  padWrapper: {
    alignItems: 'center',
  },
  padLabel: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 10,
    marginBottom: 6,
    letterSpacing: 1,
  },
  pad: {
    width: PAD_SIZE,
    height: PAD_SIZE,
    borderRadius: PAD_SIZE / 2,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  padCenter: {
    color: 'rgba(255, 255, 255, 0.4)',
    fontSize: 24,
  },
});
