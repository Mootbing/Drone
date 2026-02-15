/**
 * WatchScreen — Main flight screen with overlay showing status and directions.
 * Runs screen capture and streams frames to PC; receives and executes commands.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import wsService from '../services/WebSocketService';
import screenCapture from '../services/ScreenCapture';
import droneControl from '../services/DroneControl';
import NavigationOverlay from '../components/NavigationOverlay';
import StatusBar from '../components/StatusBar';
import ManualControl from '../components/ManualControl';
import { DroneMode, PCToPhone, MovementCommand } from '../types/protocol';

type Props = {
  navigation: NativeStackNavigationProp<any>;
  route: { params?: { deliveryMessage?: string } };
};

export default function WatchScreen({ navigation, route }: Props) {
  const [mode, setMode] = useState<DroneMode>('navigation');
  const [statusMessage, setStatusMessage] = useState('Connecting...');
  const [lastDirection, setLastDirection] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [confidence, setConfidence] = useState<number | null>(null);
  const deliveryMessage = route.params?.deliveryMessage || 'You have a delivery!';

  // Handle incoming server messages
  useEffect(() => {
    const unsub = wsService.onMessage((msg: PCToPhone) => {
      switch (msg.type) {
        case 'command':
          handleCommand(msg as MovementCommand);
          break;
        case 'mode_change':
          setMode(msg.mode);
          setStatusMessage(msg.message);
          if (msg.mode === 'delivery') {
            navigation.navigate('Delivery', { message: msg.message || deliveryMessage });
          }
          break;
        case 'identified':
          if (msg.match) {
            setConfidence(msg.confidence);
            setStatusMessage(`Target found (${Math.round(msg.confidence)}% confidence)`);
          }
          break;
        case 'error':
          Alert.alert('Server Error', msg.message);
          break;
      }
    });

    return unsub;
  }, [navigation, deliveryMessage]);

  // Start screen capture on mount
  useEffect(() => {
    let frameUnsub: (() => void) | null = null;

    const startCapture = async () => {
      const started = await screenCapture.startCapture();
      if (!started) {
        setStatusMessage('Screen capture permission denied');
        return;
      }

      frameUnsub = screenCapture.onFrame((frameBase64) => {
        wsService.send({
          type: 'frame',
          timestamp: Date.now(),
          gps: { lat: 0, lng: 0, alt: 0 }, // TODO: integrate real GPS
          frame: frameBase64,
        });
      });

      setStatusMessage('Screen capture active');
    };

    startCapture();

    return () => {
      frameUnsub?.();
      screenCapture.stopCapture();
    };
  }, []);

  const handleCommand = useCallback(async (cmd: MovementCommand) => {
    setLastDirection(cmd.action === 'hover' ? 'HOVER' : cmd.direction);
    await droneControl.executeCommand(cmd);
  }, []);

  const handleAbort = useCallback(() => {
    Alert.alert(
      'Abort Mission',
      'This will stop the drone and hover in place. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Abort',
          style: 'destructive',
          onPress: () => {
            wsService.send({ type: 'abort' });
            setMode('hover');
            setStatusMessage('Mission aborted — hovering');
          },
        },
      ],
    );
  }, []);

  return (
    <View style={styles.container}>
      {/* Semi-transparent overlay */}
      <StatusBar
        mode={mode}
        message={statusMessage}
        connected={wsService.isConnected}
      />

      <NavigationOverlay
        direction={lastDirection}
        mode={mode}
        confidence={confidence}
      />

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity style={styles.abortBtn} onPress={handleAbort}>
          <Text style={styles.abortText}>ABORT</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.manualBtn}
          onPress={() => setShowManual(!showManual)}
        >
          <Text style={styles.manualText}>
            {showManual ? 'Auto' : 'Manual'}
          </Text>
        </TouchableOpacity>
      </View>

      {showManual && <ManualControl />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  controls: {
    position: 'absolute',
    bottom: 30,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 20,
  },
  abortBtn: {
    backgroundColor: '#e74c3c',
    paddingHorizontal: 30,
    paddingVertical: 14,
    borderRadius: 30,
    elevation: 5,
  },
  abortText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  manualBtn: {
    backgroundColor: '#3498db',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 30,
    elevation: 5,
  },
  manualText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
