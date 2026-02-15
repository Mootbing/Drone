/**
 * InputScreen — Address + target person entry.
 * User enters delivery address, picks a reference photo, and types a delivery message.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  StyleSheet,
  Alert,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import wsService from '../services/WebSocketService';

type Props = {
  navigation: NativeStackNavigationProp<any>;
};

export default function InputScreen({ navigation }: Props) {
  const [address, setAddress] = useState('');
  const [referencePhoto, setReferencePhoto] = useState<string | null>(null);
  const [deliveryMessage, setDeliveryMessage] = useState('');
  const [serverUrl, setServerUrl] = useState('ws://192.168.1.100:8765/ws');
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const connectionUnsubRef = useRef<(() => void) | null>(null);

  // Clean up connection listener on unmount
  useEffect(() => {
    return () => {
      connectionUnsubRef.current?.();
    };
  }, []);

  const pickPhoto = useCallback(async () => {
    const result = await launchImageLibrary({
      mediaType: 'photo',
      includeBase64: true,
      maxWidth: 800,
      maxHeight: 800,
      quality: 0.8,
    });

    if (result.assets && result.assets[0]?.base64) {
      setReferencePhoto(result.assets[0].base64);
    }
  }, []);

  const takePhoto = useCallback(async () => {
    const result = await launchCamera({
      mediaType: 'photo',
      includeBase64: true,
      maxWidth: 800,
      maxHeight: 800,
      quality: 0.8,
    });

    if (result.assets && result.assets[0]?.base64) {
      setReferencePhoto(result.assets[0].base64);
    }
  }, []);

  const connectToServer = useCallback(() => {
    connectionUnsubRef.current?.(); // clean up previous listener
    setConnecting(true);
    wsService.connect(serverUrl);

    connectionUnsubRef.current = wsService.onConnection((isConnected) => {
      setConnected(isConnected);
      setConnecting(false);
    });
  }, [serverUrl]);

  const startMission = useCallback(() => {
    if (!address.trim()) {
      Alert.alert('Error', 'Please enter a delivery address.');
      return;
    }
    if (!referencePhoto) {
      Alert.alert('Error', 'Please select a reference photo of the target person.');
      return;
    }
    if (!connected) {
      Alert.alert('Error', 'Not connected to server.');
      return;
    }

    // Send mission input to server
    wsService.send({
      type: 'mission_input',
      address: address.trim(),
      reference_photo: referencePhoto,
      delivery_message: deliveryMessage.trim() || 'You have a delivery!',
      gps: { lat: 0, lng: 0, alt: 0 }, // Will be filled by GPS module
    });

    navigation.navigate('Watch', { deliveryMessage: deliveryMessage.trim() });
  }, [address, referencePhoto, deliveryMessage, connected, navigation]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Drone Delivery</Text>

      {/* Server Connection */}
      <Text style={styles.label}>Server URL</Text>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, styles.flex1]}
          value={serverUrl}
          onChangeText={setServerUrl}
          placeholder="ws://192.168.1.100:8765/ws"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity
          style={[styles.btn, connected ? styles.btnConnected : styles.btnPrimary]}
          onPress={connectToServer}
          disabled={connecting || connected}
        >
          {connecting ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.btnText}>{connected ? 'Connected' : 'Connect'}</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Delivery Address */}
      <Text style={styles.label}>Delivery Address</Text>
      <TextInput
        style={styles.input}
        value={address}
        onChangeText={setAddress}
        placeholder="123 Main St, City, State"
        autoCapitalize="words"
      />

      {/* Reference Photo */}
      <Text style={styles.label}>Target Person Photo</Text>
      <View style={styles.row}>
        <TouchableOpacity style={styles.btn} onPress={pickPhoto}>
          <Text style={styles.btnText}>Gallery</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={takePhoto}>
          <Text style={styles.btnText}>Camera</Text>
        </TouchableOpacity>
      </View>
      {referencePhoto && (
        <Image
          source={{ uri: `data:image/jpeg;base64,${referencePhoto}` }}
          style={styles.preview}
          resizeMode="cover"
        />
      )}

      {/* Delivery Message */}
      <Text style={styles.label}>Delivery Message</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={deliveryMessage}
        onChangeText={setDeliveryMessage}
        placeholder="You have a delivery!"
        multiline
        numberOfLines={3}
      />

      {/* Start Mission */}
      <TouchableOpacity
        style={[styles.btn, styles.btnLarge, !connected && styles.btnDisabled]}
        onPress={startMission}
        disabled={!connected}
      >
        <Text style={styles.btnTextLarge}>Start Mission</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  content: { padding: 20 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#e94560', textAlign: 'center', marginBottom: 24 },
  label: { fontSize: 14, color: '#aaa', marginTop: 16, marginBottom: 6 },
  input: {
    backgroundColor: '#16213e',
    color: '#fff',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  multiline: { height: 80, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 10 },
  flex1: { flex: 1 },
  btn: {
    backgroundColor: '#0f3460',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: '#e94560' },
  btnConnected: { backgroundColor: '#2ecc71' },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  btnLarge: {
    backgroundColor: '#e94560',
    marginTop: 30,
    paddingVertical: 16,
  },
  btnTextLarge: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  preview: {
    width: 120,
    height: 120,
    borderRadius: 12,
    marginTop: 10,
    alignSelf: 'center',
  },
});
