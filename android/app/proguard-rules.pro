# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# 난독화로 이름이 바뀐 클래스를 한 패키지로 모아 DEX를 더 줄인다 (구글 플레이 '클래스 리패키징').
# keep 규칙으로 이름을 지킨 클래스(Capacitor 플러그인, 매니페스트 컴포넌트 등)는 옮기지 않는다.
-repackageclasses
