package com.shineword.app.react

import com.facebook.fbreact.specs.NativeHeadlessJsTaskSupportSpec
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskContext

/** Exposes the RN completion contract in the same TurboModule bridge as the
 * other core lifecycle modules. It never owns a world/planning request. */
class ShineWordHeadlessJsTaskSupportModule(context: ReactApplicationContext) : NativeHeadlessJsTaskSupportSpec(context) {
  companion object { const val NAME = "HeadlessJsTaskSupport" }

  override fun notifyTaskFinished(taskIdDouble: Double) {
    UiThreadUtil.runOnUiThread {
      val tasks = HeadlessJsTaskContext.getInstance(reactApplicationContext)
      val id = taskIdDouble.toInt()
      if (tasks.isTaskRunning(id)) tasks.finishTask(id)
    }
  }

  override fun notifyTaskRetry(taskIdDouble: Double, promise: Promise) {
    UiThreadUtil.runOnUiThread {
      val tasks = HeadlessJsTaskContext.getInstance(reactApplicationContext)
      val id = taskIdDouble.toInt()
      promise.resolve(tasks.isTaskRunning(id) && tasks.retryTask(id))
    }
  }
}
