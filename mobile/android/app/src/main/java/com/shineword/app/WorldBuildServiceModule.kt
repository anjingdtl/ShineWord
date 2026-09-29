package com.shineword.app

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
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
      // The SAME builder the service uses, so the progress refresh never
      // strips the pause/cancel actions (unified P4).
      val notification = WorldBuildForegroundService.buildProgressNotification(
        reactApplicationContext, runId, done.toInt(), total.toInt(),
      )
      manager.notify(NOTIFICATION_ID, notification)
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.resolve(false)
    }
  }

  /**
   * Notification control channel (unified P4): flips the same persisted
   * pause/cancel flags the coordinator polls between units. Safe to call
   * from any process; no secrets or novel text cross the bridge.
   */
  @ReactMethod
  fun requestRunControl(runId: String, kind: String, promise: Promise) {
    try {
      promise.resolve(WorldBuildForegroundService.requestRunControl(reactApplicationContext, runId, kind))
    } catch (error: Throwable) {
      promise.resolve(false)
    }
  }
}
