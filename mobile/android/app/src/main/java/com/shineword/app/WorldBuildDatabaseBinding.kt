package com.shineword.app

import android.content.Context
import java.io.File

/** Database identity only. Never stores credentials, content or run results. */
object WorldBuildDatabaseBinding {
  private const val PREFERENCES = "shineword_world_build_database"
  private const val KEY = "databaseName"
  const val EXTRA = "databaseName"

  fun file(context: Context, name: String): File? {
    if (!Regex("^[A-Za-z0-9._-]+\\.db$").matches(name)) return null
    val file = context.getDatabasePath(name)
    return if (file.exists() && file.isFile && file.canonicalFile.parentFile == context.getDatabasePath("shineword.db").canonicalFile.parentFile) file else null
  }

  fun current(context: Context): String = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
    .getString(KEY, "shineword.db") ?: "shineword.db"

  fun configure(context: Context, name: String): Boolean {
    if (file(context, name) == null) return false
    return context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putString(KEY, name).commit()
  }
}
