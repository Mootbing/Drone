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
  FlatList,
  Keyboard,
  PermissionsAndroid,
  Platform,
  Modal,
} from 'react-native';
import { WebView } from 'react-native-webview';
import Geolocation from '@react-native-community/geolocation';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import wsService from '../services/WebSocketService';

type GeoResult = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
};

type Props = {
  navigation: NativeStackNavigationProp<any>;
};

const SERVER_HTTP = 'http://localhost:8765';

function buildMapHtml(
  userLat: number, userLng: number,
  destLat: number, destLng: number,
  routeCoords: [number, number][],
) {
  const routeJs = routeCoords.length > 0
    ? `var route = L.polyline(${JSON.stringify(routeCoords)}, {color: '#e94560', weight: 4}).addTo(map);
       map.fitBounds(route.getBounds().pad(0.15));`
    : `map.fitBounds([[${userLat},${userLng}],[${destLat},${destLng}]]).pad(0.15);`;

  return `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#map{margin:0;padding:0;width:100%;height:100%}</style>
</head><body>
<div id="map"></div>
<script>
var map = L.map('map', {zoomControl: false});
L.tileLayer('${SERVER_HTTP}/tile/{z}/{x}/{y}.png', {
  attribution: '© OSM'
}).addTo(map);

var greenIcon = L.divIcon({
  html: '<div style="background:#2ecc71;width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,0.4)"></div>',
  iconSize: [18, 18], iconAnchor: [9, 9], className: ''
});
var redIcon = L.divIcon({
  html: '<div style="background:#e94560;width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,0.4)"></div>',
  iconSize: [18, 18], iconAnchor: [9, 9], className: ''
});

L.marker([${userLat}, ${userLng}], {icon: greenIcon}).addTo(map).bindPopup('You');
L.marker([${destLat}, ${destLng}], {icon: redIcon}).addTo(map).bindPopup('Delivery');
${routeJs}
</script>
</body></html>`;
}

