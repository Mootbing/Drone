/**
 * SettingsScreen — Server config, drone app selection, reference photo.
 */

import React, { useState, useCallback, useEffect } from 'react';
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
  NativeModules,
  Modal,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import wsService from '../services/WebSocketService';

type Props = {
  navigation: NativeStackNavigationProp<any>;
  route: { params?: { referencePhoto?: string | null } };
};

type AppInfo = { packageName: string; appName: string; icon: string };

const STORAGE_KEY = '@reference_photo';
const DRONE_APP_KEY = '@drone_app_package';

// Global state
let _serverUrl = 'ws://localhost:8765/ws';
let _referencePhoto: string | null = null;
let _droneAppPkg: string | null = null;
let _droneAppName: string | null = null;
let _loaded = false;

export function getServerUrl() { return _serverUrl; }
export function getReferencePhoto() { return _referencePhoto; }
export function setGlobalReferencePhoto(p: string | null) { _referencePhoto = p; }
export function getDroneAppPackage() { return _droneAppPkg; }

export async function loadReferencePhoto() {
  if (_loaded) return;
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (saved) _referencePhoto = saved;
    const droneApp = await AsyncStorage.getItem(DRONE_APP_KEY);
    if (droneApp) {
      const parsed = JSON.parse(droneApp);
      _droneAppPkg = parsed.packageName;
      _droneAppName = parsed.appName;
    }
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

export function launchDroneApp() {
  if (_droneAppPkg) {
    NativeModules.AppLauncher?.launchApp(_droneAppPkg);
  }
}

export default function SettingsScreen({ navigation, route }: Props) {
  const [serverUrl, setServerUrl] = useState(_serverUrl);
  const [connected, setConnected] = useState(wsService.isConnected);
  const [connecting, setConnecting] = useState(false);
  const [referencePhoto, setReferencePhoto] = useState<string | null>(_referencePhoto);
  const [droneAppPkg, setDroneAppPkg] = useState<string | null>(_droneAppPkg);
  const [droneAppName, setDroneAppName] = useState<string | null>(_droneAppName);

  const [accessibilityEnabled, setAccessibilityEnabled] = useState(false);

  // App picker modal
  const [showAppPicker, setShowAppPicker] = useState(false);
  const [installedApps, setInstalledApps] = useState<AppInfo[]>([]);
  const [loadingApps, setLoadingApps] = useState(false);
  const [appSearch, setAppSearch] = useState('');

  useEffect(() => {
    loadReferencePhoto().then(() => {
      setReferencePhoto(_referencePhoto);
      setDroneAppPkg(_droneAppPkg);
      setDroneAppName(_droneAppName);
    });
    NativeModules.TouchInjectorModule?.isServiceEnabled()
      .then((enabled: boolean) => setAccessibilityEnabled(enabled))
      .catch(() => {});
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

  const openAppPicker = useCallback(async () => {
    setShowAppPicker(true);
    setLoadingApps(true);
    setAppSearch('');
    try {
      const apps: AppInfo[] = await NativeModules.AppLauncher.getInstalledApps();
      apps.sort((a, b) => a.appName.localeCompare(b.appName));
      setInstalledApps(apps);
    } catch (e) {
      Alert.alert('Error', 'Could not list installed apps');
    }
    setLoadingApps(false);
  }, []);

  const selectDroneApp = useCallback(async (app: AppInfo) => {
    _droneAppPkg = app.packageName;
    _droneAppName = app.appName;
    setDroneAppPkg(app.packageName);
    setDroneAppName(app.appName);
    setShowAppPicker(false);
    try {
      await AsyncStorage.setItem(DRONE_APP_KEY, JSON.stringify({
        packageName: app.packageName,
        appName: app.appName,
      }));
    } catch {}
  }, []);

  const clearDroneApp = useCallback(async () => {
    _droneAppPkg = null;
    _droneAppName = null;
    setDroneAppPkg(null);
    setDroneAppName(null);
    try { await AsyncStorage.removeItem(DRONE_APP_KEY); } catch {}
  }, []);

  const testLaunchDroneApp = useCallback(() => {
    if (droneAppPkg) {
      NativeModules.AppLauncher?.launchApp(droneAppPkg);
    } else {
      Alert.alert('No app selected', 'Select a drone app first.');
    }
  }, [droneAppPkg]);

  const filteredApps = appSearch
    ? installedApps.filter(a =>
        a.appName.toLowerCase().includes(appSearch.toLowerCase()) ||
        a.packageName.toLowerCase().includes(appSearch.toLowerCase()))
    : installedApps;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Drone Controls */}
      <Text style={styles.sectionTitle}>Drone Controls</Text>
      <View style={styles.card}>
        <View style={styles.serverRow}>
          <View>
            <Text style={styles.label}>Accessibility Service</Text>
            <Text style={styles.hint}>Required for automated taps on drone app</Text>
          </View>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, accessibilityEnabled ? styles.dotGreen : styles.dotRed]} />
            <Text style={styles.statusText}>
              {accessibilityEnabled ? 'Enabled' : 'Disabled'}
            </Text>
          </View>
        </View>
        {!accessibilityEnabled && (
          <TouchableOpacity
            style={[styles.connectBtn, { marginTop: 10 }]}
            onPress={() => {
              NativeModules.TouchInjectorModule?.openAccessibilitySettings();
            }}
          >
            <Text style={styles.connectBtnText}>Open Accessibility Settings</Text>
          </TouchableOpacity>
        )}
      </View>
      <TouchableOpacity
        style={[styles.card, { marginTop: 10 }]}
        onPress={() => navigation.navigate('ActionRecorder')}
      >
        <View style={styles.serverRow}>
          <View>
            <Text style={styles.label}>Action Recorder</Text>
            <Text style={styles.hint}>Record tap positions for Take Off/Landing, Route</Text>
          </View>
          <Text style={{ color: '#555', fontSize: 18 }}>&gt;</Text>
        </View>
      </TouchableOpacity>

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

      {/* Drone App */}
      <Text style={styles.sectionTitle}>Drone App</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Selected App</Text>
        {droneAppPkg ? (
          <View style={styles.selectedApp}>
            <View style={{ flex: 1 }}>
              <Text style={styles.appName}>{droneAppName}</Text>
              <Text style={styles.appPkg}>{droneAppPkg}</Text>
            </View>
            <TouchableOpacity style={styles.clearAppBtn} onPress={clearDroneApp}>
              <Text style={styles.clearAppText}>Clear</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={styles.hint}>No app selected</Text>
        )}
        <View style={styles.photoRow}>
          <TouchableOpacity style={styles.photoBtn} onPress={openAppPicker}>
            <Text style={styles.photoBtnText}>{droneAppPkg ? 'Change' : 'Select App'}</Text>
          </TouchableOpacity>
          {droneAppPkg && (
            <TouchableOpacity style={styles.photoBtn} onPress={testLaunchDroneApp}>
              <Text style={styles.photoBtnText}>Test Launch</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Diagnostics */}
      <Text style={styles.sectionTitle}>Diagnostics</Text>
      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('Watch', { testMode: true })}
      >
        <View style={styles.serverRow}>
          <View>
            <Text style={styles.label}>Test Video Streaming</Text>
            <Text style={styles.hint}>Start streaming without a mission</Text>
          </View>
          <Text style={{ color: '#555', fontSize: 18 }}>&gt;</Text>
        </View>
      </TouchableOpacity>

      {/* App Picker Modal */}
      <Modal visible={showAppPicker} animationType="slide" transparent={false}>
        <View style={modal.container}>
          <View style={modal.header}>
            <Text style={modal.title}>Select Drone App</Text>
            <TouchableOpacity onPress={() => setShowAppPicker(false)}>
              <Text style={modal.cancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={modal.search}
            placeholder="Search apps..."
            placeholderTextColor="#555"
            value={appSearch}
            onChangeText={setAppSearch}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {loadingApps ? (
            <ActivityIndicator color="#888" style={{ marginTop: 40 }} />
          ) : (
            <FlatList
              data={filteredApps}
              keyExtractor={item => item.packageName}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={modal.appRow}
                  onPress={() => selectDroneApp(item)}
                >
                  {item.icon ? (
                    <Image
                      source={{ uri: `data:image/png;base64,${item.icon}` }}
                      style={modal.appIcon}
                    />
                  ) : (
                    <View style={[modal.appIcon, { backgroundColor: '#333' }]} />
                  )}
                  <View style={modal.appInfo}>
                    <Text style={modal.appName}>{item.appName}</Text>
                    <Text style={modal.appPkg}>{item.packageName}</Text>
                  </View>
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={modal.sep} />}
            />
          )}
        </View>
      </Modal>
    </ScrollView>
  );
}

const modal = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingTop: 50,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  cancel: { color: '#888', fontSize: 15 },
  search: {
    backgroundColor: '#111',
    color: '#fff',
    margin: 16,
    padding: 12,
    borderRadius: 10,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#222',
  },
  appRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  appIcon: { width: 40, height: 40, borderRadius: 8, marginRight: 12 },
  appInfo: { flex: 1 },
  appName: { color: '#fff', fontSize: 15, fontWeight: '600' },
  appPkg: { color: '#555', fontSize: 11, marginTop: 2 },
  sep: { height: 1, backgroundColor: '#151515', marginLeft: 68 },
});

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
  selectedApp: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    backgroundColor: '#0a0a0a',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#222',
  },
  appName: { color: '#fff', fontSize: 14, fontWeight: '600' },
  appPkg: { color: '#555', fontSize: 11, marginTop: 2 },
  clearAppBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e74c3c33',
  },
  clearAppText: { color: '#e74c3c', fontSize: 12, fontWeight: '600' },
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
