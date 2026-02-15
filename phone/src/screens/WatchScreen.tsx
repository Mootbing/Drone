/**
 * WatchScreen — Streams screen capture to PC via USB.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, NativeModules, Dimensions, Alert } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import wsService from '../services/WebSocketService';
import screenCapture from '../services/ScreenCapture';
import { launchDroneApp } from './SettingsScreen';
import { getActionPoints } from './ActionRecorderScreen';

type Props = {
  navigation: NativeStackNavigationProp<any>;
  route: { params?: { deliveryMessage?: string; testMode?: boolean } };
};

export default function WatchScreen({ navigation, route }: Props) {
  const [status, setStatus] = useState('Starting...');

  useEffect(() => {
    let frameUnsub: (() => void) | null = null;

    const launchAndTap = async () => {
      // Check accessibility service first
      let serviceEnabled = false;
      try {
        serviceEnabled = await NativeModules.TouchInjectorModule.isServiceEnabled();
      } catch {}

      if (!serviceEnabled) {
        Alert.alert(
          'Accessibility Service Required',
          'Enable "Drone Control" in Settings > Accessibility to allow automated taps.',
          [
            { text: 'Open Settings', onPress: () => NativeModules.TouchInjectorModule?.openAccessibilitySettings() },
            { text: 'Skip', style: 'cancel' },
          ],
        );
      }

      launchDroneApp();

      const takeoffPts = getActionPoints().takeoff;
      if (takeoffPts && takeoffPts.length > 0 && serviceEnabled) {
        const screen = Dimensions.get('screen');
        setTimeout(async () => {
          const pt = takeoffPts[0];
          const absX = pt.rx * screen.width;
          const absY = pt.ry * screen.height;
          console.log(`[Takeoff] Tapping at (${absX}, ${absY}) screen=${screen.width}x${screen.height}`);
          try {
            await NativeModules.TouchInjectorModule.injectTap(absX, absY);
            console.log('[Takeoff] Tap succeeded');
          } catch (e: any) {
            console.error('[Takeoff] Tap failed:', e?.message);
          }
        }, 3000);
      }
    };

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

        // After capture confirmed, launch drone app and tap takeoff
        if (!route.params?.testMode) {
          launchAndTap();
        }
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