export default function InputScreen({ navigation }: Props) {
  const [address, setAddress] = useState('');
  const [addressQuery, setAddressQuery] = useState('');
  const [suggestions, setSuggestions] = useState<GeoResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedCoords, setSelectedCoords] = useState<{lat: number; lng: number} | null>(null);
  const [searching, setSearching] = useState(false);
  const [userLocation, setUserLocation] = useState<{lat: number; lng: number} | null>(null);
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);
  const [mapHtml, setMapHtml] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [referencePhoto, setReferencePhoto] = useState<string | null>(null);
  const [deliveryMessage, setDeliveryMessage] = useState('moo');
  const [serverUrl, setServerUrl] = useState('ws://localhost:8765/ws');
  const [serverUrlDraft, setServerUrlDraft] = useState('ws://localhost:8765/ws');
  const [showServerModal, setShowServerModal] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const connectionUnsubRef = useRef<(() => void) | null>(null);

  // Auto-connect to server on launch
  useEffect(() => {
    setConnecting(true);
    wsService.connect(serverUrl);
    const unsub = wsService.onConnection((isConnected) => {
      setConnected(isConnected);
      setConnecting(false);
    });
    return () => unsub();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Request location permission and get current position
  useEffect(() => {
    const getLocation = async () => {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) return;
      }
      Geolocation.getCurrentPosition(
        (pos: any) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setUserLocation(loc);
        },
        () => {},
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
      );
    };
    getLocation();

    return () => {
      connectionUnsubRef.current?.();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // If GPS arrives after address was already selected, fetch route
  useEffect(() => {
    if (userLocation && selectedCoords && routeCoords.length === 0) {
      fetchRouteAndShowMap(userLocation, selectedCoords);
    }
  }, [userLocation, selectedCoords, routeCoords.length, fetchRouteAndShowMap]);

  // Fetch route from OSRM and build map HTML
  const fetchRouteAndShowMap = useCallback(async (
    from: {lat: number; lng: number},
    to: {lat: number; lng: number},
  ) => {
    let coords: [number, number][] = [];
    try {
      const url = `${SERVER_HTTP}/route?from_lat=${from.lat}&from_lng=${from.lng}&to_lat=${to.lat}&to_lng=${to.lng}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.routes && data.routes.length > 0) {
        coords = data.routes[0].geometry.coordinates.map(
          (c: [number, number]) => [c[1], c[0]] as [number, number],
        );
      }
    } catch {}
    setRouteCoords(coords);
    setMapHtml(buildMapHtml(from.lat, from.lng, to.lat, to.lng, coords));
  }, []);

  const searchAddress = useCallback((query: string) => {
    setAddressQuery(query);
    setSelectedCoords(null);
    setMapHtml(null);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.trim().length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const url = `${SERVER_HTTP}/geocode?q=${encodeURIComponent(query)}`;
        const res = await fetch(url);
        const data: GeoResult[] = await res.json();
        setSuggestions(data);
        setShowSuggestions(data.length > 0);
      } catch {
        setSuggestions([]);
        setShowSuggestions(false);
      } finally {
        setSearching(false);
      }
    }, 400);
  }, []);

  const selectAddress = useCallback((item: GeoResult) => {
    const dest = { lat: parseFloat(item.lat), lng: parseFloat(item.lon) };
    setAddress(item.display_name);
    setAddressQuery(item.display_name);
    setSelectedCoords(dest);
    setSuggestions([]);
    setShowSuggestions(false);
    Keyboard.dismiss();
    if (userLocation) {
      fetchRouteAndShowMap(userLocation, dest);
    } else {
      // GPS not ready yet — get it now then show route
      // @ts-ignore
      Geolocation.getCurrentPosition(
        (pos: any) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setUserLocation(loc);
          fetchRouteAndShowMap(loc, dest);
        },
        () => {
          // GPS failed — show destination only
          setMapHtml(buildMapHtml(dest.lat, dest.lng, dest.lat, dest.lng, []));
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 10000 },
      );
    }
  }, [userLocation, fetchRouteAndShowMap]);

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
    }
  }, []);

  const connectToServer = useCallback((url?: string) => {
    const target = url || serverUrl;
    connectionUnsubRef.current?.();
    wsService.disconnect();
    setConnecting(true);
    wsService.connect(target);

    connectionUnsubRef.current = wsService.onConnection((isConnected) => {
      setConnected(isConnected);
      setConnecting(false);
    });
  }, [serverUrl]);

  const saveServerUrl = useCallback(() => {
    setServerUrl(serverUrlDraft);
    setShowServerModal(false);
    connectToServer(serverUrlDraft);
  }, [serverUrlDraft, connectToServer]);

  const startMission = useCallback(() => {
    if (!address.trim()) {
      Alert.alert('Error', 'Please enter a delivery address.');
      return;
    }
    if (!selectedCoords) {
      Alert.alert('Error', 'Please select an address from the suggestions.');
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
      gps: { lat: selectedCoords.lat, lng: selectedCoords.lng, alt: 0 },
    });

    navigation.navigate('Watch', { deliveryMessage: deliveryMessage.trim() });
  }, [address, selectedCoords, referencePhoto, deliveryMessage, connected, navigation]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Drone Delivery</Text>

      {/* Server Status */}
      <View style={styles.statusRow}>
        <View style={[styles.statusDot, connected ? styles.dotGreen : styles.dotRed]} />
        <Text style={styles.statusText}>
          {connecting ? 'Connecting...' : connected ? 'Connected' : 'Disconnected'}
        </Text>
        <TouchableOpacity
          style={styles.settingsBtn}
          onPress={() => { setServerUrlDraft(serverUrl); setShowServerModal(true); }}
        >
          <Text style={styles.settingsBtnText}>Server</Text>
        </TouchableOpacity>
      </View>

      {/* Server URL Modal */}
      <Modal visible={showServerModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Server URL</Text>
            <TextInput
              style={styles.modalInput}
              value={serverUrlDraft}
              onChangeText={setServerUrlDraft}
              placeholder="ws://localhost:8765/ws"
              placeholderTextColor="#666"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalBtn}
                onPress={() => setShowServerModal(false)}
              >
                <Text style={styles.modalBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnSave]}
                onPress={saveServerUrl}
              >
                <Text style={[styles.modalBtnText, styles.modalBtnSaveText]}>Connect</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Delivery Address */}
      <Text style={styles.label}>Delivery Address <Text style={styles.required}>*</Text></Text>
      <View style={styles.addressContainer}>
        <View style={styles.addressInputRow}>
          <TextInput
            style={styles.input}
            value={addressQuery}
            onChangeText={searchAddress}
            placeholder="Start typing an address..."
            placeholderTextColor="#666"
            autoCapitalize="words"
          />
          {searching && (
            <ActivityIndicator style={styles.searchSpinner} color="#e94560" size="small" />
          )}
        </View>
        {showSuggestions && (
          <View style={styles.suggestionsContainer}>
            <FlatList
              data={suggestions}
              keyExtractor={(item) => String(item.place_id)}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.suggestionItem}
                  onPress={() => selectAddress(item)}
                >
                  <Text style={styles.suggestionText} numberOfLines={2}>
                    {item.display_name}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        )}
        {selectedCoords && (
          <Text style={styles.coordsText}>
            GPS: {selectedCoords.lat.toFixed(5)}, {selectedCoords.lng.toFixed(5)}
          </Text>
        )}
      </View>

      {/* Route Map */}
      {mapHtml && (
        <View style={styles.mapContainer}>
          <WebView
            style={styles.map}
            originWhitelist={['*']}
            source={{ html: mapHtml }}
            scrollEnabled={false}
            nestedScrollEnabled={false}
          />
        </View>
      )}

      {/* Reference Photo */}
      <Text style={styles.label}>Target Person Photo <Text style={styles.required}>*</Text></Text>
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
      <Text style={styles.label}>Delivery Message <Text style={styles.required}>*</Text></Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={deliveryMessage}
        onChangeText={setDeliveryMessage}
        placeholder="You have a delivery!"
        multiline
        numberOfLines={3}
      />

      {/* Start Mission + Test */}
      <View style={[styles.row, { marginTop: 30 }]}>
        <TouchableOpacity
          style={[styles.btn, styles.btnLarge, styles.flex1, !connected && styles.btnDisabled]}
          onPress={startMission}
          disabled={!connected}
        >
          <Text style={styles.btnTextLarge}>Start Mission</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.btnLarge, styles.btnTest]}
          onPress={() => navigation.navigate('Watch', { testMode: true })}
        >
          <Text style={[styles.btnTextLarge, { color: '#fff' }]}>Test</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  content: { padding: 20 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#fff', textAlign: 'center', marginBottom: 24 },
  label: { fontSize: 14, color: '#888', marginTop: 16, marginBottom: 6 },
  input: {
    backgroundColor: '#111',
    color: '#fff',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  multiline: { height: 80, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 10 },
  flex1: { flex: 1 },
  btn: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnTest: { backgroundColor: '#333', flex: 0, paddingHorizontal: 24 },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#000', fontSize: 14, fontWeight: '600' },
  btnLarge: {
    backgroundColor: '#fff',
    paddingVertical: 16,
  },
  btnTextLarge: { color: '#000', fontSize: 18, fontWeight: 'bold' },
  preview: {
    width: 120,
    height: 120,
    borderRadius: 12,
    marginTop: 10,
    alignSelf: 'center',
  },
  addressContainer: { zIndex: 10 },
  addressInputRow: { position: 'relative' },
  required: { color: '#e74c3c', fontSize: 14 },
  searchSpinner: { position: 'absolute', right: 12, top: 14 },
  suggestionsContainer: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#333',
    borderTopWidth: 0,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    maxHeight: 200,
  },
  suggestionItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  suggestionText: { color: '#ccc', fontSize: 14 },
  coordsText: { color: '#2ecc71', fontSize: 12, marginTop: 6 },
  mapContainer: {
    marginTop: 12,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#333',
  },
  map: {
    height: 250,
    width: '100%',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  dotGreen: { backgroundColor: '#2ecc71' },
  dotRed: { backgroundColor: '#e74c3c' },
  statusText: { color: '#888', fontSize: 13, flex: 1 },
  settingsBtn: {
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  settingsBtnText: { color: '#888', fontSize: 12 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    padding: 30,
  },
  modalContent: {
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#333',
  },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 16 },
  modalInput: {
    backgroundColor: '#000',
    color: '#fff',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#333',
    marginBottom: 16,
  },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  modalBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  modalBtnText: { color: '#888', fontSize: 14, fontWeight: '600' },
  modalBtnSave: { backgroundColor: '#fff', borderColor: '#fff' },
  modalBtnSaveText: { color: '#000' },
});
