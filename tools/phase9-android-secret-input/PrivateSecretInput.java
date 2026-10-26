package com.shineword.qa.secret;

import android.app.Instrumentation;
import android.app.UiAutomation;
import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Test-only credential delivery from a one-use host-memory bridge into the
 * app's focused secure field, followed by the app's ordinary save action. */
public final class PrivateSecretInput extends Instrumentation {
  private Bundle arguments;

  @Override public void onCreate(Bundle args) { arguments = args; start(); }

  private AccessibilityNodeInfo findSecureField(AccessibilityNodeInfo node) {
    if (node == null) return null;
    String viewId = value(node.getViewIdResourceName());
    boolean isApiKeyField = "profile-apikey".equals(viewId) || viewId.endsWith(":id/profile-apikey");
    if ("com.shineword.app".contentEquals(value(node.getPackageName()))
        && "android.widget.EditText".contentEquals(value(node.getClassName()))
        && isApiKeyField
        && node.isPassword() && node.isEnabled()) return node;
    for (int i = 0; i < node.getChildCount(); i++) {
      AccessibilityNodeInfo found = findSecureField(node.getChild(i));
      if (found != null) return found;
    }
    return null;
  }

  private AccessibilityNodeInfo findSaveButton(AccessibilityNodeInfo node) {
    if (node == null) return null;
    if ("com.shineword.app".contentEquals(value(node.getPackageName())) && node.isClickable()) {
      // FirstRunScreen submits "<save and enter shelf>"; the settings screen uses "<save>".
      // Both labels start with the same two CJK code points, so prefix-match covers both.
      CharSequence text = node.getText();
      CharSequence description = node.getContentDescription();
      if (startsWithSave(text) || startsWithSave(description)) return node;
    }
    for (int i = 0; i < node.getChildCount(); i++) {
      AccessibilityNodeInfo found = findSaveButton(node.getChild(i));
      if (found != null) return found;
    }
    return null;
  }

  private boolean hasSavedNotice(AccessibilityNodeInfo node) {
    if (node == null) return false;
    if ("com.shineword.app".contentEquals(value(node.getPackageName()))) {
      CharSequence text = node.getText();
      if (text != null && text.toString().contains("\u5df2\u4fdd\u5b58")) return true;
    }
    for (int i = 0; i < node.getChildCount(); i++) if (hasSavedNotice(node.getChild(i))) return true;
    return false;
  }

  private static String value(CharSequence value) { return value == null ? "" : value.toString(); }

  private static boolean startsWithSave(CharSequence label) {
    String trimmed = (label == null ? "" : label.toString()).trim();
    return trimmed.startsWith("\u4fdd\u5b58");
  }

  private AccessibilityNodeInfo findInAppWindows(UiAutomation ui, boolean saveButton) {
    AccessibilityNodeInfo root = ui.getRootInActiveWindow();
    AccessibilityNodeInfo found = saveButton ? findSaveButton(root) : findSecureField(root);
    if (found != null) return found;
    for (AccessibilityWindowInfo window : ui.getWindows()) {
      root = window.getRoot();
      found = saveButton ? findSaveButton(root) : findSecureField(root);
      if (found != null) return found;
    }
    return null;
  }

  private String fetchSecret(String bridgeUrl, String token) throws Exception {
    HttpURLConnection connection = (HttpURLConnection) new URL(bridgeUrl).openConnection();
    connection.setRequestMethod("GET");
    connection.setConnectTimeout(5000);
    connection.setReadTimeout(5000);
    connection.setRequestProperty("X-QA-One-Time-Token", token);
    try {
      if (connection.getResponseCode() != 200) throw new IllegalStateException("bridge_refused");
      InputStream input = connection.getInputStream();
      ByteArrayOutputStream output = new ByteArrayOutputStream();
      byte[] buffer = new byte[256];
      int read;
      while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
      input.close();
      byte[] bytes = output.toByteArray();
      String secret = new String(bytes, StandardCharsets.UTF_8);
      java.util.Arrays.fill(bytes, (byte) 0);
      java.util.Arrays.fill(buffer, (byte) 0);
      return secret;
    } finally {
      connection.disconnect();
    }
  }

  @Override public void onStart() {
    Bundle result = new Bundle();
    try {
      UiAutomation ui = getUiAutomation();
      AccessibilityServiceInfo info = ui.getServiceInfo();
      info.flags |= AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;
      ui.setServiceInfo(info);
      if ("true".equals(arguments.getString("preflight"))) {
        boolean fieldFound = findInAppWindows(ui, false) != null;
        boolean saveFound = findInAppWindows(ui, true) != null;
        if (!fieldFound || !saveFound) throw new IllegalStateException("secure_form_preflight_failed");
        result.putBoolean("secureFieldFound", true);
        result.putBoolean("saveActionFound", true);
        finish(0, result);
        return;
      }
      String bridgeUrl = arguments.getString("bridgeUrl");
      String token = arguments.getString("token");
      if (bridgeUrl == null || token == null || token.length() < 32) throw new IllegalStateException("bridge_configuration_invalid");
      String secret = fetchSecret(bridgeUrl, token);
      if (secret.trim().isEmpty()) throw new IllegalStateException("bridge_empty_secret");

      AccessibilityNodeInfo field = findInAppWindows(ui, false);
      if (field == null) throw new IllegalStateException("secure_field_unavailable");
      field.performAction(AccessibilityNodeInfo.ACTION_CLICK);
      SystemClock.sleep(200);
      Bundle input = new Bundle();
      input.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, secret);
      boolean set = field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, input);
      input.clear();
      secret = null;
      field = null;
      if (!set) throw new IllegalStateException("secure_field_rejected_input");

      boolean keyboardVisible = false;
      for (AccessibilityWindowInfo window : ui.getWindows()) {
        if (window.getType() == AccessibilityWindowInfo.TYPE_INPUT_METHOD) { keyboardVisible = true; break; }
      }
      if (keyboardVisible) ui.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK);
      SystemClock.sleep(250);
      AccessibilityNodeInfo save = findInAppWindows(ui, true);
      if (save == null || !save.performAction(AccessibilityNodeInfo.ACTION_CLICK)) throw new IllegalStateException("save_action_unavailable");

      boolean saved = false;
      for (int i = 0; i < 60; i++) {
        SystemClock.sleep(250);
        for (AccessibilityWindowInfo window : ui.getWindows()) {
          if (hasSavedNotice(window.getRoot())) { saved = true; break; }
        }
        if (saved) break;
      }
      if (!saved) throw new IllegalStateException("save_confirmation_unavailable");
      result.putBoolean("credentialSaved", true);
      finish(0, result);
    } catch (Exception error) {
      // Never include exception messages, view text, or credential data.
      result.putString("error", error.getClass().getSimpleName());
      finish(1, result);
    }
  }
}
