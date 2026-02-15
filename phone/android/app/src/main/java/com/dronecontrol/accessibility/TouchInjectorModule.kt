package com.dronecontrol.accessibility

import android.content.Intent
import android.provider.Settings
import com.facebook.react.bridge.*

/**
 * React Native native module bridge for the Accessibility Service.
 * Provides methods to check service status, open settings, and inject gestures.
 */
class TouchInjectorModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "TouchInjectorModule"
    }

    override fun getName(): String = NAME

    /**
     * Check if the DroneAccessibilityService is currently enabled.
     */
    @ReactMethod
    fun isServiceEnabled(promise: Promise) {
        val service = DroneAccessibilityService.instance
        promise.resolve(service != null)
    }

    /**
     * Open Android Accessibility Settings so the user can enable the service.
     */
    @ReactMethod
    fun openAccessibilitySettings() {
        val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        reactApplicationContext.startActivity(intent)
    }

    /**
     * Inject a swipe gesture via the Accessibility Service.
     *
     * @param startX Start X coordinate
     * @param startY Start Y coordinate
     * @param endX End X coordinate
     * @param endY End Y coordinate
     * @param durationMs Swipe duration in milliseconds
     */
    @ReactMethod
    fun injectSwipe(
        startX: Double,
        startY: Double,
        endX: Double,
        endY: Double,
        durationMs: Double,
        promise: Promise
    ) {
        val service = DroneAccessibilityService.instance
        if (service == null) {
            promise.reject("SERVICE_NOT_ENABLED",
                "Accessibility Service is not enabled. Please enable it in Settings.")
            return
        }

        service.injectSwipe(
            startX.toFloat(),
            startY.toFloat(),
            endX.toFloat(),
            endY.toFloat(),
            durationMs.toLong()
        ) { success ->
            if (success) {
                promise.resolve(true)
            } else {
                promise.reject("GESTURE_FAILED", "Gesture was cancelled or failed")
            }
        }
    }

    /**
     * Inject a tap gesture via the Accessibility Service.
     */
    @ReactMethod
    fun injectTap(x: Double, y: Double, promise: Promise) {
        val service = DroneAccessibilityService.instance
        if (service == null) {
            promise.reject("SERVICE_NOT_ENABLED",
                "Accessibility Service is not enabled.")
            return
        }

        service.injectTap(x.toFloat(), y.toFloat()) { success ->
            if (success) {
                promise.resolve(true)
            } else {
                promise.reject("GESTURE_FAILED", "Tap gesture failed")
            }
        }
    }
}
