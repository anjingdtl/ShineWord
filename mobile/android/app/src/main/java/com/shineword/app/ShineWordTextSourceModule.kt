package com.shineword.app

import android.net.Uri
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.Charset
import java.nio.charset.CharsetDecoder
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest

/**
 * Closeout C2: streaming TXT source staging and bounded decode.
 *
 * The pre-C2 import read the whole novel into a base64 string and passed it
 * through the bridge twice. This module instead:
 *  - streams the picked SAF document into a private staging file, hashing the
 *    raw bytes on the way (one pass, no whole-file bridge payload);
 *  - decodes bounded byte windows with multi-byte carry so the JS streaming
 *    importer never needs the full text in memory.
 *
 * JS contract:
 *   stageUri(uri, sourceKey) -> { path, byteLength, sha256 }
 *   detectEncoding(path)      -> { encoding, byteLength }
 *   readTextChunk(path, encoding, byteOffset, maxBytes)
 *                            -> { text, nextByteOffset, atEof }
 *   deleteStaged(path)       -> boolean
 */
class ShineWordTextSourceModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val NAME = "ShineWordTextSource"
    private const val COPY_BUFFER_BYTES = 128 * 1024
    private const val DEFAULT_WINDOW_BYTES = 192 * 1024
    private const val MAX_WINDOW_BYTES = 512 * 1024
    private const val ENCODING_SNIFF_BYTES = 64 * 1024
    private const val STAGED_KEEPFREE_BYTES = 32L * 1024L * 1024L
  }

  override fun getName(): String = NAME

  /** Streams the picked document into a private file + computes its SHA-256. */
  @ReactMethod
  fun stageUri(uriString: String, sourceKey: String, promise: Promise) {
    try {
      val uri = Uri.parse(uriString)
      val resolver = reactApplicationContext.contentResolver
      val dir = File(reactApplicationContext.filesDir, "sources")
      if (!dir.exists() && !dir.mkdirs()) {
        promise.reject("STAGE_FAILED", "Cannot create the private sources directory.")
        return
      }
      // Sanitize the key: it only ever names a file inside the private dir.
      val safeKey = sourceKey.replace(Regex("[^A-Za-z0-9._-]"), "_")
      val target = File(dir, "$safeKey.bin")
      val tmp = File(dir, "$safeKey.tmp")
      val digest = MessageDigest.getInstance("SHA-256")
      var total = 0L

      val fallbackFile = File(uri.path ?: "")
      val input = resolver.openInputStream(uri)
        ?: if (fallbackFile.exists() && fallbackFile.canRead()) FileInputStream(fallbackFile) else null
      if (input == null) {
        promise.reject("STAGE_FAILED", "Cannot open the selected document.")
        return
      }
      input.use { stream ->
        FileOutputStream(tmp).use { output ->
          val buffer = ByteArray(COPY_BUFFER_BYTES)
          while (true) {
            val read = stream.read(buffer)
            if (read < 0) break
            digest.update(buffer, 0, read)
            output.write(buffer, 0, read)
            total += read.toLong()
          }
          output.flush()
          output.fd.sync()
        }
      }
      if (dir.usableSpace < STAGED_KEEPFREE_BYTES) {
        tmp.delete()
        promise.reject("STAGE_FAILED", "Insufficient storage space after staging.")
        return
      }
      if (target.exists() && !target.delete()) {
        tmp.delete()
        promise.reject("STAGE_FAILED", "Cannot replace the previous staging target.")
        return
      }
      if (!tmp.renameTo(target)) {
        tmp.delete()
        promise.reject("STAGE_FAILED", "Cannot finalize the staged source file.")
        return
      }
      val map = Arguments.createMap()
      map.putString("path", target.absolutePath)
      map.putDouble("byteLength", total.toDouble())
      map.putString("sha256", hex(digest.digest()))
      promise.resolve(map)
    } catch (error: Throwable) {
      promise.reject("STAGE_FAILED", error)
    }
  }

  /** BOM + UTF-8 validity sniff, mirroring the core detectEncoding labels. */
  @ReactMethod
  fun detectEncoding(path: String, promise: Promise) {
    try {
      val file = File(path)
      if (!file.exists() || !file.canRead()) {
        promise.reject("READ_FAILED", "Staged file is missing or unreadable.")
        return
      }
      val sample = ByteArray(minOf(file.length(), ENCODING_SNIFF_BYTES.toLong()).toInt())
      RandomAccessFile(file, "r").use { raf ->
        if (sample.isNotEmpty()) {
          raf.seek(0)
          raf.readFully(sample)
        }
      }
      val encoding = sniff(sample)
      val map = Arguments.createMap()
      map.putString("encoding", encoding)
      map.putDouble("byteLength", file.length().toDouble())
      promise.resolve(map)
    } catch (error: Throwable) {
      promise.reject("READ_FAILED", error)
    }
  }

  /**
   * Decodes one byte window to text. A trailing partial multi-byte sequence is
   * excluded from the consumed range (`nextByteOffset` restarts at the
   * boundary), so sequential calls never split a character.
   */
  @ReactMethod
  fun readTextChunk(
    path: String,
    encoding: String,
    byteOffset: Double,
    maxBytes: Double,
    promise: Promise,
  ) {
    try {
      val file = File(path)
      if (!file.exists() || !file.canRead()) {
        promise.reject("READ_FAILED", "Staged file is missing or unreadable.")
        return
      }
      val charset = resolveCharset(encoding)
      val start = byteOffset.toLong().coerceAtLeast(0)
      val limit = maxBytes.toInt().coerceAtLeast(1).coerceAtMost(MAX_WINDOW_BYTES)
      val fileLen = file.length()
      if (start >= fileLen) {
        val done = Arguments.createMap()
        done.putString("text", "")
        done.putDouble("nextByteOffset", fileLen.toDouble())
        done.putBoolean("atEof", true)
        promise.resolve(done)
        return
      }
      val align = if (charset.name().contains("UTF-16")) 2 else 1
      var rawLen = minOf(limit.toLong(), fileLen - start).toInt()
      rawLen -= rawLen % align
      if (rawLen == 0) {
        promise.reject("READ_FAILED", "Remaining bytes are below one character unit.")
        return
      }
      val buffer = ByteArray(rawLen)
      RandomAccessFile(file, "r").use { raf ->
        raf.seek(start)
        raf.readFully(buffer)
      }

      val decoder: CharsetDecoder = charset.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
      val inBuf = ByteBuffer.wrap(buffer)
      val outBuf = CharBuffer.allocate(rawLen * 2)
      var consumedBytes: Int
      try {
        val result = decoder.decode(inBuf, outBuf, false)
        if (result.isUnderflow) {
          consumedBytes = rawLen - inBuf.remaining()
          if (consumedBytes == 0 && inBuf.remaining() > 0) {
            // Window smaller than one character: force forward progress.
            consumedBytes = align
          }
        } else if (result.isError) {
          // Malformed bytes mid-stream: decode permissively so one bad byte
          // cannot abort a long import; replacement chars surface in text.
          inBuf.rewind()
          outBuf.clear()
          val permissive = charset.newDecoder()
            .onMalformedInput(CodingErrorAction.REPLACE)
            .onUnmappableCharacter(CodingErrorAction.REPLACE)
          permissive.decode(inBuf, outBuf, false)
          consumedBytes = rawLen - inBuf.remaining()
        } else {
          consumedBytes = rawLen - inBuf.remaining()
        }
      } catch (error: Throwable) {
        promise.reject("DECODE_FAILED", "Decoding failed: ${error.message}")
        return
      }
      outBuf.flip()
      val text = outBuf.toString()
      val next = start + consumedBytes.toLong()
      val map = Arguments.createMap()
      map.putString("text", text)
      map.putDouble("nextByteOffset", next.toDouble())
      map.putBoolean("atEof", next >= fileLen)
      promise.resolve(map)
    } catch (error: Throwable) {
      promise.reject("DECODE_FAILED", error)
    }
  }

  /** Removes a staged file; safe to call for already-deleted paths. */
  @ReactMethod
  fun deleteStaged(path: String, promise: Promise) {
    try {
      val file = File(path)
      val removed = !file.exists() || file.delete()
      promise.resolve(removed)
    } catch (error: Throwable) {
      promise.reject("DELETE_FAILED", error)
    }
  }

  // --- helpers ---------------------------------------------------------------

  private fun sniff(header: ByteArray): String {
    if (header.size >= 3 && header[0] == 0xEF.toByte() && header[1] == 0xBB.toByte() && header[2] == 0xBF.toByte()) {
      return "utf-8-sig"
    }
    if (header.size >= 2 && header[0] == 0xFF.toByte() && header[1] == 0xFE.toByte()) return "utf-16le"
    if (header.size >= 2 && header[0] == 0xFE.toByte() && header[1] == 0xFF.toByte()) return "utf-16be"
    if (looksLikeValidUtf8(header)) return "utf-8"
    return "gbk"
  }

  private fun looksLikeValidUtf8(bytes: ByteArray): Boolean {
    val len = bytes.size
    if (len == 0) return true
    var i = 0
    while (i < len) {
      val b = bytes[i].toInt() and 0xFF
      when {
        b < 0x80 -> i += 1
        b in 0xC2..0xDF -> {
          if (i + 1 >= len) break
          if ((bytes[i + 1].toInt() and 0xC0) != 0x80) return false
          i += 2
        }
        b in 0xE0..0xEF -> {
          if (i + 2 >= len) break
          val c1 = bytes[i + 1].toInt() and 0xC0
          val c2 = bytes[i + 2].toInt() and 0xC0
          if (c1 != 0x80 || c2 != 0x80) return false
          i += 3
        }
        b in 0xF0..0xF4 -> {
          if (i + 3 >= len) break
          val c1 = bytes[i + 1].toInt() and 0xC0
          val c2 = bytes[i + 2].toInt() and 0xC0
          val c3 = bytes[i + 3].toInt() and 0xC0
          if (c1 != 0x80 || c2 != 0x80 || c3 != 0x80) return false
          i += 4
        }
        else -> return false
      }
    }
    return true
  }

  private fun resolveCharset(encoding: String): Charset {
    return when (encoding.lowercase()) {
      "utf-8", "utf8", "utf-8-sig" -> Charsets.UTF_8
      "utf-16le", "utf_16le", "utf-16-le" -> Charsets.UTF_16LE
      "utf-16be", "utf_16be", "utf-16-be" -> Charsets.UTF_16BE
      "gbk", "gb2312" -> charset("GBK")
      else -> throw IllegalArgumentException("Unsupported encoding: $encoding")
    }
  }

  private fun hex(bytes: ByteArray): String {
    val builder = StringBuilder(bytes.size * 2)
    for (byte in bytes) {
      val v = byte.toInt() and 0xFF
      builder.append("0123456789abcdef"[v ushr 4])
      builder.append("0123456789abcdef"[v and 0x0F])
    }
    return builder.toString()
  }

  // NativeEventEmitter protocol no-ops.
  @ReactMethod
  fun addListener(eventName: String) {}

  @ReactMethod
  fun removeListeners(count: Int) {}
}
