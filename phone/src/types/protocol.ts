/** Shared type definitions for phone ↔ PC WebSocket protocol. */

// --- Phone → PC ---

export interface GPS {
  lat: number;
  lng: number;
  alt: number;
}

export interface FrameMessage {
  type: 'frame';
  timestamp: number;
  gps: GPS;
  frame: string; // base64 JPEG
}

export interface StatusMessage {
  type: 'status';
  battery: number;
  signal: 'strong' | 'weak' | 'lost';
  mode: string;
}

export interface MissionInputMessage {
  type: 'mission_input';
  address: string;
  reference_photo: string; // base64 JPEG
  delivery_message: string;
  gps: GPS;
}

export interface AbortMessage {
  type: 'abort';
}

export interface DeliveryConfirmedMessage {
  type: 'delivery_confirmed';
}

export interface PingMessage {
  type: 'ping';
}

export type PhoneToPC =
  | FrameMessage
  | StatusMessage
  | MissionInputMessage
  | AbortMessage
  | DeliveryConfirmedMessage
  | PingMessage;

// --- PC → Phone ---

export type Direction =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'rotate_cw'
  | 'rotate_ccw'
  | 'none';

export interface CommandMessage {
  type: 'command';
  action: 'move' | 'hover';
  direction: Direction;
  intensity: number; // 0.0 - 1.0
  duration_ms: number;
}

export type DroneMode =
  | 'input'
  | 'navigation'
  | 'identification'
  | 'approach'
  | 'delivery'
  | 'hover'
  | 'done';

export interface ModeChangeMessage {
  type: 'mode_change';
  mode: DroneMode;
  message: string;
}

export interface IdentifiedMessage {
  type: 'identified';
  match: boolean;
  confidence: number;
  person_bbox: [number, number, number, number];
  action: string;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export interface PongMessage {
  type: 'pong';
  timestamp: number;
}

export type PCToPhone =
  | CommandMessage
  | ModeChangeMessage
  | IdentifiedMessage
  | ErrorMessage
  | PongMessage;
