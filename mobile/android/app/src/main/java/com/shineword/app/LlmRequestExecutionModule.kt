package com.shineword.app

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class LlmRequestExecutionModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "LlmRequestExecution"

  @ReactMethod
  fun acquire(token: String, timeoutMs: Double, promise: Promise) {
    LlmRequestExecutionService.acquire(reactApplicationContext, token, timeoutMs, promise)
  }
}
