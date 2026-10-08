package com.shineword.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener

/** Protects existing requests, never owns or replays a planning job. Only an
 * opaque lifetime token and its bounded deadline cross this native boundary.
 * A separate wake lock avoids releasing WorldBuild's shared headless lock. */
class LlmRequestExecutionService : Service(), HeadlessJsTaskEventListener {
  companion object {
    private const val CHANNEL = "adventure_planning"
    private const val NOTIFICATION = 42003
    private const val MAX_EXECUTION_MS = 2_700_000L
    private val handler = Handler(Looper.getMainLooper())
    private data class Pending(val promise: Promise, val timeoutMs: Long)
    private val pending = mutableMapOf<String, Pending>()

    fun acquire(context: Context, token: String, timeoutMs: Double, promise: Promise) {
      UiThreadUtil.runOnUiThread {
        if (!token.matches(Regex("llm-[a-z0-9]+-[0-9]+")) || !timeoutMs.isFinite() ||
          timeoutMs % 1.0 != 0.0 || timeoutMs < 1 || timeoutMs > MAX_EXECUTION_MS || pending.containsKey(token)) {
          promise.reject("E_LLM_EXECUTION", "Invalid request execution token or deadline")
          return@runOnUiThread
        }
        val waiting = Pending(promise, timeoutMs.toLong())
        pending[token] = waiting
        handler.postDelayed({
          if (pending[token] === waiting) {
            pending.remove(token)
            promise.reject("E_LLM_EXECUTION", "Request execution service did not enter foreground")
          }
        }, 10_000)
        try {
          ContextCompat.startForegroundService(context, Intent(context, LlmRequestExecutionService::class.java)
            .putExtra("token", token))
        } catch (_: Exception) {
          pending.remove(token)
          promise.reject("E_LLM_EXECUTION", "Request execution service unavailable")
        }
      }
    }
  }

  private val taskIds = mutableSetOf<Int>()
  private var tasks: HeadlessJsTaskContext? = null
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val token = intent?.getStringExtra("token")
    val waiting = token?.let { pending.remove(it) }
    // A redelivered/orphaned intent cannot start a task or an HTTP request.
    if (waiting == null) {
      if (taskIds.isEmpty()) stopSelf()
      return START_NOT_STICKY
    }
    try {
      val context = (application as MainApplication).reactHost.currentReactContext
        ?: throw IllegalStateException("No live request owner")
      enterForeground()
      if (wakeLock == null) {
        wakeLock = (getSystemService(POWER_SERVICE) as PowerManager)
          .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ShineWord:LlmRequestExecution")
          .apply { setReferenceCounted(false) }
      }
      wakeLock?.acquire(MAX_EXECUTION_MS + 10_000)
      val taskContext = HeadlessJsTaskContext.getInstance(context)
      tasks = taskContext
      taskContext.addTaskEventListener(this)
      val taskId = taskContext.startTask(HeadlessJsTaskConfig(
        "LlmRequestKeepAlive", Arguments.createMap().apply { putString("token", token) },
        waiting.timeoutMs + 10_000, true,
      ))
      taskIds.add(taskId)
      // Resolve only after foreground and RN timer protection are active.
      waiting.promise.resolve(true)
    } catch (_: Exception) {
      waiting.promise.reject("E_LLM_EXECUTION", "Request execution protection failed")
      if (taskIds.isEmpty()) stopSelf()
    }
    return START_NOT_STICKY
  }

  private fun enterForeground() {
    val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL) == null) {
      manager.createNotificationChannel(NotificationChannel(CHANNEL, "冒险规划", NotificationManager.IMPORTANCE_LOW))
    }
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val content = PendingIntent.getActivity(this, NOTIFICATION, launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val notification = NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setContentTitle("ShineWord 冒险规划")
      .setContentText("正在准备冒险，返回应用可查看进度")
      .setOngoing(true).setOnlyAlertOnce(true).setProgress(0, 0, true)
      .setContentIntent(content).build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else startForeground(NOTIFICATION, notification)
  }

  override fun onHeadlessJsTaskStart(taskId: Int) = Unit

  override fun onHeadlessJsTaskFinish(taskId: Int) {
    if (taskIds.remove(taskId) && taskIds.isEmpty()) stopSelf()
  }

  override fun onDestroy() {
    tasks?.removeTaskEventListener(this)
    for (taskId in taskIds.toList()) {
      if (tasks?.isTaskRunning(taskId) == true) tasks?.finishTask(taskId)
    }
    taskIds.clear()
    if (wakeLock?.isHeld == true) wakeLock?.release()
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  override fun onTimeout(startId: Int, fgsType: Int) { stopSelf() }
  @Deprecated("Deprecated in Java")
  override fun onTimeout(startId: Int) { stopSelf() }
}
