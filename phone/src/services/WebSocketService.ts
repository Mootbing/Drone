/**
 * WebSocket client for communication with the PC drone control server.
 * Handles connection management, heartbeat, and message routing.
 */

import { PhoneToPC, PCToPhone } from '../types/protocol';

type MessageHandler = (message: PCToPhone) => void;
type ConnectionHandler = (connected: boolean) => void;

const HEARTBEAT_INTERVAL_MS = 5000;
const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 999;

class WebSocketService {
  private ws: WebSocket | null = null;
  private serverUrl: string = '';
  private messageHandlers: MessageHandler[] = [];
  private connectionHandlers: ConnectionHandler[] = [];
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts: number = 0;
  private shouldReconnect: boolean = false;

  connect(serverUrl: string): void {
    this.serverUrl = serverUrl;
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;
    this._connect();
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this._cleanup();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._notifyConnection(false);
  }

  send(message: PhoneToPC): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.push(handler);
    return () => {
      this.messageHandlers = this.messageHandlers.filter(h => h !== handler);
    };
  }

  onConnection(handler: ConnectionHandler): () => void {
    this.connectionHandlers.push(handler);
    return () => {
      this.connectionHandlers = this.connectionHandlers.filter(h => h !== handler);
    };
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private _connect(): void {
    try {
      this.ws = new WebSocket(this.serverUrl);

      this.ws.onopen = () => {
        console.log('[WS] Connected to', this.serverUrl);
        this.reconnectAttempts = 0;
        this._startHeartbeat();
        this._notifyConnection(true);
      };

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const msg: PCToPhone = JSON.parse(event.data);
          for (const handler of this.messageHandlers) {
            handler(msg);
          }
        } catch (e) {
          console.error('[WS] Failed to parse message:', e);
        }
      };

      this.ws.onclose = () => {
        console.log('[WS] Disconnected');
        this._cleanup();
        this._notifyConnection(false);
        this._scheduleReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('[WS] Error:', error);
      };
    } catch (e) {
      console.error('[WS] Connection failed:', e);
      this._scheduleReconnect();
    }
  }

  private _startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'ping' });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private _cleanup(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private _scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      return;
    }
    this.reconnectAttempts++;
    console.log(`[WS] Reconnecting in ${RECONNECT_DELAY_MS}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      this._connect();
    }, RECONNECT_DELAY_MS);
  }

  private _notifyConnection(connected: boolean): void {
    for (const handler of this.connectionHandlers) {
      handler(connected);
    }
  }
}

export default new WebSocketService();
