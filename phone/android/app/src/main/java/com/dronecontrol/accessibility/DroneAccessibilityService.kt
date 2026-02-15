package com.dronecontrol.accessibility

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.accessibility.AccessibilityEvent

/**
 * Accessibility Service for injecting touch gestures into the drone manufacturer's app.
 * Must be enabled by the user in Android Settings > Accessibility.
 *
 * Uses GestureDescription API to dispatch swipe gestures that simulate
 * joystick input on the drone control app.
 */
class DroneAccessibilityService : AccessibilityService() {

    companion object {
        private const val TAG = "DroneAccessibility"

        // Singleton reference for the TouchInjectorModule to access
        var instance: DroneAccessibilityService? = null
            private set
    }

    private val handler = Handler(Looper.getMainLooper())

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.i(TAG, "Accessibility service connected")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // We don't need to process accessibility events —
        // this service is only used for gesture injection.
    }

    override fun onInterrupt() {
        Log.w(TAG, "Accessibility service interrupted")
    }

    override fun onDestroy() {
        instance = null
        Log.i(TAG, "Accessibility service destroyed")
        super.onDestroy()
    }

    /**
     * Inject a swipe gesture from (startX, startY) to (endX, endY) over the given duration.
     *
     * @param startX Start X coordinate (screen pixels)
     * @param startY Start Y coordinate (screen pixels)
     * @param endX End X coordinate (screen pixels)
     * @param endY End Y coordinate (screen pixels)
     * @param durationMs Duration of the swipe in milliseconds
     * @param callback Called with true on success, false on failure
     */
    fun injectSwipe(
        startX: Float,
        startY: Float,
        endX: Float,
        endY: Float,
        durationMs: Long,
        callback: ((Boolean) -> Unit)? = null
    ) {
        val path = Path().apply {
            moveTo(startX, startY)
            lineTo(endX, endY)
        }

        val strokeDescription = GestureDescription.StrokeDescription(
            path,
            0,               // start time offset
            durationMs       // gesture duration
        )

        val gestureDescription = GestureDescription.Builder()
            .addStroke(strokeDescription)
            .build()

        val dispatched = dispatchGesture(
            gestureDescription,
            object : GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) {
                    Log.d(TAG, "Gesture completed: (${startX},${startY}) → (${endX},${endY})")
                    callback?.invoke(true)
                }

                override fun onCancelled(gestureDescription: GestureDescription?) {
                    Log.w(TAG, "Gesture cancelled")
                    callback?.invoke(false)
                }
            },
            handler
        )

        if (!dispatched) {
            Log.e(TAG, "Gesture dispatch failed")
            callback?.invoke(false)
        }
    }

    /**
     * Inject a tap gesture at the given coordinates.
     */
    fun injectTap(x: Float, y: Float, callback: ((Boolean) -> Unit)? = null) {
        val path = Path().apply {
            moveTo(x, y)
        }

        val strokeDescription = GestureDescription.StrokeDescription(
            path, 0, 50 // short tap
        )

        val gestureDescription = GestureDescription.Builder()
            .addStroke(strokeDescription)
            .build()

        dispatchGesture(
            gestureDescription,
            object : GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) {
                    callback?.invoke(true)
                }

                override fun onCancelled(gestureDescription: GestureDescription?) {
                    callback?.invoke(false)
                }
            },
            handler
        )
    }
}
