/**
 * ActionRecorderScreen — Record tap positions for drone app actions.
 *
 * Each action can require 1 or more sequential taps (e.g. Route needs
 * "open menu" then "select route"). Positions are stored as relative
 * coordinates (0-1). Fullscreen grid for recording, mini phone preview
 * to confirm.
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Dimensions,
  ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

type Props = {
  navigation: NativeStackNavigationProp<any>;
};

type TapPoint = { rx: number; ry: number };

interface ActionDef {
  key: string;
  label: string;
  color: string;
  colorBg: string;
  taps: number;
  tapLabels: string[];
}

const ACTIONS: ActionDef[] = [
  { key: 'takeoff', label: 'Take Off / Landing', color: '#2ecc71', colorBg: 'rgba(46,204,113,0.7)', taps: 1, tapLabels: ['Button'] },
  { key: 'route', label: 'Route', color: '#3498db', colorBg: 'rgba(52,152,219,0.7)', taps: 2, tapLabels: ['Open Menu', 'Select Route'] },
];

const STORAGE_KEY = '@action_points';
const SCREEN = Dimensions.get('window');
const PHONE_PREVIEW_W = 90;
const PHONE_PREVIEW_H = PHONE_PREVIEW_W * (SCREEN.height / SCREEN.width);

// Points are stored as: { takeoff: [{ rx, ry }], route: [{ rx, ry }, { rx, ry }] }
let _actionPoints: Record<string, TapPoint[]> = {};

export function getActionPoints() {
  return _actionPoints;
}

export async function loadActionPoints() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migrate old format: { key: { rx, ry } } → { key: [{ rx, ry }] }
      const migrated: Record<string, TapPoint[]> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (Array.isArray(v)) {
          migrated[k] = v as TapPoint[];
        } else if (v && typeof v === 'object' && 'rx' in (v as any)) {
          migrated[k] = [v as TapPoint];
        }
      }
      _actionPoints = migrated;
    }
  } catch {}
}

export default function ActionRecorderScreen({ navigation }: Props) {
  const [points, setPoints] = useState<Record<string, TapPoint[]>>({});
  // Recording state: which action key + which tap index (0-based)
  const [recording, setRecording] = useState<{ key: string; tapIdx: number } | null>(null);
  const [pending, setPending] = useState<TapPoint | null>(null);

  useEffect(() => {
    navigation.setOptions({ headerShown: recording === null });
  }, [recording, navigation]);

  useEffect(() => {
    loadActionPoints().then(() => setPoints({ ..._actionPoints }));
  }, []);

  const save = useCallback(async (updated: Record<string, TapPoint[]>) => {
    _actionPoints = updated;
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {}
  }, []);

  const startRecording = useCallback((key: string, tapIdx: number) => {
    setPending(null);
    setRecording({ key, tapIdx });
  }, []);

  const handleFullscreenTap = useCallback((evt: any) => {
    if (!recording || pending) return;
    const { locationX, locationY } = evt.nativeEvent;
    const rx = Math.max(0, Math.min(1, locationX / SCREEN.width));
    const ry = Math.max(0, Math.min(1, locationY / SCREEN.height));
    setPending({ rx, ry });
  }, [recording, pending]);

  const confirmPending = useCallback(() => {
    if (!recording || !pending) return;
    const { key, tapIdx } = recording;
    const existing = [...(points[key] || [])];
    // Pad array if needed
    while (existing.length <= tapIdx) existing.push({ rx: 0, ry: 0 });
    existing[tapIdx] = pending;

    const updated = { ...points, [key]: existing };
    setPoints(updated);
    save(updated);
    setPending(null);

    // Check if there's a next tap to record
    const action = ACTIONS.find(a => a.key === key)!;
    if (tapIdx + 1 < action.taps) {
      // Auto-advance to next tap
      setRecording({ key, tapIdx: tapIdx + 1 });
    } else {
      setRecording(null);
    }
  }, [recording, pending, points, save]);

  const retryPending = useCallback(() => {
    setPending(null);
  }, []);

  const clearAction = useCallback((key: string) => {
    const updated = { ...points };
    delete updated[key];
    setPoints(updated);
    save(updated);
  }, [points, save]);

  // ---- Fullscreen recording overlay ----
  if (recording !== null) {
    const action = ACTIONS.find(a => a.key === recording.key)!;
    const tapLabel = action.tapLabels[recording.tapIdx] || `Tap ${recording.tapIdx + 1}`;
    const stepText = action.taps > 1
      ? `Step ${recording.tapIdx + 1}/${action.taps}: ${tapLabel}`
      : tapLabel;

    return (
      <View style={fs.container}>
        <StatusBar hidden />
        <View
          style={fs.canvas}
          onStartShouldSetResponder={() => true}
          onResponderRelease={handleFullscreenTap}
        >
          {[20, 40, 60, 80].map(p => (
            <React.Fragment key={p}>
              <View style={[fs.gridH, { top: `${p}%` }]} />
              <View style={[fs.gridV, { left: `${p}%` }]} />
            </React.Fragment>
          ))}
          <View style={[fs.gridH, fs.centerLine, { top: '50%' }]} />
          <View style={[fs.gridV, fs.centerLine, { left: '50%' }]} />

          {/* Show previously recorded taps for this action (dimmed) */}
          {(points[recording.key] || []).map((pt, i) => {
            if (i >= recording.tapIdx) return null;
            return (
              <View
                key={i}
                style={[
                  fs.dot,
                  {
                    left: pt.rx * SCREEN.width - 14,
                    top: pt.ry * SCREEN.height - 14,
                    backgroundColor: action.colorBg,
                    borderColor: action.color,
                    opacity: 0.35,
                    width: 28, height: 28, borderRadius: 14,
                  },
                ]}
              />
            );
          })}

          {/* Current pending tap */}
          {pending && (
            <>
              <View style={[fs.crossH, { top: pending.ry * SCREEN.height }]} />
              <View style={[fs.crossV, { left: pending.rx * SCREEN.width }]} />
              <View
                style={[
                  fs.dot,
                  {
                    left: pending.rx * SCREEN.width - 18,
                    top: pending.ry * SCREEN.height - 18,
                    backgroundColor: action.colorBg,
                    borderColor: action.color,
                  },
                ]}
              />
            </>
          )}
        </View>

        <View style={fs.topLabel} pointerEvents="none">
          <Text style={[fs.topLabelText, { color: action.color }]}>
            {pending ? 'Confirm?' : `Tap: ${stepText}`}
          </Text>
        </View>

        {pending ? (
          <View style={fs.bottomRow}>
            <TouchableOpacity style={fs.retryBtn} onPress={retryPending}>
              <Text style={fs.retryText}>Retry</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[fs.confirmBtn, { backgroundColor: action.color }]}
              onPress={confirmPending}
            >
              <Text style={fs.confirmText}>
                {recording.tapIdx + 1 < action.taps ? 'Next' : 'Confirm'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={fs.cancelBtn} onPress={() => { setPending(null); setRecording(null); }}>
            <Text style={fs.cancelText}>Cancel</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // ---- List view ----
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <StatusBar barStyle="light-content" />

      <Text style={styles.hint}>
        Tap Record, then tap the screen where the button is on the drone app.
      </Text>

      {ACTIONS.map(action => {
        const pts = points[action.key] || [];
        const allRecorded = pts.length >= action.taps;
        return (
          <View key={action.key} style={[styles.actionCard, { borderColor: allRecorded ? action.color + '33' : '#222' }]}>
            <View style={styles.actionLeft}>
              <View style={styles.actionHeader}>
                <View style={[styles.actionDot, { backgroundColor: action.color }]} />
                <Text style={styles.actionLabel}>{action.label}</Text>
              </View>

              {/* Show each tap step */}
              {action.tapLabels.map((tapLabel, i) => {
                const pt = pts[i];
                return (
                  <View key={i} style={styles.tapRow}>
                    <Text style={styles.tapLabel}>
                      {action.taps > 1 ? `${i + 1}. ` : ''}{tapLabel}
                    </Text>
                    {pt ? (
                      <Text style={[styles.tapCoord, { color: action.color }]}>
                        {(pt.rx * 100).toFixed(1)}% x {(pt.ry * 100).toFixed(1)}%
                      </Text>
                    ) : (
                      <Text style={styles.tapNone}>—</Text>
                    )}
                  </View>
                );
              })}

              <View style={styles.actionBtns}>
                <TouchableOpacity
                  style={[styles.recordBtn, { backgroundColor: action.color }]}
                  onPress={() => startRecording(action.key, 0)}
                >
                  <Text style={styles.recordBtnText}>{allRecorded ? 'Re-record' : 'Record'}</Text>
                </TouchableOpacity>
                {allRecorded && (
                  <TouchableOpacity
                    style={styles.clearBtn}
                    onPress={() => clearAction(action.key)}
                  >
                    <Text style={styles.clearBtnText}>Clear</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Mini phone preview */}
            <View style={styles.phoneMini}>
              <View style={styles.phoneMiniScreen}>
                <View style={[styles.miniGridH, { top: '25%' }]} />
                <View style={[styles.miniGridH, { top: '50%' }]} />
                <View style={[styles.miniGridH, { top: '75%' }]} />
                <View style={[styles.miniGridV, { left: '25%' }]} />
                <View style={[styles.miniGridV, { left: '50%' }]} />
                <View style={[styles.miniGridV, { left: '75%' }]} />
                {pts.map((pt, i) => (
                  <View key={i}>
                    <View
                      style={[
                        styles.miniDot,
                        {
                          left: pt.rx * PHONE_PREVIEW_W - 5,
                          top: pt.ry * PHONE_PREVIEW_H - 5,
                          backgroundColor: action.colorBg,
                          borderColor: action.color,
                        },
                      ]}
                    />
                    {action.taps > 1 && (
                      <Text style={[
                        styles.miniDotNum,
                        {
                          left: pt.rx * PHONE_PREVIEW_W - 3,
                          top: pt.ry * PHONE_PREVIEW_H - 4,
                          color: '#fff',
                        },
                      ]}>
                        {i + 1}
                      </Text>
                    )}
                  </View>
                ))}
              </View>
              <View style={styles.phoneNotch} />
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const fs = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    zIndex: 100,
  },
  canvas: {
    flex: 1,
    position: 'relative',
  },
  gridH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#1a1a1a',
  },
  gridV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: '#1a1a1a',
  },
  centerLine: {
    backgroundColor: '#2a2a2a',
  },
  topLabel: {
    position: 'absolute',
    top: 12,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  topLabelText: {
    fontSize: 15,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    overflow: 'hidden',
  },
  dot: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 3,
  },
  crossH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  crossV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  bottomRow: {
    position: 'absolute',
    bottom: 16,
    left: 32,
    right: 32,
    flexDirection: 'row',
    gap: 12,
  },
  retryBtn: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    paddingVertical: 14,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#333',
    alignItems: 'center',
  },
  retryText: {
    color: '#888',
    fontSize: 15,
    fontWeight: '600',
  },
  confirmBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 24,
    alignItems: 'center',
  },
  confirmText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  cancelBtn: {
    position: 'absolute',
    bottom: 16,
    alignSelf: 'center',
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#333',
  },
  cancelText: {
    color: '#888',
    fontSize: 15,
    fontWeight: '600',
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  hint: {
    color: '#555',
    fontSize: 13,
    marginBottom: 20,
    lineHeight: 18,
  },
  actionCard: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionLeft: {
    flex: 1,
    marginRight: 14,
  },
  actionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  actionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  actionLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  tapRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginLeft: 16,
    marginBottom: 4,
  },
  tapLabel: {
    color: '#888',
    fontSize: 12,
  },
  tapCoord: {
    fontSize: 12,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  tapNone: {
    color: '#333',
    fontSize: 12,
  },
  actionBtns: {
    flexDirection: 'row',
    gap: 10,
    marginLeft: 16,
    marginTop: 10,
  },
  recordBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  recordBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  clearBtn: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  clearBtnText: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
  },
  phoneMini: {
    width: PHONE_PREVIEW_W + 12,
    height: PHONE_PREVIEW_H + 12,
    backgroundColor: '#222',
    borderRadius: 10,
    padding: 6,
    alignItems: 'center',
    position: 'relative',
  },
  phoneMiniScreen: {
    width: PHONE_PREVIEW_W,
    height: PHONE_PREVIEW_H,
    backgroundColor: '#0a0a0a',
    borderRadius: 5,
    overflow: 'hidden',
    position: 'relative',
  },
  phoneNotch: {
    position: 'absolute',
    top: 2,
    width: 20,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#333',
    alignSelf: 'center',
  },
  miniGridH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#181818',
  },
  miniGridV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: '#181818',
  },
  miniDot: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
  },
  miniDotNum: {
    position: 'absolute',
    fontSize: 7,
    fontWeight: '800',
  },
});
