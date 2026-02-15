/**
 * DeliveryScreen — Displayed when drone reaches the target person.
 * Shows delivery message fullscreen and waits for confirmation.
 */

import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import wsService from '../services/WebSocketService';

type Props = {
  navigation: NativeStackNavigationProp<any>;
  route: { params?: { message?: string } };
};

export default function DeliveryScreen({ navigation, route }: Props) {
  const message = route.params?.message || 'You have a delivery!';

  const confirmDelivery = useCallback(() => {
    wsService.send({ type: 'delivery_confirmed' });
    navigation.navigate('Input');
  }, [navigation]);

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.icon}>DELIVERY</Text>
        <Text style={styles.message}>{message}</Text>
      </View>

      <TouchableOpacity style={styles.confirmBtn} onPress={confirmDelivery}>
        <Text style={styles.confirmText}>Confirm Delivery</Text>
      </TouchableOpacity>

      <Text style={styles.hint}>
        The drone will return home after confirmation.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  card: {
    backgroundColor: '#16213e',
    borderRadius: 20,
    padding: 40,
    alignItems: 'center',
    width: '100%',
    borderWidth: 2,
    borderColor: '#e94560',
    elevation: 10,
  },
  icon: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#e94560',
    marginBottom: 20,
    letterSpacing: 4,
  },
  message: {
    fontSize: 22,
    color: '#fff',
    textAlign: 'center',
    lineHeight: 32,
  },
  confirmBtn: {
    backgroundColor: '#2ecc71',
    paddingHorizontal: 40,
    paddingVertical: 16,
    borderRadius: 30,
    marginTop: 40,
    elevation: 5,
  },
  confirmText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  hint: {
    color: '#666',
    fontSize: 14,
    marginTop: 20,
    textAlign: 'center',
  },
});
