#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# This CI-only script compiles and installs a synthetic Android app with NO
# network permissions or user data. It is never invoked by the R48 adapter.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
test -n "$SDK" && test -d "$SDK"
test "${GITHUB_ACTIONS:-}" = "true" || {
  echo "Synthetic Android APK build is CI-runner only";exit 1;
}
PLATFORM="$SDK/platforms/android-34/android.jar"
test -f "$PLATFORM" || { echo "Android platform android-34 is not installed"; exit 1; }
TOOLS="$(find "$SDK/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
test -n "$TOOLS"
for tool in aapt d8 zipalign apksigner;do test -x "$TOOLS/$tool";done
DIR="$RUNNER_TEMP/launchwright-android-owned-apk"
mkdir -p "$DIR"/classes "$DIR"/dex
javac --release 8 -classpath "$PLATFORM" -d "$DIR/classes" \
  "$ROOT/fixtures/android-owned/src/com/launchwright/ownedfixture/MainActivity.java"
"$TOOLS/d8" --lib "$PLATFORM" --min-api 24 --output "$DIR/dex" \
  "$DIR/classes/com/launchwright/ownedfixture/MainActivity.class"
(
  cd "$DIR/dex"
  "$TOOLS/aapt" package -f \
    -M "$ROOT/fixtures/android-owned/AndroidManifest.xml" \
    -I "$PLATFORM" -F "$DIR/unsigned.apk"
  "$TOOLS/aapt" add "$DIR/unsigned.apk" classes.dex
)
"$TOOLS/zipalign" -f 4 "$DIR/unsigned.apk" "$DIR/aligned.apk"
keytool -genkeypair -v -keystore "$DIR/owned-fixture.keystore" \
  -storepass android -keypass android -alias androiddebugkey \
  -keyalg RSA -keysize 2048 -validity 1 \
  -dname "CN=Launchwright Synthetic Fixture,O=Owned CI,L=Test,C=US" >/dev/null 2>&1
"$TOOLS/apksigner" sign --ks "$DIR/owned-fixture.keystore" \
  --ks-pass pass:android --key-pass pass:android \
  --ks-key-alias androiddebugkey \
  --out "$DIR/owned-fixture.apk" "$DIR/aligned.apk"
"$TOOLS/apksigner" verify "$DIR/owned-fixture.apk"
test "$(adb -s emulator-5554 shell getprop ro.kernel.qemu | tr -d '\r')" = "1"
adb -s emulator-5554 install -r "$DIR/owned-fixture.apk"
adb -s emulator-5554 shell input keyevent KEYCODE_HOME
adb -s emulator-5554 shell am start -W \
  -n com.launchwright.ownedfixture/.MainActivity
sleep 5
adb -s emulator-5554 shell dumpsys activity activities \
  | grep -E 'topResumedActivity|mResumedActivity' | tail -3
echo "OWNED_SYNTHETIC_APK_INSTALLED_AND_FOREGROUNDED"
