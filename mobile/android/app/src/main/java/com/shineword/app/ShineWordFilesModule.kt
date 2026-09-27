package com.shineword.app

import android.content.Intent
import android.net.Uri
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap
import android.util.Base64

class ShineWordFilesModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val NAME = "ShineWordFiles"
    private const val REQUEST_PICK_TEXT = 48071
    private const val REQUEST_CREATE_TEXT = 48072
    private const val MAX_READ_BYTES = 64 * 1024 * 1024
  }

  private var pendingPickPromise: Promise? = null
  private var pendingCreatePromise: Promise? = null

  private val activityListener: ActivityEventListener = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: android.app.Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode == REQUEST_PICK_TEXT) {
        val promise = pendingPickPromise
        pendingPickPromise = null
        if (promise == null) return
        val uri: Uri? = data?.data
        if (uri == null || resultCode != android.app.Activity.RESULT_OK) {
          promise.resolve(null)
          return
        }
        val map = WritableNativeMap()
        map.putString("uri", uri.toString())
        val name = queryDisplayName(uri)
        map.putString("name", name)
        map.putDouble("size", (querySize(uri) ?: 0L).toDouble())
        promise.resolve(map)
        return
      }
      if (requestCode == REQUEST_CREATE_TEXT) {
        val promise = pendingCreatePromise
        pendingCreatePromise = null
        if (promise == null) return
        val uri: Uri? = data?.data
        if (uri == null || resultCode != android.app.Activity.RESULT_OK) {
          promise.resolve(null)
          return
        }
        val map = WritableNativeMap()
        map.putString("uri", uri.toString())
        promise.resolve(map)
      }
    }
  }

  init {
    reactContext.addActivityEventListener(activityListener)
  }

  override fun getName(): String = NAME

  override fun onCatalystInstanceDestroy() {
    reactApplicationContext.removeActivityEventListener(activityListener)
    pendingPickPromise = null
    pendingCreatePromise = null
  }

  @ReactMethod
  fun pickTextFile(promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "No foreground activity to host the file picker.")
      return
    }
    if (pendingPickPromise != null) {
      promise.reject("PICK_IN_PROGRESS", "A file pick is already in progress.")
      return
    }
    pendingPickPromise = promise
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      setType("text/*")
      putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("text/plain", "application/octet-stream", "application/json"))
    }
    try {
      activity.startActivityForResult(intent, REQUEST_PICK_TEXT)
    } catch (error: Throwable) {
      pendingPickPromise = null
      promise.reject("PICK_FAILED", error)
    }
  }

  /** Reads the whole document as raw bytes and returns them base64-encoded. */
  @ReactMethod
  fun readFileBase64(uriString: String, promise: Promise) {
    try {
      val uri = Uri.parse(uriString)
      val resolver = reactApplicationContext.contentResolver
      val bytes = resolver.openInputStream(uri)?.use { input ->
        val buffer = java.io.ByteArrayOutputStream()
        val chunk = ByteArray(64 * 1024)
        var total = 0
        while (true) {
          val read = input.read(chunk)
          if (read < 0) break
          total += read
          if (total > MAX_READ_BYTES) {
            throw IllegalArgumentException("File exceeds the ${MAX_READ_BYTES} byte read limit.")
          }
          buffer.write(chunk, 0, read)
        }
        buffer.toByteArray()
      } ?: throw IllegalArgumentException("Cannot open the selected document.")
      val encoded = Base64.encodeToString(bytes, Base64.NO_WRAP)
      promise.resolve(encoded)
    } catch (error: Throwable) {
      promise.reject("READ_FAILED", error)
    }
  }

  /**
   * SAF "create document" picker for exports (P2-5): the user chooses where
   * the save file lands; resolves with the target uri or null on cancel.
   */
  @ReactMethod
  fun createTextFile(defaultName: String, promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "No foreground activity to host the file picker.")
      return
    }
    if (pendingCreatePromise != null) {
      promise.reject("CREATE_IN_PROGRESS", "A file creation is already in progress.")
      return
    }
    pendingCreatePromise = promise
    val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      setType("application/json")
      putExtra(Intent.EXTRA_TITLE, defaultName)
    }
    try {
      activity.startActivityForResult(intent, REQUEST_CREATE_TEXT)
    } catch (error: Throwable) {
      pendingCreatePromise = null
      promise.reject("CREATE_FAILED", error)
    }
  }

  /** Writes base64-decoded bytes to a document uri (truncate + overwrite). */
  @ReactMethod
  fun writeFileBase64(uriString: String, base64Data: String, promise: Promise) {
    try {
      val uri = Uri.parse(uriString)
      val bytes = Base64.decode(base64Data, Base64.NO_WRAP)
      reactApplicationContext.contentResolver.openOutputStream(uri, "wt")?.use { output ->
        output.write(bytes)
        output.flush()
      } ?: throw IllegalArgumentException("Cannot open the target document for writing.")
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject("WRITE_FAILED", error)
    }
  }

  private fun queryDisplayName(uri: Uri): String? {
    return try {
      reactApplicationContext.contentResolver.query(
        uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null,
      )?.use { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0) else null
      }
    } catch (_: Throwable) {
      null
    }
  }

  private fun querySize(uri: Uri): Long? {
    return try {
      reactApplicationContext.contentResolver.query(
        uri, arrayOf(android.provider.OpenableColumns.SIZE), null, null, null,
      )?.use { cursor ->
        if (cursor.moveToFirst() && !cursor.isNull(0)) cursor.getLong(0) else null
      }
    } catch (_: Throwable) {
      null
    }
  }
}
