/**
 * WatchScreen — Streams screen capture to PC via USB.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import wsService from '../services/WebSocketService';
import screenCapture from '../services/ScreenCapture';

type Props = {
  navigation: NativeStackNavigationProp<any>;
  route: { params?: { deliveryMessage?: string; testMode?: boolean } };
};

export default function WatchScreen({ navigation, route }: Props) {
  const [status, setStatus] = useState('Starting...');

  useEffect(() => {
    let frameUnsub: (() => void) | null = null;

    const startCapture = async () => {
      try {
        const started = await screenCapture.startCapture();
        if (!started) {
          setStatus('Permission denied');
          return;
        }

        frameUnsub = screenCapture.onFrame((frameBase64) => {
          wsService.send({
            type: 'frame',
            timestamp: Date.now(),
            gps: { lat: 0, lng: 0, alt: 0 },
            frame: frameBase64,
          });
        });

        setStatus('Streaming live via USB.\nDo not unplug.');
      } catch (err) {
        setStatus('Screen capture failed');
        console.error('Screen capture error:', err);
      }
    };

    startCapture();

    return () => {
      frameUnsub?.();
      screenCapture.stopCapture().catch(console.error);
    };
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.text}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 40,
    lineHeight: 30,
  },
});
