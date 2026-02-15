/**
 * NavigationOverlay — Shows direction arrows and mode-specific info
 * as a translucent overlay during flight.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { DroneMode } from '../types/protocol';

type Props = {
  direction: string;
  mode: DroneMode;
  confidence: number | null;
};

const DIRECTION_ARROWS: Record<string, string> = {
  forward: '^',
  back: 'v',
  left: '<',
  right: '>',
  up: 'UP',
  down: 'DN',
  rotate_cw: '>>',
  rotate_ccw: '<<',
  HOVER: '=',
  none: '-',
};

const MODE_COLORS: Record<string, string> = {
  navigation: '#3498db',
  identification: '#f39c12',
  approach: '#e74c3c',
  delivery: '#2ecc71',
  hover: '#95a5a6',
  input: '#9b59b6',
  done: '#2ecc71',
};

export default function NavigationOverlay({ direction, mode, confidence }: Props) {
  const arrow = DIRECTION_ARROWS[direction] || '-';
  const color = MODE_COLORS[mode] || '#fff';

  return (
    <View style={styles.container}>
      {/* Direction indicator */}
      <View style={[styles.arrowContainer, { borderColor: color }]}>
        <Text style={[styles.arrow, { color }]}>{arrow}</Text>
      </View>

      {/* Mode label */}
      <View style={[styles.modeBadge, { backgroundColor: color }]}>
        <Text style={styles.modeText}>{mode.toUpperCase()}</Text>
      </View>

      {/* Identification confidence */}
      {confidence !== null && mode === 'approach' && (
        <View style={styles.confidenceBadge}>
          <Text style={styles.confidenceText}>
            Match: {Math.round(confidence)}%
          </Text>
        </View>
      )}

      {/* Direction label */}
      {direction && direction !== 'none' && (
        <Text style={styles.directionLabel}>{direction.toUpperCase()}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  arrowContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  arrow: {
    fontSize: 36,
    fontWeight: 'bold',
  },
  modeBadge: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 12,
    marginTop: 12,
  },
  modeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  confidenceBadge: {
    backgroundColor: 'rgba(46, 204, 113, 0.8)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 8,
  },
  confidenceText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  directionLabel: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 12,
    marginTop: 6,
    letterSpacing: 2,
  },
});
