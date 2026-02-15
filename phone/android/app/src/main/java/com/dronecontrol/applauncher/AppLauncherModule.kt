package com.dronecontrol.applauncher

import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.util.Base64
import com.facebook.react.bridge.*
import java.io.ByteArrayOutputStream

class AppLauncherModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "AppLauncher"

    @ReactMethod
    fun launchApp(packageName: String) {
        val pm = reactApplicationContext.packageManager
        val intent = pm.getLaunchIntentForPackage(packageName)
        if (intent != null) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactApplicationContext.startActivity(intent)
        }
    }

    @ReactMethod
    fun getInstalledApps(promise: Promise) {
        try {
            val pm = reactApplicationContext.packageManager
            val intent = Intent(Intent.ACTION_MAIN, null)
            intent.addCategory(Intent.CATEGORY_LAUNCHER)
            val apps = pm.queryIntentActivities(intent, 0)

            val result = Arguments.createArray()
            for (info in apps) {
                val pkg = info.activityInfo.packageName
                // Skip our own app
                if (pkg == reactApplicationContext.packageName) continue

                val map = Arguments.createMap()
                map.putString("packageName", pkg)
                map.putString("appName", info.loadLabel(pm).toString())

                // Get small icon as base64
                try {
                    val drawable = info.loadIcon(pm)
                    val bitmap = drawableToBitmap(drawable, 48)
                    val stream = ByteArrayOutputStream()
                    bitmap.compress(Bitmap.CompressFormat.PNG, 80, stream)
                    val b64 = Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)
                    map.putString("icon", b64)
                } catch (e: Exception) {
                    map.putString("icon", "")
                }

                result.pushMap(map)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("ERR", e.message)
        }
    }

    private fun drawableToBitmap(drawable: Drawable, sizePx: Int): Bitmap {
        if (drawable is BitmapDrawable && drawable.bitmap != null) {
            return Bitmap.createScaledBitmap(drawable.bitmap, sizePx, sizePx, true)
        }
        val bitmap = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        drawable.setBounds(0, 0, sizePx, sizePx)
        drawable.draw(canvas)
        return bitmap
    }
}
