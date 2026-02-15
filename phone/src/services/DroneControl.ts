/**
 * Bridge to native TouchInjectorModule (Accessibility Service).
 * Translates movement commands into touch gestures on the drone app.
 */

import { NativeModules } from 'react-native';
import { Direction, CommandMessage } from '../types/protocol';

const { TouchInjectorModule } = NativeModules;

/** Joystick coordinate config — user calibrates per drone app. */
export interface JoystickConfig {
  leftStick: { centerX: number; centerY: number; radius: number };
  rightStick: { centerX: number; centerY: number; radius: number };
}

const DEFAULT_CONFIG: JoystickConfig = {
  leftStick: { centerX: 200, centerY: 800, radius: 100 },
  rightStick: { centerX: 880, centerY: 800, radius: 100 },
};

class DroneControlService {
  private config: JoystickConfig = DEFAULT_CONFIG;

  setJoystickConfig(config: JoystickConfig): void {
    this.config = config;
  }

  /**
   * Check if the Accessibility Service is enabled.
   */
  async isServiceEnabled(): Promise<boolean> {
    try {
      return await TouchInjectorModule.isServiceEnabled();
    } catch {
      return false;
    }
  }

  /**
   * Open Accessibility Settings so user can enable the service.
   */
  openAccessibilitySettings(): void {
    TouchInjectorModule.openAccessibilitySettings();
  }

  /**
   * Execute a movement command by injecting a swipe gesture.
   */
  async executeCommand(command: CommandMessage): Promise<void> {
    if (command.action === 'hover') {
      return; // No gesture needed for hover
    }

    const gesture = this._mapDirectionToGesture(command.direction, command.intensity);
    if (!gesture) return;

    try {
      await TouchInjectorModule.injectSwipe(
        gesture.startX,
        gesture.startY,
        gesture.endX,
        gesture.endY,
        command.duration_ms,
      );
    } catch (e) {
      console.error('[DroneControl] Gesture injection failed:', e);
    }
  }

  /**
   * Map a direction + intensity to swipe coordinates on the appropriate joystick.
   */
  private _mapDirectionToGesture(
    direction: Direction,
    intensity: number,
  ): { startX: number; startY: number; endX: number; endY: number } | null {
    const { leftStick, rightStick } = this.config;
    const clampedIntensity = Math.max(0, Math.min(1, intensity));

    switch (direction) {
      // Right stick: forward/back/left/right (pitch & roll)
      case 'forward':
        return {
          startX: rightStick.centerX,
          startY: rightStick.centerY,
          endX: rightStick.centerX,
          endY: rightStick.centerY - rightStick.radius * clampedIntensity,
        };
      case 'back':
        return {
          startX: rightStick.centerX,
          startY: rightStick.centerY,
          endX: rightStick.centerX,
          endY: rightStick.centerY + rightStick.radius * clampedIntensity,
        };
      case 'left':
        return {
          startX: rightStick.centerX,
          startY: rightStick.centerY,
          endX: rightStick.centerX - rightStick.radius * clampedIntensity,
          endY: rightStick.centerY,
        };
      case 'right':
        return {
          startX: rightStick.centerX,
          startY: rightStick.centerY,
          endX: rightStick.centerX + rightStick.radius * clampedIntensity,
          endY: rightStick.centerY,
        };

      // Left stick: up/down (throttle) and rotation (yaw)
      case 'up':
        return {
          startX: leftStick.centerX,
          startY: leftStick.centerY,
          endX: leftStick.centerX,
          endY: leftStick.centerY - leftStick.radius * clampedIntensity,
        };
      case 'down':
        return {
          startX: leftStick.centerX,
          startY: leftStick.centerY,
          endX: leftStick.centerX,
          endY: leftStick.centerY + leftStick.radius * clampedIntensity,
        };
      case 'rotate_cw':
        return {
          startX: leftStick.centerX,
          startY: leftStick.centerY,
          endX: leftStick.centerX + leftStick.radius * clampedIntensity,
          endY: leftStick.centerY,
        };
      case 'rotate_ccw':
        return {
          startX: leftStick.centerX,
          startY: leftStick.centerY,
          endX: leftStick.centerX - leftStick.radius * clampedIntensity,
          endY: leftStick.centerY,
        };

      case 'none':
      default:
        return null;
    }
  }
}

export const droneControl = new DroneControlService();
export default droneControl;
