package com.shineword.app

import android.util.Base64
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

  /**
   * SHA-256 over the RAW file bytes (P2 acceptance G06). The bytes arrive as
   * base64 from the file picker, so the digest matches any external
   * `sha256sum` of the original file - including GBK/UTF-16 sources where the
   * legacy string-roundtrip hash diverged.
   */
  @ReactMethod
  fun sha256BytesHex(base64Input: String, promise: Promise) {
    try {
      val bytes = Base64.decode(base64Input, Base64.NO_WRAP)
      val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
      promise.resolve(digest.joinToString("") { "%02x".format(it) })
    } catch (error: Throwable) {
      promise.reject("SHA256_BYTES_FAILED", error)
    }
  }
}
