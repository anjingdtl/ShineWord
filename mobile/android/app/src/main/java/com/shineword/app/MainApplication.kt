package com.shineword.app

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.shineword.app.react.CoreTurboModuleBridge

class MainApplication : Application(), ReactApplication {
  override val reactHost: ReactHost by lazy {
    val packages = PackageList(this).packages.apply {
      add(0, CoreTurboModuleBridge())
      add(ShineWordNativePackage())
    }
    getDefaultReactHost(
      context = applicationContext,
      packageList = packages,
      useDevSupport = BuildConfig.DEBUG && !BuildConfig.STANDALONE_DEBUG,
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
