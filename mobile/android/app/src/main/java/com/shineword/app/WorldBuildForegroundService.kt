package com.shineword.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.database.sqlite.SQLiteDatabase
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import java.util.concurrent.TimeUnit

/**
 * Foreground runner for long world builds (closeout C5, plan §9; unified P4).
 *
 * The service is a thin shell: it enters foreground with a dataSync
 * notification quickly (before any heavy work), then wakes the RN headless
 * task which drives the SAME run/lease coordinator as the foreground UI.
 * The JS task owns progress; the notification text is refreshed from the
 * task's emitted progress events. Work state lives in SQLite, so process
 * death between service restarts loses nothing.
 *
 * Unified P4: the notification carries real PAUSE/CANCEL actions. They do
 * not talk to JS directly - they flip the same persisted control flags the
 * UI writes (world_build_runs.pause_requested / cancel_requested), which the
 * coordinator polls between units, so notification, UI and headless service
 * share one control channel and a late response is still fenced.
 *
 * Android 15+ dataSync timeout: onTimeout is honored - the service stops
 * without pretending completion; the run row records why and stays resumable.
 */
class WorldBuildForegroundService : HeadlessJsTaskService() {

  companion object {
    const val CHANNEL_ID = "world_build"
    const val NOTIFICATION_ID = 42001
    const val ACTION_START = "com.shineword.app.worldbuild.START"
    const val ACTION_STOP = "com.shineword.app.worldbuild.STOP"
    const val ACTION_PAUSE = "com.shineword.app.worldbuild.PAUSE"
    const val ACTION_CANCEL = "com.shineword.app.worldbuild.CANCEL"
    const val ACTION_RESUME = "com.shineword.app.worldbuild.RESUME"
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

    /**
     * Control-flag write shared by the notification actions and the module.
     * Direct SQL on the app's default shineword.db - the same row the JS
     * coordinator polls; no key material, no novel text, no JS dependency.
     */
    fun requestRunControl(context: Context, runId: String, kind: String): Boolean {
      val dbFile = context.getDatabasePath("shineword.db")
      if (!dbFile.exists()) return false
      return try {
        SQLiteDatabase.openDatabase(dbFile.absolutePath, null, SQLiteDatabase.OPEN_READWRITE).use { db ->
          when (kind) {
            "pause" -> db.execSQL(
              "UPDATE world_build_runs SET pause_requested = 1, updated_at = ? WHERE run_id = ?",
              arrayOf(nowIso(), runId),
            )
            "cancel" -> db.execSQL(
              "UPDATE world_build_runs SET cancel_requested = 1, updated_at = ? WHERE run_id = ?",
              arrayOf(nowIso(), runId),
            )
            "resume" -> db.execSQL(
              "UPDATE world_build_runs SET pause_requested = 0, updated_at = ? WHERE run_id = ?",
              arrayOf(nowIso(), runId),
            )
            else -> return false
          }
          true
        }
      } catch (e: Exception) {
        false
      }
    }

    private fun nowIso(): String = java.time.Instant.now().toString()

    /** Progress notification shared with WorldBuildServiceModule (P4). */
    fun buildProgressNotification(context: Context, runId: String, done: Int, total: Int): Notification {
      ensureChannel(context)
      val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
      val contentIntent = PendingIntent.getActivity(
        context, 0, launchIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      val text = if (total > 0) "抽取 $done/$total 组" else "正在构建世界"
      val builder = NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.stat_sys_download)
        .setContentTitle("ShineWord 构建中")
        .setContentText(text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setProgress(0, 0, total <= 0)
        .setContentIntent(contentIntent)
        .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      if (runId.isNotEmpty()) {
        val pauseIntent = PendingIntent.getService(
          context, 4201,
          Intent(context, WorldBuildForegroundService::class.java).apply {
            action = ACTION_PAUSE; putExtra(EXTRA_RUN_ID, runId)
          },
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val cancelIntent = PendingIntent.getService(
          context, 4202,
          Intent(context, WorldBuildForegroundService::class.java).apply {
            action = ACTION_CANCEL; putExtra(EXTRA_RUN_ID, runId)
          },
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        builder.addAction(0, "暂停", pauseIntent)
        builder.addAction(0, "取消", cancelIntent)
      }
      return builder.build()
    }

    private fun ensureChannel(context: Context) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val manager = context.getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) == null) {
          val channel = NotificationChannel(
            CHANNEL_ID, "小说构建", NotificationManager.IMPORTANCE_LOW,
          ).apply {
            description = "世界构建任务的进度通知"
            setShowBadge(false)
          }
          manager.createNotificationChannel(channel)
        }
      }
    }
  }

  private var activeRunId: String? = null

  override fun onBind(intent: Intent): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        stopSelf()
        return START_NOT_STICKY
      }
      // Notification control actions: flip the persisted flag and refresh the
      // notification; the JS coordinator honors it between units (late
      // in-flight responses are fenced by the lease token, never committed).
      ACTION_PAUSE, ACTION_CANCEL, ACTION_RESUME -> {
        val runId = intent.getStringExtra(EXTRA_RUN_ID) ?: activeRunId
        if (runId != null) {
          requestRunControl(
            this, runId,
            when (intent.action) {
              ACTION_PAUSE -> "pause"
              ACTION_CANCEL -> "cancel"
              else -> "resume"
            },
          )
        }
        if (intent.action == ACTION_RESUME) {
          // 继续: clear the pause flag above, then re-wake the task.
          activeRunId = runId
          ensureChannel()
          val notification = buildNotification(runId ?: "", 0, 0)
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
          } else {
            startForeground(NOTIFICATION_ID, notification)
          }
          super.onStartCommand(intent, flags, startId)
          return START_REDELIVER_INTENT
        }
        updateNotificationForControl(intent.action ?: ACTION_PAUSE)
        return START_NOT_STICKY
      }
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
    markTimeoutReason()
    stopSelf()
  }

  @Deprecated("Deprecated in Java")
  override fun onTimeout(startId: Int) {
    markTimeoutReason()
    stopSelf()
  }

  private fun markTimeoutReason() {
    val runId = activeRunId ?: return
    val dbFile = getDatabasePath("shineword.db")
    if (!dbFile.exists()) return
    try {
      SQLiteDatabase.openDatabase(dbFile.absolutePath, null, SQLiteDatabase.OPEN_READWRITE).use { db ->
        db.execSQL(
          "UPDATE world_build_runs SET last_error_code = 'fgs_dataSync_timeout', updated_at = ? WHERE run_id = ?",
          arrayOf(nowIso(), runId),
        )
      }
    } catch (e: Exception) {
      // Recording the reason is best-effort; the lease expiry alone already
      // leaves the run correctly resumable.
    }
  }

  private fun updateNotificationForControl(action: String) {
    val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    manager.notify(
      NOTIFICATION_ID,
      buildNotification(activeRunId ?: "", 0, 0, action == ACTION_PAUSE),
    )
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

  private fun controlPendingIntent(action: String, requestCode: Int): PendingIntent {
    val intent = Intent(this, WorldBuildForegroundService::class.java).apply {
      this.action = action
      putExtra(EXTRA_RUN_ID, activeRunId ?: "")
    }
    return PendingIntent.getService(
      this,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun buildNotification(runId: String, done: Int, total: Int, paused: Boolean = false): Notification {
    ensureChannel()
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
    val contentIntent = PendingIntent.getActivity(
      this,
      0,
      launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val text = when {
      paused -> "已请求暂停，等待当前请求完成…"
      total > 0 -> "抽取 $done/$total 组"
      else -> "正在构建世界"
    }
    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setContentTitle("ShineWord 构建中")
      .setContentText(text)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setProgress(0, 0, total <= 0)
      .setContentIntent(contentIntent)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
    if (runId.isNotEmpty()) {
      builder.addAction(
        0,
        if (paused) "继续" else "暂停",
        controlPendingIntent(if (paused) ACTION_RESUME else ACTION_PAUSE, 4201),
      )
      builder.addAction(0, "取消", controlPendingIntent(ACTION_CANCEL, 4202))
    }
    return builder.build()
  }
}
