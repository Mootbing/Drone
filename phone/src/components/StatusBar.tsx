/**
 * StatusBar — Connection status and mode indicator at top of WatchScreen.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { DroneMode } from '../types/protocol';

type Props = {
  mode: DroneMode;
  message: string;
  connected: boolean;
};

export default function StatusBar({ mode, message, connected }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={[styles.dot, connected ? styles.dotGreen : styles.dotRed]} />
        <Text style={styles.connectionText}>
          {connected ? 'Connected' : 'Disconnected'}
        </Text>
      </View>
      <Text style={styles.message} numberOfLines={2}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingTop: 40,
    paddingBottom: 10,
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  dotGreen: { backgroundColor: '#2ecc71' },
  dotRed: { backgroundColor: '#e74c3c' },
  connectionText: {
    color: '#ccc',
    fontSize: 12,
  },
  message: {
    color: '#fff',
    fontSize: 14,
  },
});
