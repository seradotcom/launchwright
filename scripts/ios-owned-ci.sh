#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Owned CI ONLY: compile, boot, install and foreground a synthetic UIKit app
# on GitHub's disposable Apple iPhone Simulator runner. R49 adapter itself
# NEVER performs these privileged operations.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$GITHUB_ACTIONS" != "true" ]]; then
  echo "The owned iOS fixture installer only runs on a disposable GitHub Actions runner" >&2
  exit 3
fi
command -v xcrun >/dev/null
command -v xcodebuild >/dev/null
out="$PWD/evidence/ios-owned"
mkdir -p "$out"
chmod 0700 "$out"
scratch="$(mktemp -d)"
owned_boot=0
UDID=""
cleanup() {
  if [[ "$owned_boot" == "1" && -n "$UDID" ]]; then
    xcrun simctl shutdown "$UDID" >/dev/null 2>&1 || true
  fi
  rm -rf "$scratch"
}
trap cleanup EXIT
xcodebuild -version
xcrun simctl list -j devices available > "$scratch/available.json"
UDID="$(python3 - "$scratch/available.json" <<'PY'
import json,re,sys
devices=json.load(open(sys.argv[1]))['devices']
options=[]
for runtime,items in devices.items():
 if not re.fullmatch(r'com\.apple\.CoreSimulator\.SimRuntime\.iOS-[0-9]+(?:-[0-9]+)*',runtime):
  continue
 for row in items:
  if row.get('state') not in ('Shutdown','Booted') or row.get('isAvailable') is False:
   continue
  if not row.get('deviceTypeIdentifier','').startswith('com.apple.CoreSimulator.SimDeviceType.iPhone-'):
   continue
  options.append((row['state']=='Booted',tuple(int(v) for v in runtime.split('iOS-')[-1].split('-')),
    row.get('name',''),row['udid']))
if not options:
 raise SystemExit('No bootable iPhone CoreSimulator in this disposable macOS runner')
options.sort(reverse=True)
print(options[0][-1])
PY
)"
echo "Selected owned disposable iPhone CoreSimulator: $UDID"
if ! xcrun simctl list -j devices booted | python3 -c "import json,sys;d=json.load(sys.stdin)['devices'];assert any(x.get('udid')=='$UDID' and x.get('state')=='Booted' for a in d.values() for x in a)" 2>/dev/null; then
  xcrun simctl boot "$UDID"
  owned_boot=1
fi
xcrun simctl bootstatus "$UDID" -b

app="$scratch/OwnedIOSFixture.app"
mkdir -p "$app"
cp fixtures/ios-owned/Info.plist "$app/Info.plist"
plutil -lint "$app/Info.plist"
sdk="$(xcrun --sdk iphonesimulator --show-sdk-path)"
arch="$(uname -m)"
if [[ "$arch" != "arm64" && "$arch" != "x86_64" ]]; then
  echo "Unsupported simulator CI architecture" >&2
  exit 3
fi
xcrun --sdk iphonesimulator clang \
  -arch "$arch" -isysroot "$sdk" \
  -mios-simulator-version-min=16.0 -fobjc-arc \
  -framework UIKit -framework Foundation -framework CoreGraphics \
  -o "$app/OwnedIOSFixture" fixtures/ios-owned/OwnedAppDelegate.m
codesign --force --sign - --timestamp=none "$app"
xcrun simctl install "$UDID" "$app"
xcrun simctl launch "$UDID" com.launchwright.ownediosfixture
sleep 8

# Independent owned-app pixel check before the actual adapter's screenshot.
xcrun simctl io "$UDID" screenshot --type=png --mask=ignored "$out/owned-foreground.png"
read -r WIDTH HEIGHT < <(python3 - "$out/owned-foreground.png" <<'PY'
import pathlib,struct,sys
data=pathlib.Path(sys.argv[1]).read_bytes()
assert data[:8]==b'\x89PNG\r\n\x1a\n'
assert data[12:16]==b'IHDR'
width,height=struct.unpack('>II',data[16:24])
assert 240<=width<=1920 and 240<=height<=3000 and width*height<=5_000_000
print(width,height)
PY
)
echo "CoreSimulator observed screenshot pixels: $WIDTH x $HEIGHT"
node --input-type=module - "$out/owned-foreground.png" <<'NODE'
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const image=PNG.sync.read(readFileSync(process.argv[2]),{checkCRC:true});
let total=0,matches=0;
for(let y=Math.floor(image.height*.18);y<Math.floor(image.height*.82);y+=19){
  for(let x=Math.floor(image.width*.16);x<Math.floor(image.width*.84);x+=19){
    total++;
    const i=(y*image.width+x)*4,values=[18,39,59];
    if(values.every((v,k)=>Math.abs(image.data[i+k]-v)<=12))matches++;
  }
}
if(total===0||matches/total<.12)
  throw Error('The independently launched synthetic UIKit app is not visibly present in this simulator screenshot');
console.log('OWNED_UIKIT_SIMULATOR_FOREGROUND_PIXELS_OBSERVED',matches,total,image.width,image.height);
NODE

node scripts/ios-owned-smoke.mjs \
  --out-dir "$out" \
  --udid "$UDID" \
  --bundle com.launchwright.ownediosfixture \
  --width "$WIDTH" \
  --height "$HEIGHT" | tee "$out/result.json"

python3 - "$out/result.json" <<'PY'
import json,sys,pathlib,hashlib
r=json.load(open(sys.argv[1]))
assert r['schema_version']=='launchwright-r49-owned-ios-simulator-e2e/1'
assert r['owned_synthetic_ios_app'] is True
assert r['screenshot_ran_on_real_apple_coresimulator'] is True
assert r['native_evidence_technical']=='UNKNOWN'
assert r['native_evidence_admission']=='imported-declaration'
assert r['recover_exact_original_without_simulator_recapture'] is True
assert r['customer_device_or_app_accepted'] is False
assert r['driver_host_accepted'] is False
assert r['platform_publish_authority'] is False
image=pathlib.Path(sys.argv[1]).parent/r['screenshot_filename']
assert hashlib.sha256(image.read_bytes()).hexdigest()==r['screenshot_normalized_sha256']
print('R49_REAL_OWNED_CORE_SIMULATOR_IMPORTED_UNKNOWN_PASS',r['simulator_runtime'])
PY
