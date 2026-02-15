package com.dronecontrol.screencapture

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Base64
import android.util.DisplayMetrics
import android.view.WindowManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.ByteArrayOutputStream
import java.util.*

/**
 * Foreground service that holds the MediaProjection session.
 * Captures frames at ~1fps, compresses to JPEG, and emits to React Native.
 */
class ScreenCaptureService : Service() {

    companion object {
        const val ACTION_START = "com.dronecontrol.screencapture.START"
        const val ACTION_STOP = "com.dronecontrol.screencapture.STOP"
        const val CHANNEL_ID = "screen_capture_channel"
        const val NOTIFICATION_ID = 1

        // Target capture dimensions (720p)
        const val CAPTURE_WIDTH = 1280
        const val CAPTURE_HEIGHT = 720
        const val JPEG_QUALITY = 70
        const val CAPTURE_INTERVAL_MS = 1000L // ~1fps

        // Set by ScreenCaptureModule after permission granted
        var projectionResultCode: Int = 0
        var projectionData: Intent? = null
        var reactContext: ReactApplicationContext? = null
    }

    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var captureTimer: Timer? = null
    private val handler = Handler(Looper.getMainLooper())

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startProjection()
            ACTION_STOP -> stopProjection()
        }
        return START_NOT_STICKY
    }

    private fun startProjection() {
        // Start as foreground service
        val notification = Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Drone Control")
            .setContentText("Capturing screen for drone navigation")
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .build()
        startForeground(NOTIFICATION_ID, notification)

        val data = projectionData ?: return
        val projectionManager =
            getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        mediaProjection = projectionManager.getMediaProjection(projectionResultCode, data)

        // Set up ImageReader
        imageReader = ImageReader.newInstance(
            CAPTURE_WIDTH, CAPTURE_HEIGHT,
            PixelFormat.RGBA_8888, 2
        )

        // Get screen density
        val windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        val metrics = DisplayMetrics()
        windowManager.defaultDisplay.getMetrics(metrics)

        // Create virtual display
        virtualDisplay = mediaProjection?.createVirtualDisplay(
            "DroneScreenCapture",
            CAPTURE_WIDTH, CAPTURE_HEIGHT,
            metrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader!!.surface,
            null, handler
        )

        // Start capture timer
        captureTimer = Timer().apply {
            scheduleAtFixedRate(object : TimerTask() {
                override fun run() {
                    captureFrame()
                }
            }, 0, CAPTURE_INTERVAL_MS)
        }
    }

    private fun captureFrame() {
        val image = imageReader?.acquireLatestImage() ?: return

        try {
            val planes = image.planes
            val buffer = planes[0].buffer
            val pixelStride = planes[0].pixelStride
            val rowStride = planes[0].rowStride
            val rowPadding = rowStride - pixelStride * CAPTURE_WIDTH

            // Create bitmap from image buffer
            val bitmap = Bitmap.createBitmap(
                CAPTURE_WIDTH + rowPadding / pixelStride,
                CAPTURE_HEIGHT,
                Bitmap.Config.ARGB_8888
            )
            bitmap.copyPixelsFromBuffer(buffer)

            // Crop to exact dimensions (remove padding)
            val croppedBitmap = Bitmap.createBitmap(bitmap, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT)
            if (croppedBitmap !== bitmap) {
                bitmap.recycle()
            }

            // Compress to JPEG
            val outputStream = ByteArrayOutputStream()
            croppedBitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, outputStream)
            croppedBitmap.recycle()

            // Encode to base64 and emit to RN
            val base64Frame = Base64.encodeToString(outputStream.toByteArray(), Base64.NO_WRAP)
            emitFrame(base64Frame)
        } finally {
            image.close()
        }
    }

    private fun emitFrame(base64Frame: String) {
        val ctx = reactContext ?: return
        try {
            val params = Arguments.createMap().apply {
                putString("frame", base64Frame)
            }
            ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("onFrameCaptured", params)
        } catch (e: Exception) {
            // React context may not be ready
        }
    }

    private fun stopProjection() {
        captureTimer?.cancel()
        captureTimer = null
        virtualDisplay?.release()
        virtualDisplay = null
        imageReader?.close()
        imageReader = null
        mediaProjection?.stop()
        mediaProjection = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Screen Capture",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Screen capture for drone navigation"
        }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)
    }

    override fun onDestroy() {
        stopProjection()
        super.onDestroy()
    }
}
