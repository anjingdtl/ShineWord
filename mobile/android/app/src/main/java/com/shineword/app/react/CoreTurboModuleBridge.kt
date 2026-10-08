package com.shineword.app.react

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.modules.core.ExceptionsManagerModule
import com.facebook.react.modules.debug.SourceCodeModule
import com.facebook.react.modules.systeminfo.AndroidInfoModule
import com.facebook.react.uimanager.ViewManager

class CoreTurboModuleBridge : BaseReactPackage() {
  companion object {
    private val CORE_MODULES: List<Triple<String, Class<out NativeModule>, Boolean>> = listOf(
      Triple(AndroidInfoModule.NAME, AndroidInfoModule::class.java, true),
      Triple(SourceCodeModule.NAME, SourceCodeModule::class.java, true),
      Triple(DeviceEventManagerModule.NAME, DeviceEventManagerModule::class.java, true),
      Triple(ExceptionsManagerModule.NAME, ExceptionsManagerModule::class.java, true),
      Triple(ShineWordHeadlessJsTaskSupportModule.NAME, ShineWordHeadlessJsTaskSupportModule::class.java, true),
    )
  }

  override fun getModule(
    name: String,
    reactContext: ReactApplicationContext,
  ): NativeModule? {
    val entry = CORE_MODULES.firstOrNull { it.first == name } ?: return null
    return try {
      val ctor = entry.second.getDeclaredConstructor(ReactApplicationContext::class.java)
      ctor.newInstance(reactContext)
    } catch (_: Throwable) {
      null
    }
  }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
    val map = mutableMapOf<String, ReactModuleInfo>()
    for ((name, clazz, isTurbo) in CORE_MODULES) {
      map[name] = ReactModuleInfo(
        name,
        clazz.name,
        false,
        false,
        false,
        isTurbo,
      )
    }
    return ReactModuleInfoProvider { map }
  }

  override fun createViewManagers(
    reactContext: ReactApplicationContext,
  ): List<ViewManager<in Nothing, in Nothing>> = emptyList()
}
