/**
 * InputScreen — Uber-style booking screen.
 * From (current location) → To (delivery address) → Map → Directions → Book.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  ActivityIndicator,
  FlatList,
  Keyboard,
  PermissionsAndroid,
  Platform,
  Image,
} from 'react-native';
import { WebView } from 'react-native-webview';
import Geolocation from '@react-native-community/geolocation';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import wsService from '../services/WebSocketService';
import { getReferencePhoto, loadReferencePhoto, setGlobalReferencePhoto } from './SettingsScreen';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
  waypoints: {lat: number; lng: number}[],
) {
  const routeJs = routeCoords.length > 0
    ? `var route = L.polyline(${JSON.stringify(routeCoords)}, {color: '#fff', weight: 4, opacity: 0.9}).addTo(map);
       map.fitBounds(route.getBounds().pad(0.15));`
    : `map.fitBounds([[${userLat},${userLng}],[${destLat},${destLng}]]).pad(0.15);`;

  const waypointJs = waypoints.map((wp, i) => {
    if (i === 0 || i === waypoints.length - 1) return ''; // skip start/end, already have pins
    return `var wp${i} = L.circleMarker([${wp.lat},${wp.lng}], {radius:5, color:'#fff', fillColor:'#888', fillOpacity:0.8, weight:1.5}).addTo(map);
    wpMarkers.push(wp${i});`;
  }).join('\n');

  return `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#map{margin:0;padding:0;width:100%;height:100%;background:#1a1a1a}</style>
</head><body>
<div id="map"></div>
<script>
var map = L.map('map', {zoomControl: false});
L.tileLayer('${SERVER_HTTP}/tile/{z}/{x}/{y}.png', {attribution: ''}).addTo(map);
var wpMarkers = [];
var highlight = null;

var greenIcon = L.divIcon({
  html: '<div style="background:#2ecc71;width:12px;height:12px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 6px rgba(46,204,113,0.5)"></div>',
  iconSize: [16, 16], iconAnchor: [8, 8], className: ''
});
var redIcon = L.divIcon({
  html: '<div style="background:#e94560;width:12px;height:12px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 6px rgba(233,69,96,0.5)"></div>',
  iconSize: [16, 16], iconAnchor: [8, 8], className: ''
});

L.marker([${userLat}, ${userLng}], {icon: greenIcon}).addTo(map);
L.marker([${destLat}, ${destLng}], {icon: redIcon}).addTo(map);
${waypointJs}
${routeJs}

function highlightWaypoint(lat, lng) {
  if (highlight) map.removeLayer(highlight);
  highlight = L.circleMarker([lat, lng], {radius: 10, color: '#e94560', fillColor: '#e94560', fillOpacity: 0.6, weight: 2}).addTo(map);
  map.panTo([lat, lng], {animate: true});
}

function resetView() {
  if (highlight) { map.removeLayer(highlight); highlight = null; }
  ${routeCoords.length > 0 ? 'map.fitBounds(route.getBounds().pad(0.15));' : ''}
}
</script>
</body></html>`;
}

function buildUserMapHtml(lat: number, lng: number) {
  return `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#map{margin:0;padding:0;width:100%;height:100%;background:#1a1a1a}</style>
</head><body>
<div id="map"></div>
<script>
var map = L.map('map', {zoomControl: false}).setView([${lat}, ${lng}], 15);
L.tileLayer('${SERVER_HTTP}/tile/{z}/{x}/{y}.png', {attribution: ''}).addTo(map);
var icon = L.divIcon({
  html: '<div style="background:#2ecc71;width:12px;height:12px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 6px rgba(46,204,113,0.5)"></div>',
  iconSize: [16, 16], iconAnchor: [8, 8], className: ''
});
L.marker([${lat}, ${lng}], {icon: icon}).addTo(map);
</script>
</body></html>`;
}

export default function InputScreen({ navigation }: Props) {
  const [addressQuery, setAddressQuery] = useState('');
  const [address, setAddress] = useState('');
  const [suggestions, setSuggestions] = useState<GeoResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedCoords, setSelectedCoords] = useState<{lat: number; lng: number} | null>(null);
  const [searching, setSearching] = useState(false);
  const [userLocation, setUserLocation] = useState<{lat: number; lng: number} | null>(null);
  const [userAddress, setUserAddress] = useState('Getting location...');
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);
  const [mapHtml, setMapHtml] = useState<string | null>(null);
  const [userMapHtml, setUserMapHtml] = useState<string | null>(null);
  const [routeSteps, setRouteSteps] = useState<{instruction: string; distance: string; duration: string; lat: number; lng: number}[]>([]);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const mapWebViewRef = useRef<any>(null);
  const [routeSummary, setRouteSummary] = useState<{distance: string; duration: string} | null>(null);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [deliveryMessage, setDeliveryMessage] = useState('moo');
  const [referencePhoto, setReferencePhoto] = useState<string | null>(getReferencePhoto());
  const [connected, setConnected] = useState(wsService.isConnected);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track connection
  useEffect(() => {
    const unsub = wsService.onConnection(setConnected);
    return () => unsub();
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    if (!wsService.isConnected) {
      wsService.connect('ws://localhost:8765/ws');
    }
  }, []);

  // Get current location + reverse geocode (with retry + low-accuracy fallback)
  useEffect(() => {
    let cancelled = false;

    const onPosition = async (pos: any) => {
      if (cancelled) return;
      const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setUserLocation(loc);
      setUserMapHtml(buildUserMapHtml(loc.lat, loc.lng));
      try {
        const res = await fetch(
          `${SERVER_HTTP}/reverse-geocode?lat=${loc.lat}&lon=${loc.lng}`,
        );
        const data = await res.json();
        if (data.display_name) {
          const parts = data.display_name.split(', ');
          if (!cancelled) setUserAddress(parts.slice(0, 3).join(', '));
        } else {
          if (!cancelled) setUserAddress(`${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`);
        }
      } catch {
        if (!cancelled) setUserAddress(`${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`);
      }
    };

    const tryLocation = (highAccuracy: boolean, timeout: number): Promise<boolean> =>
      new Promise((resolve) => {
        Geolocation.getCurrentPosition(
          (pos: any) => { onPosition(pos); resolve(true); },
          () => resolve(false),
          { enableHighAccuracy: highAccuracy, timeout, maximumAge: 30000 },
        );
      });

    const getLocation = async () => {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          setUserAddress('Location unavailable');
          return;
        }
      }
      // Try high accuracy first, then low accuracy fallback, then retry
      if (await tryLocation(true, 10000)) return;
      if (await tryLocation(false, 10000)) return;
      if (await tryLocation(true, 20000)) return;
      if (!cancelled) setUserAddress('Location unavailable');
    };
    getLocation();

    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Load saved photo
  useEffect(() => {
    loadReferencePhoto().then(() => setReferencePhoto(getReferencePhoto()));
  }, []);

  const savePhoto = useCallback(async (b64: string) => {
    setReferencePhoto(b64);
    setGlobalReferencePhoto(b64);
    try { await AsyncStorage.setItem('@reference_photo', b64); } catch {}
  }, []);

  const pickPhoto = useCallback(async () => {
    const result = await launchImageLibrary({
      mediaType: 'photo', includeBase64: true, maxWidth: 800, maxHeight: 800, quality: 0.8,
    });
    if (result.assets && result.assets[0]?.base64) {
      savePhoto(result.assets[0].base64);
    }
  }, [savePhoto]);

  const takePhoto = useCallback(async () => {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) return;
    }
    const result = await launchCamera({
      mediaType: 'photo', includeBase64: true, maxWidth: 800, maxHeight: 800, quality: 0.8,
    });
    if (result.assets && result.assets[0]?.base64) {
      savePhoto(result.assets[0].base64);
    }
  }, [savePhoto]);

  // If GPS arrives after address selected, fetch route
  useEffect(() => {
    if (userLocation && selectedCoords && routeCoords.length === 0) {
      fetchRouteAndShowMap(userLocation, selectedCoords);
    }
  }, [userLocation, selectedCoords, routeCoords.length, fetchRouteAndShowMap]);

  const fetchRouteAndShowMap = useCallback(async (
    from: {lat: number; lng: number},
    to: {lat: number; lng: number},
  ) => {
    setLoadingRoute(true);
    let coords: [number, number][] = [];
    let steps: {instruction: string; distance: string; duration: string; lat: number; lng: number}[] = [];
    let summary: {distance: string; duration: string} | null = null;
    try {
      const url = `${SERVER_HTTP}/route?from_lat=${from.lat}&from_lng=${from.lng}&to_lat=${to.lat}&to_lng=${to.lng}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        coords = route.geometry.coordinates.map(
          (c: [number, number]) => [c[1], c[0]] as [number, number],
        );
        // Route summary
        const totalDist = route.distance || 0;
        const totalDur = route.duration || 0;
        summary = {
          distance: totalDist >= 1000 ? `${(totalDist / 1000).toFixed(1)} km` : `${Math.round(totalDist)} m`,
          duration: totalDur >= 3600
            ? `${Math.floor(totalDur / 3600)}h ${Math.round((totalDur % 3600) / 60)}m`
            : totalDur >= 60 ? `${Math.round(totalDur / 60)} min` : `${Math.round(totalDur)} sec`,
        };
        // Parse steps
        if (route.legs) {
          for (const leg of route.legs) {
            if (leg.steps) {
              for (const step of leg.steps) {
                if (step.maneuver) {
                  const distM = step.distance || 0;
                  const dist = distM >= 1000
                    ? `${(distM / 1000).toFixed(1)} km`
                    : `${Math.round(distM)} m`;
                  const durS = step.duration || 0;
                  const dur = durS >= 60
                    ? `${Math.round(durS / 60)} min`
                    : `${Math.round(durS)} sec`;
                  const modifier = step.maneuver.modifier ? ` ${step.maneuver.modifier}` : '';
                  const name = step.name ? ` onto ${step.name}` : '';
                  let instruction = '';
                  switch (step.maneuver.type) {
                    case 'depart': instruction = `Depart${name}`; break;
                    case 'arrive': instruction = 'Arrive at destination'; break;
                    case 'turn': instruction = `Turn${modifier}${name}`; break;
                    case 'merge': instruction = `Merge${modifier}${name}`; break;
                    case 'fork': instruction = `Take the${modifier} fork${name}`; break;
                    case 'roundabout': instruction = `Enter roundabout, exit${name}`; break;
                    case 'new name': instruction = `Continue${name}`; break;
                    case 'end of road': instruction = `Turn${modifier}${name}`; break;
                    default: instruction = `${step.maneuver.type}${modifier}${name}`; break;
                  }
                  const loc = step.maneuver.location || [0, 0];
                  steps.push({ instruction, distance: dist, duration: dur, lat: loc[1], lng: loc[0] });
                }
              }
            }
          }
        }
      }
    } catch {}
    setRouteCoords(coords);
    setRouteSteps(steps);
    setRouteSummary(summary);
    setMapHtml(buildMapHtml(from.lat, from.lng, to.lat, to.lng, coords, steps));
    setSelectedStep(null);
    setLoadingRoute(false);
  }, []);

  const searchAddress = useCallback((query: string) => {
    setAddressQuery(query);
    setSelectedCoords(null);
    setMapHtml(null);
    setRouteSteps([]);
    setRouteSummary(null);

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
    const parts = item.display_name.split(', ');
    setAddress(item.display_name);
    setAddressQuery(parts.slice(0, 3).join(', '));
    setSelectedCoords(dest);
    setSuggestions([]);
    setShowSuggestions(false);
    Keyboard.dismiss();
    if (userLocation) {
      fetchRouteAndShowMap(userLocation, dest);
    } else {
      Geolocation.getCurrentPosition(
        (pos: any) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setUserLocation(loc);
          fetchRouteAndShowMap(loc, dest);
        },
        () => setMapHtml(buildMapHtml(dest.lat, dest.lng, dest.lat, dest.lng, [], [])),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 10000 },
      );
    }
  }, [userLocation, fetchRouteAndShowMap]);

  const startMission = useCallback(() => {
    if (!address.trim()) {
      Alert.alert('Missing address', 'Please search and select a delivery address.');
      return;
    }
    if (!selectedCoords) {
      Alert.alert('Missing address', 'Please select an address from suggestions.');
      return;
    }
    if (!referencePhoto) {
      Alert.alert('Missing photo', 'Please add a reference photo of the target person.');
      return;
    }
    if (!connected) {
      Alert.alert('Not connected', 'Connect to server in Settings first.');
      return;
    }

    // Build waypoints from turn-by-turn steps for navigation
    const waypoints = routeSteps
      .filter(s => s.lat !== 0 && s.lng !== 0)
      .map(s => ({ lat: s.lat, lng: s.lng }));

    wsService.send({
      type: 'mission_input',
      address: address.trim(),
      reference_photo: referencePhoto,
      delivery_message: deliveryMessage.trim() || 'You have a delivery!',
      gps: userLocation ? { lat: userLocation.lat, lng: userLocation.lng, alt: 0 } : { lat: selectedCoords.lat, lng: selectedCoords.lng, alt: 0 },
      waypoints,
    });

    navigation.navigate('Watch', { deliveryMessage: deliveryMessage.trim() });
  }, [address, selectedCoords, referencePhoto, deliveryMessage, connected, navigation]);

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* From / To card */}
        <View style={styles.routeCard}>
          {/* From */}
          <View style={styles.routeRow}>
            <View style={styles.dotCol}>
              <View style={[styles.routeDot, styles.dotGreen]} />
              <View style={styles.routeLine} />
            </View>
            <View style={styles.routeInput}>
              <Text style={styles.routeLabel}>From</Text>
              <Text style={styles.fromText} numberOfLines={1}>{userAddress}</Text>
            </View>
          </View>

          {/* To */}
          <View style={styles.routeRow}>
            <View style={styles.dotCol}>
              <View style={[styles.routeDot, styles.dotRed]} />
            </View>
            <View style={[styles.routeInput, { borderBottomWidth: 0 }]}>
              <Text style={styles.routeLabel}>To</Text>
              <TextInput
                style={styles.toInput}
                value={addressQuery}
                onChangeText={searchAddress}
                placeholder="Search destination..."
                placeholderTextColor="#555"
                autoCapitalize="words"
              />
              {searching && (
                <ActivityIndicator style={styles.searchSpinner} color="#e94560" size="small" />
              )}
            </View>
          </View>
        </View>

        {/* Suggestions dropdown */}
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

        {/* Initial map with just departure pin */}
        {!mapHtml && !loadingRoute && userMapHtml && (
          <View style={styles.mapContainer}>
            <WebView
              style={styles.map}
              originWhitelist={['*']}
              source={{ html: userMapHtml }}
              scrollEnabled={false}
              nestedScrollEnabled={false}
            />
          </View>
        )}

        {/* Map loading placeholder */}
        {loadingRoute && !mapHtml && (
          <View style={styles.mapLoading}>
            <ActivityIndicator color="#666" size="small" />
            <Text style={styles.mapLoadingText}>Loading route...</Text>
          </View>
        )}

        {/* Map */}
        {mapHtml && (
          <View style={styles.mapContainer}>
            <WebView
              ref={mapWebViewRef}
              style={styles.map}
              originWhitelist={['*']}
              source={{ html: mapHtml }}
              scrollEnabled={false}
              nestedScrollEnabled={false}
            />
            {/* Route summary overlay */}
            {routeSummary && (
              <View style={styles.routeSummary}>
                <Text style={styles.summaryDistance}>{routeSummary.distance}</Text>
                <Text style={styles.summaryDot}> · </Text>
                <Text style={styles.summaryDuration}>{routeSummary.duration}</Text>
              </View>
            )}
          </View>
        )}

        {/* Turn-by-turn waypoints */}
        {routeSteps.length > 0 && (
          <View style={styles.stepsContainer}>
            <TouchableOpacity
              style={styles.stepsHeader}
              onPress={() => {
                setSelectedStep(null);
                mapWebViewRef.current?.injectJavaScript('resetView(); true;');
              }}
            >
              <Text style={styles.stepsTitle}>Waypoints</Text>
              <Text style={styles.stepsCount}>{routeSteps.length} steps</Text>
            </TouchableOpacity>
            <ScrollView style={styles.stepsList} nestedScrollEnabled>
              {routeSteps.map((step, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.stepItem, selectedStep === i && styles.stepItemSelected]}
                  onPress={() => {
                    setSelectedStep(i);
                    mapWebViewRef.current?.injectJavaScript(
                      `highlightWaypoint(${step.lat}, ${step.lng}); true;`
                    );
                  }}
                >
                  <Text style={[styles.stepNumber, selectedStep === i && styles.stepNumberSelected]}>{i + 1}</Text>
                  <View style={styles.stepContent}>
                    <Text style={styles.stepInstruction}>{step.instruction}</Text>
                    <Text style={styles.stepCoords}>{step.lat.toFixed(5)}, {step.lng.toFixed(5)}</Text>
                    <Text style={styles.stepMeta}>{step.distance}  ·  {step.duration}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Reference Photo */}
        {selectedCoords && (
          <View style={styles.photoCard}>
            <Text style={styles.cardLabel}>Target person</Text>
            <View style={styles.photoRow}>
              <TouchableOpacity style={styles.photoBtn} onPress={pickPhoto}>
                <Text style={styles.photoBtnText}>Gallery</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.photoBtn} onPress={takePhoto}>
                <Text style={styles.photoBtnText}>Camera</Text>
              </TouchableOpacity>
            </View>
            {referencePhoto && (
              <Image
                source={{ uri: `data:image/jpeg;base64,${referencePhoto}` }}
                style={styles.photoPreview}
                resizeMode="cover"
              />
            )}
          </View>
        )}

        {/* Delivery message */}
        {selectedCoords && (
          <View style={styles.messageCard}>
            <Text style={styles.messageLabel}>Delivery message</Text>
            <TextInput
              style={styles.messageInput}
              value={deliveryMessage}
              onChangeText={setDeliveryMessage}
              placeholder="Message for recipient..."
              placeholderTextColor="#555"
            />
          </View>
        )}

        {/* Spacer for bottom button */}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Bottom bar */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.bookBtn, (!selectedCoords || !connected) && styles.bookBtnDisabled]}
          onPress={startMission}
          disabled={!selectedCoords || !connected}
        >
          <Text style={styles.bookBtnText}>
            {!connected ? 'Not connected' : 'Book Delivery'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.testBtn}
          onPress={() => navigation.navigate('Watch', { testMode: true })}
        >
          <Text style={styles.testBtnText}>Test</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingTop: 8 },

  // Route card (From / To)
  routeCard: {
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 0,
    borderWidth: 1,
    borderColor: '#222',
    overflow: 'hidden',
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  dotCol: {
    width: 36,
    alignItems: 'center',
    paddingTop: 20,
  },
  routeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dotGreen: { backgroundColor: '#2ecc71' },
  dotRed: { backgroundColor: '#e94560' },
  routeLine: {
    width: 2,
    flex: 1,
    backgroundColor: '#333',
    marginTop: 6,
  },
  routeInput: {
    flex: 1,
    paddingVertical: 14,
    paddingRight: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  routeLabel: {
    fontSize: 11,
    color: '#666',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  fromText: {
    fontSize: 15,
    color: '#999',
  },
  toInput: {
    fontSize: 15,
    color: '#fff',
    padding: 0,
    margin: 0,
  },
  searchSpinner: {
    position: 'absolute',
    right: 0,
    top: 32,
  },

  // Suggestions
  suggestionsContainer: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#222',
    borderTopWidth: 0,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    maxHeight: 200,
    marginTop: -1,
  },
  suggestionItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  suggestionText: { color: '#ccc', fontSize: 14 },

  // Map
  mapContainer: {
    marginTop: 16,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#222',
  },
  map: {
    height: 220,
    width: '100%',
    backgroundColor: '#1a1a1a',
  },
  routeSummary: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  summaryDistance: { color: '#fff', fontSize: 14, fontWeight: '700' },
  summaryDot: { color: '#666', fontSize: 14 },
  summaryDuration: { color: '#aaa', fontSize: 14 },

  // Steps
  stepsContainer: {
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#222',
    backgroundColor: '#111',
    overflow: 'hidden',
  },
  stepsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  stepsTitle: {
    color: '#666',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  stepsCount: {
    color: '#555',
    fontSize: 11,
  },
  stepsList: { maxHeight: 220 },
  stepItem: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    alignItems: 'flex-start',
  },
  stepItemSelected: {
    backgroundColor: '#1a1020',
    borderBottomColor: '#2a1a30',
  },
  stepNumber: {
    color: '#666',
    fontSize: 13,
    fontWeight: 'bold',
    width: 24,
    marginTop: 1,
  },
  stepNumberSelected: {
    color: '#e94560',
  },
  stepContent: { flex: 1 },
  stepInstruction: { color: '#ddd', fontSize: 14 },
  stepCoords: { color: '#e94560', fontSize: 11, marginTop: 2, fontFamily: 'monospace' },
  stepMeta: { color: '#555', fontSize: 12, marginTop: 2 },

  // Map loading
  mapLoading: {
    marginTop: 16,
    height: 220,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#222',
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapLoadingText: {
    color: '#555',
    fontSize: 13,
    marginTop: 8,
  },

  // Photo
  photoCard: {
    marginTop: 16,
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#222',
  },
  cardLabel: {
    fontSize: 11,
    color: '#666',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  photoRow: {
    flexDirection: 'row',
    gap: 10,
  },
  photoBtn: {
    backgroundColor: '#222',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  photoBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  photoPreview: {
    width: '100%',
    height: 160,
    borderRadius: 10,
    marginTop: 12,
  },

  // Delivery message
  messageCard: {
    marginTop: 16,
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#222',
  },
  messageLabel: {
    fontSize: 11,
    color: '#666',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  messageInput: {
    color: '#fff',
    fontSize: 15,
    padding: 0,
  },

  // Bottom bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#000',
    borderTopWidth: 1,
    borderTopColor: '#222',
    padding: 16,
    paddingBottom: 24,
    flexDirection: 'row',
    gap: 10,
  },
  bookBtn: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  bookBtnDisabled: {
    opacity: 0.3,
  },
  bookBtnText: {
    color: '#000',
    fontSize: 17,
    fontWeight: 'bold',
  },
  testBtn: {
    backgroundColor: '#222',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  testBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
});
