-keep class com.shineword.app.** { *; }
-keepclassmembers class com.shineword.app.** {
    @com.facebook.react.bridge.ReactMethod <methods>;
}
-keep class org.pgsqlite.** { *; }
-keep class com.oblador.keychain.** { *; }
-keep class com.facebook.react.module.annotations.** { *; }
-keepattributes RuntimeVisibleAnnotations,RuntimeInvisibleAnnotations,Signature
