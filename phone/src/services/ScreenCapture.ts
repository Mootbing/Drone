/**
 * Bridge to native ScreenCaptureModule (MediaProjection).
 * Captures the drone manufacturer's app screen and emits frames.
 */

import { NativeModules, NativeEventEmitter } from 'react-native';

const { ScreenCaptureModule } = NativeModules;

type FrameCallback = (frameBase64: string) => void;

class ScreenCaptureService {
  private emitter: NativeEventEmitter;
  private frameListeners: FrameCallback[] = [];
  private subscription: any = null;
  private capturing: boolean = false;

  constructor() {
    this.emitter = new NativeEventEmitter(ScreenCaptureModule);
  }

  /**
   * Request MediaProjection permission and start capturing.
   * The user will see a system dialog to grant screen capture permission.
   */
  async startCapture(): Promise<boolean> {
    if (this.capturing) return true;

    try {
      const granted = await ScreenCaptureModule.requestPermission();
      if (!granted) {
        console.warn('[ScreenCapture] Permission denied');
        return false;
      }

      // Listen for native frame events
      this.subscription = this.emitter.addListener(
        'onFrameCaptured',
        (event: { frame: string }) => {
          for (const listener of this.frameListeners) {
            listener(event.frame);
          }
        },
      );

      await ScreenCaptureModule.startCapture();
      this.capturing = true;
      console.log('[ScreenCapture] Started');
      return true;
    } catch (e) {
      console.error('[ScreenCapture] Start failed:', e);
      return false;
    }
  }

  /**
   * Stop screen capture and release MediaProjection.
   */
  async stopCapture(): Promise<void> {
    if (!this.capturing) return;

    try {
      await ScreenCaptureModule.stopCapture();
    } catch (e) {
      console.error('[ScreenCapture] Stop failed:', e);
    }

    if (this.subscription) {
      this.subscription.remove();
      this.subscription = null;
    }

    this.capturing = false;
    console.log('[ScreenCapture] Stopped');
  }

  /**
   * Register a callback for captured frames.
   * Returns an unsubscribe function.
   */
  onFrame(callback: FrameCallback): () => void {
    this.frameListeners.push(callback);
    return () => {
      this.frameListeners = this.frameListeners.filter(l => l !== callback);
    };
  }

  get isCapturing(): boolean {
    return this.capturing;
  }
}

export const screenCapture = new ScreenCaptureService();
export default screenCapture;
