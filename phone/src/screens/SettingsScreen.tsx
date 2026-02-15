/**
 * SettingsScreen — Server config + reference photo for target person.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  StyleSheet,
  ScrollView,
  Alert,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import wsService from '../services/WebSocketService';

type Props = {
  navigation: NativeStackNavigationProp<any>;
  route: { params?: { referencePhoto?: string | null; onSave?: (photo: string | null, url: string) => void } };
};

const STORAGE_KEY = '@reference_photo';

// Global state so it persists across navigations
let _serverUrl = 'ws://localhost:8765/ws';
let _referencePhoto: string | null = null;
let _loaded = false;

export function getServerUrl() { return _serverUrl; }
export function getReferencePhoto() { return _referencePhoto; }
export function setGlobalReferencePhoto(p: string | null) { _referencePhoto = p; }

/** Load saved reference photo from storage. Call once at app startup. */
export async function loadReferencePhoto() {
  if (_loaded) return;
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (saved) _referencePhoto = saved;
    _loaded = true;
  } catch {}
}

async function savePhoto(base64: string | null) {
  _referencePhoto = base64;
  try {
    if (base64) {
      await AsyncStorage.setItem(STORAGE_KEY, base64);
    } else {
      await AsyncStorage.removeItem(STORAGE_KEY);
    }
  } catch {}
}

export default function SettingsScreen({ navigation, route }: Props) {
  const [serverUrl, setServerUrl] = useState(_serverUrl);
  const [connected, setConnected] = useState(wsService.isConnected);
  const [connecting, setConnecting] = useState(false);
  const [referencePhoto, setReferencePhoto] = useState<string | null>(_referencePhoto);

  // Load saved photo on mount
  useEffect(() => {
    loadReferencePhoto().then(() => setReferencePhoto(_referencePhoto));
  }, []);

  useEffect(() => {
    const unsub = wsService.onConnection((c) => {
      setConnected(c);
      setConnecting(false);
    });
    return () => unsub();
  }, []);

  const connectToServer = useCallback(() => {
    _serverUrl = serverUrl;
    wsService.disconnect();
    setConnecting(true);
    wsService.connect(serverUrl);
  }, [serverUrl]);

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
      savePhoto(result.assets[0].base64);
    }
  }, []);

  const takePhoto = useCallback(async () => {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        Alert.alert('Permission Denied', 'Camera permission is required.');
        return;
      }
    }
    const result = await launchCamera({
      mediaType: 'photo',
      includeBase64: true,
      maxWidth: 800,
      maxHeight: 800,
      quality: 0.8,
    });
    if (result.assets && result.assets[0]?.base64) {
      setReferencePhoto(result.assets[0].base64);
      savePhoto(result.assets[0].base64);
    }
  }, []);

  const clearPhoto = useCallback(() => {
    setReferencePhoto(null);
    savePhoto(null);
  }, []);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Server Connection */}
      <Text style={styles.sectionTitle}>Server</Text>
      <View style={styles.card}>
        <Text style={styles.label}>WebSocket URL</Text>
        <TextInput
          style={styles.input}
          value={serverUrl}
          onChangeText={setServerUrl}
          placeholder="ws://localhost:8765/ws"
          placeholderTextColor="#555"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <View style={styles.serverRow}>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, connected ? styles.dotGreen : styles.dotRed]} />
            <Text style={styles.statusText}>
              {connecting ? 'Connecting...' : connected ? 'Connected' : 'Disconnected'}
            </Text>
          </View>
          <TouchableOpacity style={styles.connectBtn} onPress={connectToServer}>
            <Text style={styles.connectBtnText}>
              {connected ? 'Reconnect' : 'Connect'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Reference Photo */}
      <Text style={styles.sectionTitle}>Target Person</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Reference Photo</Text>
        <Text style={styles.hint}>Upload a photo of the person to identify</Text>
        <View style={styles.photoRow}>
          <TouchableOpacity style={styles.photoBtn} onPress={pickPhoto}>
            <Text style={styles.photoBtnText}>Gallery</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.photoBtn} onPress={takePhoto}>
            <Text style={styles.photoBtnText}>Camera</Text>
          </TouchableOpacity>
          {referencePhoto && (
            <TouchableOpacity style={styles.photoBtnClear} onPress={clearPhoto}>
              <Text style={styles.photoBtnClearText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>
        {referencePhoto && (
          <Image
            source={{ uri: `data:image/jpeg;base64,${referencePhoto}` }}
            style={styles.preview}
            resizeMode="cover"
          />
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  content: { padding: 20, paddingBottom: 40 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginTop: 24,
    marginBottom: 10,
  },
  card: {
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#222',
  },
  label: {
    fontSize: 14,
    color: '#aaa',
    marginBottom: 8,
    fontWeight: '600',
  },
  hint: {
    fontSize: 12,
    color: '#555',
    marginBottom: 12,
  },
  input: {
    backgroundColor: '#000',
    color: '#fff',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#333',
    marginBottom: 12,
  },
  serverRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  dotGreen: { backgroundColor: '#2ecc71' },
  dotRed: { backgroundColor: '#e74c3c' },
  statusText: { color: '#888', fontSize: 13 },
  connectBtn: {
    backgroundColor: '#222',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  connectBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  photoRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  photoBtn: {
    backgroundColor: '#222',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  photoBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  photoBtnClear: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e74c3c33',
  },
  photoBtnClearText: { color: '#e74c3c', fontSize: 14, fontWeight: '600' },
  preview: {
    width: '100%',
    height: 200,
    borderRadius: 10,
  },
});
