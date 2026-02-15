package com.dronecontrol.screencapture

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * React Native native module for MediaProjection screen capture.
 * Requests permission, starts a foreground service, and emits frame events.
 */
class ScreenCaptureModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    companion object {
        const val NAME = "ScreenCaptureModule"
        private const val REQUEST_CODE_MEDIA_PROJECTION = 1001
    }

    private var permissionPromise: Promise? = null

    init {
        reactContext.addActivityEventListener(this)
    }

    override fun getName(): String = NAME

    /**
     * Request MediaProjection permission from the user.
     * Returns a promise that resolves to true/false.
     */
    @ReactMethod
    fun requestPermission(promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "No current activity")
            return
        }

        permissionPromise = promise
        val mediaProjectionManager =
            activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val intent = mediaProjectionManager.createScreenCaptureIntent()
        activity.startActivityForResult(intent, REQUEST_CODE_MEDIA_PROJECTION)
    }

    /**
     * Start capturing screen frames. Must call requestPermission first.
     */
    @ReactMethod
    fun startCapture(promise: Promise) {
        val context = reactApplicationContext
        val intent = Intent(context, ScreenCaptureService::class.java).apply {
            action = ScreenCaptureService.ACTION_START
        }
        context.startForegroundService(intent)
        promise.resolve(true)
    }

    /**
     * Stop screen capture and release resources.
     */
    @ReactMethod
    fun stopCapture(promise: Promise) {
        val context = reactApplicationContext
        val intent = Intent(context, ScreenCaptureService::class.java).apply {
            action = ScreenCaptureService.ACTION_STOP
        }
        context.startService(intent)
        promise.resolve(true)
    }

    override fun onActivityResult(
        activity: Activity?,
        requestCode: Int,
        resultCode: Int,
        data: Intent?
    ) {
        if (requestCode == REQUEST_CODE_MEDIA_PROJECTION) {
            if (resultCode == Activity.RESULT_OK && data != null) {
                // Store the result for the service to use
                ScreenCaptureService.projectionResultCode = resultCode
                ScreenCaptureService.projectionData = data
                ScreenCaptureService.reactContext = reactApplicationContext
                permissionPromise?.resolve(true)
            } else {
                permissionPromise?.resolve(false)
            }
            permissionPromise = null
        }
    }

    override fun onNewIntent(intent: Intent?) {}

    /**
     * Send a captured frame event to React Native.
     */
    fun sendFrameEvent(frameBase64: String) {
        val params = Arguments.createMap().apply {
            putString("frame", frameBase64)
        }
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("onFrameCaptured", params)
    }
}
