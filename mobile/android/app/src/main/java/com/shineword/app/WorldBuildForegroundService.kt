package com.shineword.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import java.util.concurrent.TimeUnit

/**
 * Foreground runner for long world builds (closeout C5, plan §9).
 *
 * The service is a thin shell: it enters foreground with a dataSync
 * notification quickly (before any heavy work), then wakes the RN headless
 * task which drives the SAME run/lease coordinator as the foreground UI.
 * The JS task owns progress; the notification text is refreshed from the
 * task's emitted progress events. Work state lives in SQLite, so process
 * death between service restarts loses nothing.
 *
 * Android 15+ dataSync timeout: onTimeout is honored - the service stops
 * without pretending completion; the DB keeps the run resumable.
 */
class WorldBuildForegroundService : HeadlessJsTaskService() {

  companion object {
    const val CHANNEL_ID = "world_build"
    const val NOTIFICATION_ID = 42001
    const val ACTION_START = "com.shineword.app.worldbuild.START"
    const val ACTION_STOP = "com.shineword.app.worldbuild.STOP"
    const val EXTRA_RUN_ID = "runId"

    fun start(context: Context, runId: String) {
      val intent = Intent(context, WorldBuildForegroundService::class.java).apply {
        action = ACTION_START
        putExtra(EXTRA_RUN_ID, runId)
      }
      androidx.core.content.ContextCompat.startForegroundService(context, intent)
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, WorldBuildForegroundService::class.java))
    }
  }

  private var activeRunId: String? = null

  override fun onBind(intent: Intent): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopSelf()
      return START_NOT_STICKY
    }
    val runId = intent?.getStringExtra(EXTRA_RUN_ID)
    if (runId != null) activeRunId = runId
    ensureChannel()
    val notification = buildNotification(activeRunId ?: "", 0, 0)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    // HeadlessJsTaskService starts the JS task from onHeadlessJsTaskStart;
    // super.onStartCommand handles task wake-up on new intents.
    super.onStartCommand(intent, flags, startId)
    return START_REDELIVER_INTENT
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val runId = intent?.getStringExtra(EXTRA_RUN_ID) ?: activeRunId ?: ""
    return HeadlessJsTaskConfig(
      "WorldBuildRunner",
      Arguments.createMap().apply { putString("runId", runId) },
      TimeUnit.HOURS.toMillis(6),
      true, // the task must not be killed in doze mid-request
    )
  }

  override fun onHeadlessJsTaskStart(taskId: Int) {
    super.onHeadlessJsTaskStart(taskId)
  }

  /** Android 15+ cumulative dataSync limit reached: stop honestly. */
  override fun onTimeout(startId: Int, fgsType: Int) {
    stopSelf()
  }

  @Deprecated("Deprecated in Java")
  override fun onTimeout(startId: Int) {
    stopSelf()
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
      if (manager.getNotificationChannel(CHANNEL_ID) == null) {
        val channel = NotificationChannel(
          CHANNEL_ID,
          "小说构建",
          NotificationManager.IMPORTANCE_LOW,
        ).apply {
          description = "世界构建任务的进度通知"
          setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
      }
    }
  }

  private fun buildNotification(runId: String, done: Int, total: Int): Notification {
    ensureChannel()
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
    val contentIntent = PendingIntent.getActivity(
      this,
      0,
      launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val text = if (total > 0) "抽取 $done/$total 组" else "正在构建世界"
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setContentTitle("ShineWord 构建中")
      .setContentText(text)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setProgress(0, 0, total <= 0)
      .setContentIntent(contentIntent)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .build()
  }
}
