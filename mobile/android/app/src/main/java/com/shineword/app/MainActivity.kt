package com.shineword.app

import android.os.Bundle
import android.content.res.Configuration
import android.view.ViewTreeObserver
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {
  override fun getMainComponentName(): String = "ShineWord"

  /**
   * Required by react-native-screens (used by @react-navigation/native-stack):
   * passing `null` stops Android from restoring the native fragment state on
   * its own, which otherwise races with the navigator and crashes on reload.
   */
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    val refreshFontScale = {
      (reactHost?.currentReactContext?.getNativeModule("DeviceInfo") as? LifecycleEventListener)
        ?.onHostResume()
    }
    // Fabric receives fontScale during root measurement. Publish it to JS
    // after that pass, so newly measured text uses the same native scale.
    val root = reactDelegate?.reactRootView
    if (root == null) {
      refreshFontScale()
    } else {
      root.viewTreeObserver.addOnGlobalLayoutListener(object : ViewTreeObserver.OnGlobalLayoutListener {
        override fun onGlobalLayout() {
          root.viewTreeObserver.removeOnGlobalLayoutListener(this)
          refreshFontScale()
        }
      })
      root.forceLayout()
      root.requestLayout()
    }
  }

  override fun createReactActivityDelegate(): ReactActivityDelegate =
    DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
