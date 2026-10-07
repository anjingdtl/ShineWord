package com.shineword.qa.input;

import android.app.Instrumentation;
import android.app.UiAutomation;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.os.Bundle;
import android.util.Base64;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import java.nio.charset.StandardCharsets;

public class TextInput extends Instrumentation {
  private Bundle arguments;
  @Override public void onCreate(Bundle args) { arguments = args; start(); }
  private AccessibilityNodeInfo find(AccessibilityNodeInfo node) {
    if (node == null) return null;
    if ("com.shineword.app".contentEquals(node.getPackageName() == null ? "" : node.getPackageName())
        && "android.widget.EditText".contentEquals(node.getClassName() == null ? "" : node.getClassName())
        && node.isFocused() && node.isEnabled() && !node.isPassword()) return node;
    for (int i = 0; i < node.getChildCount(); i++) {
      AccessibilityNodeInfo found = find(node.getChild(i));
      if (found != null) return found;
    }
    return null;
  }
  @Override public void onStart() {
    Bundle result = new Bundle();
    try {
      String text = "true".equals(arguments.getString("clear")) ? ""
        : new String(Base64.decode(arguments.getString("textBase64"), Base64.DEFAULT), StandardCharsets.UTF_8);
      UiAutomation ui = getUiAutomation();
      AccessibilityServiceInfo info = ui.getServiceInfo();
      info.flags |= AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;
      ui.setServiceInfo(info);
      AccessibilityNodeInfo target = find(ui.getRootInActiveWindow());
      if (target == null) for (AccessibilityWindowInfo window : ui.getWindows()) {
        target = find(window.getRoot());
        if (target != null) break;
      }
      if (target == null) throw new IllegalStateException("No focused non-password ShineWord text field");
      Bundle input = new Bundle();
      input.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
      if (!target.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, input)) throw new IllegalStateException("Accessibility text action refused");
      try { Thread.sleep(250); } catch (InterruptedException ignored) {}
      target.refresh();
      // Android exposes the placeholder as getText() after an empty edit.
      boolean matches = text.isEmpty()
        ? target.getText() == null || target.getText().length() == 0 || target.isShowingHintText()
        : text.contentEquals(target.getText() == null ? "" : target.getText());
      result.putBoolean("textMatches", matches);
      if (!matches) throw new IllegalStateException("UI text did not match");
      finish(0, result);
    } catch (Exception error) {
      result.putString("error", error.getClass().getSimpleName() + ": " + error.getMessage());
      finish(1, result);
    }
  }
}
