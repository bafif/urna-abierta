#!/usr/bin/env bash
# Opens an Android emulator on this computer, with the test app reachable from its Chrome.
# The first time it downloads about 5.5 GB and accepts the licenses of the Android SDK.
#
#   deploy/android-emulator.sh              with a window
#   deploy/android-emulator.sh --headless   without a window, for automated tests
set -euo pipefail

sdk=${ANDROID_HOME:-$HOME/.local/share/urna-abierta/android-sdk}
tools_zip=commandlinetools-linux-15859902_latest.zip
image='system-images;android-35;google_apis;x86_64'
avd=urna-abierta
port=8090

export ANDROID_HOME=$sdk
export ANDROID_USER_HOME=$sdk/user
export ANDROID_AVD_HOME=$sdk/user/avd
mkdir -p "$ANDROID_AVD_HOME"

if [ ! -x "$sdk/cmdline-tools/latest/bin/sdkmanager" ]; then
  download=$(mktemp -d)
  trap 'rm -rf "$download"' EXIT
  curl -fsSL --retry 3 -o "$download/tools.zip" "https://dl.google.com/android/repository/$tools_zip"
  unzip -q "$download/tools.zip" -d "$download"
  mkdir -p "$sdk/cmdline-tools"
  mv "$download/cmdline-tools" "$sdk/cmdline-tools/latest"
fi

manager=$sdk/cmdline-tools/latest/bin/sdkmanager
if [ ! -d "$sdk/system-images/android-35/google_apis/x86_64" ]; then
  # yes dies with SIGPIPE when the licenses are done, which is not an error.
  yes | "$manager" --licenses >/dev/null || true
  "$manager" --install emulator platform-tools "$image" >/dev/null
fi

if [ ! -d "$ANDROID_AVD_HOME/$avd.avd" ]; then
  echo no | "$sdk/cmdline-tools/latest/bin/avdmanager" create avd --name "$avd" --package "$image" --device pixel_4 --force >/dev/null
  cat >> "$ANDROID_AVD_HOME/$avd.avd/config.ini" <<EOF
hw.ramSize=2048
hw.cpu.ncore=2
hw.keyboard=yes
disk.dataPartition.size=4G
EOF
fi

adb=$sdk/platform-tools/adb
window=()
if [ "${1:-}" = --headless ]; then
  window=(-no-window)
fi
log=$sdk/emulator.log
nohup "$sdk/emulator/emulator" -avd "$avd" "${window[@]}" -no-snapshot -no-audio -no-boot-anim \
  -gpu swiftshader_indirect >"$log" 2>&1 &

"$adb" wait-for-device
until [ "$("$adb" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; do
  sleep 2
done

# For the phone, localhost counts as a secure connection, so the app can work offline.
"$adb" reverse "tcp:$port" "tcp:$port" >/dev/null
echo "Emulador listo. En su Chrome, abrí http://localhost:$port"
echo "Para apagarlo: $adb emu kill"
