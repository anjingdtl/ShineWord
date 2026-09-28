package com.shineword.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * JS-facing control surface for the world-build foreground service (closeout
 * C5). Only run ids and integer counters cross the bridge - never novel text,
 * credentials or results (plan §9.2 rule 6).
 */
class WorldBuildServiceModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "WorldBuildService"
    const val CHANNEL_ID = "world_build"
    const val NOTIFICATION_ID = 42001
    const val ACTION_START = "com.shineword.app.worldbuild.START"
  }

  override fun getName(): String = NAME

  @ReactMethod
  fun startService(runId: String, promise: Promise) {
    try {
      val intent = Intent(reactApplicationContext, WorldBuildForegroundService::class.java).apply {
        action = ACTION_START
        putExtra(WorldBuildForegroundService.EXTRA_RUN_ID, runId)
      }
      androidx.core.content.ContextCompat.startForegroundService(reactApplicationContext, intent)
      promise.resolve(true)
    } catch (error: Throwable) {
      // e.g. Android 12+ background-start restriction when the app is not
      // visible: the UI keeps driving the build inline; correctness is the
      // lease's job, not the service's.
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun stopService(promise: Promise) {
    try {
      reactApplicationContext.stopService(
        Intent(reactApplicationContext, WorldBuildForegroundService::class.java),
      )
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun notifyBuildProgress(runId: String, done: Double, total: Double, promise: Promise) {
    try {
      val manager = reactApplicationContext.getSystemService(
        Context.NOTIFICATION_SERVICE,
      ) as NotificationManager
      val notification = buildNotification(done.toInt(), total.toInt())
      manager.notify(NOTIFICATION_ID, notification)
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.resolve(false)
    }
  }

  private fun ensureChannel(manager: NotificationManager) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL_ID) == null) {
      val channel = NotificationChannel(
        CHANNEL_ID, "小说构建", NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "世界构建任务的进度通知"
        setShowBadge(false)
      }
      manager.createNotificationChannel(channel)
    }
  }

  private fun buildNotification(done: Int, total: Int): Notification {
    val manager = reactApplicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    ensureChannel(manager)
    val launchIntent = reactApplicationContext.packageManager.getLaunchIntentForPackage(reactApplicationContext.packageName)
    val contentIntent = PendingIntent.getActivity(
      reactApplicationContext, 0, launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val text = if (total > 0) "抽取 $done/$total 组" else "正在构建世界"
    return NotificationCompat.Builder(reactApplicationContext, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setContentTitle("ShineWord 构建中")
      .setContentText(text)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(contentIntent)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .build()
  }
}
