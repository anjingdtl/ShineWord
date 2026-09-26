package com.shineword.app

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.MessageDigest
import java.security.SecureRandom

class ShineWordCryptoModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private val secureRandom = SecureRandom()

  override fun getName(): String = "ShineWordCrypto"

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun nextByte(): Int = secureRandom.nextInt(256)

  @ReactMethod
  fun sha256Hex(input: String, promise: Promise) {
    try {
      val digest = MessageDigest.getInstance("SHA-256")
        .digest(input.toByteArray(Charsets.UTF_8))
      promise.resolve(digest.joinToString("") { "%02x".format(it) })
    } catch (error: Throwable) {
      promise.reject("SHA256_FAILED", error)
    }
  }
}
