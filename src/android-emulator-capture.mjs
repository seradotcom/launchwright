// SPDX-License-Identifier: AGPL-3.0-only
// R48: bounded read-only ADB observation of an operator-owned Android emulator.
// Never connect to physical/wireless devices, install or launch applications,
// execute arbitrary shell commands, grant Driver Host or Platform authority.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, openSync, closeSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { TextDecoder } from 'node:util';
import { PNG } from 'pngjs';
import { requireCondition as ensure, validateValue, NativeError } from '@semwright/native-sdk';
import { digest } from './base.mjs';
import { execute } from './application.mjs';

export const ANDROID_EMULATOR_SCHEMA='launchwright-android-emulator-observation/1';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
const serialOk=v=>typeof v==='string'&&/^emulator-[0-9]{4,5}$/u.test(v);
const packageOk=v=>typeof v==='string'&&v.length<=160&&
  /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*){1,12}$/u.test(v);
const utf8=new TextDecoder('utf-8',{fatal:true});
const encoded=bytes=>{
  try{return utf8.decode(bytes);}catch{throw new NativeError('InvalidArgument','ADB reply contains invalid UTF-8');}
};
export function runLocalAdb(args,{limit=262144,timeout=12000}={}){
  const result=spawnSync('adb',args,{
    encoding:null,timeout,maxBuffer:limit+8192,
    shell:false,env:{...process.env,ADB_TRACE:'',ANDROID_SERIAL:''}
  });
  if(result.error||result.status!==0||!Buffer.isBuffer(result.stdout)||
    result.stdout.length>limit)
    throw new NativeError('Unavailable','Bounded local Android emulator ADB request failed');
  return result.stdout;
}
function read(runner,serial,args,{limit=262144}={}){
  const bytes=runner(['-s',serial,...args],{limit,timeout:12000});
  ensure(Buffer.isBuffer(bytes)&&bytes.length<=limit,
    'Android runner returned nonbinary or oversized data','ProtocolMismatch');
  return bytes;
}
function text(runner,serial,args,max=8192){
  const value=encoded(read(runner,serial,args,{limit:max})).trim();
  ensure(value.length>0&&Buffer.byteLength(value)<=max,
    'Android emulator response is absent or oversized','InvalidArgument');
  return value;
}
function appPackage(packageName){
  ensure(packageOk(packageName),'Android package must be a bounded Java package identifier','InvalidArgument');
  return packageName;
}
function emulatorIdentity(runner,serial,packageName){
  ensure(serialOk(serial),'Only a local emulator-PORT device is accepted; physical and wireless devices are forbidden','PermissionDenied');
  ensure(text(runner,serial,['get-state'],64)==='device',
    'Android emulator is not connected and ready','Unavailable');
  ensure(text(runner,serial,['shell','getprop','ro.kernel.qemu'],16)==='1',
    'The selected ADB transport is not a proven Android emulator','PermissionDenied');
  const fingerprint=text(runner,serial,['shell','getprop','ro.build.fingerprint'],512);
  ensure(!/[\r\n\x00-\x1f\x7f]/u.test(fingerprint),
    'Android emulator fingerprint contains unsupported controls');
  const sdk=Number(text(runner,serial,['shell','getprop','ro.build.version.sdk'],16));
  ensure(Number.isSafeInteger(sdk)&&sdk>=24&&sdk<=40,
    'Android emulator SDK is outside the declared 24–40 test range','InvalidArgument');
  const paths=text(runner,serial,['shell','pm','path',packageName],4096);
  const split=paths.split(/\r?\n/u);
  ensure(split.length>=1&&split.length<=20&&split.every(line=>
    /^package:\/[A-Za-z0-9_./=+~-]+\.apk$/u.test(line))&&
    new Set(split).size===split.length,
    'ADB reports no bounded installed APK paths for the selected package','InvalidArgument');
  const rawSize=text(runner,serial,['shell','wm','size'],512);
  const resolutions=[...rawSize.matchAll(/(?:Physical|Override) size:\s*(\d+)x(\d+)/gu)];
  ensure(resolutions.length>=1&&resolutions.length<=2,
    'Android emulator screen size could not be confirmed','InvalidArgument');
  const chosen=resolutions.at(-1);
  const width=Number(chosen[1]),height=Number(chosen[2]);
  ensure(Number.isSafeInteger(width)&&Number.isSafeInteger(height)&&
    width>=240&&width<=1440&&height>=240&&height<=2560&&
    width*height<=3500000,
    'Android screenshot pixels exceed safe observable-device budget','ResourceExhausted');
  return{
    serial,sdk,width,height,package_name:packageName,
    fingerprint_sha256:sha(Buffer.from(fingerprint)),
    installed_package_paths_sha256:sha(Buffer.from(split.join('\n'))),
    apk_content_hash_verified:false,
    build_label_observed_on_device:false,
    emulator_read_only_observation:true
  };
}
export function inspectLocalAndroidEmulator({serial,package_name},runner=runLocalAdb){
  return emulatorIdentity(runner,serial,appPackage(package_name));
}
function sourceBindings(app,{release_id,target_id,source_id,package_name,rights}){
  app.allow('edit');
  appPackage(package_name);
  ensure(['owned','licensed'].includes(rights),
    'Operator must declare owned or licensed Android source pixels','InvalidArgument');
  const release=app.get(release_id,'release');
  const target=app.get(target_id,'target');
  const source=app.get(source_id,'source');
  ensure(source.data.type==='mobile-import'&&
    source.data.approval==='approved'&&source.data.purpose&&
    source.data.locator==='android-emulator:'+package_name&&
    source.data.product_id===release.data.product_id&&
    source.data.build===release.data.build&&
    target.data.release_id===release.id,
    'Android source, target and release require matching approved operator boundaries','PermissionDenied');
  return{release,target,source};
}
export function planAndroidEmulatorCapture(app,input,runner=runLocalAdb){
  validateValue(input);
  ensure(input&&typeof input==='object'&&!Array.isArray(input)&&
    Object.keys(input).sort().join(',')===
      ['acknowledge_emulator_only','acknowledge_imported_unknown',
       'package_name','release_id','rights','serial','source_id','target_id'].sort().join(','),
    'Android emulator plan requires exact source/rights/consent context','InvalidArgument');
  ensure(input.acknowledge_emulator_only===true&&
    input.acknowledge_imported_unknown===true,
    'Operator must acknowledge emulator-only and imported UNKNOWN evidence','ConsentRequired');
  const {release,target,source}=sourceBindings(app,input);
  const observed=emulatorIdentity(runner,input.serial,input.package_name);
  ensure(target.data.viewport.width===observed.width&&
    target.data.viewport.height===observed.height,
    'Android emulator display size and selected target viewport differ','Conflict');
  const core={
    schema_version:ANDROID_EMULATOR_SCHEMA,
    release_id:release.id,release_version:release.version,
    source_id:source.id,source_version:source.version,
    target_id:target.id,target_version:target.version,
    release_build_label:release.data.build,
    rights:input.rights,
    emulator:observed,
    source_approval:'operator-declaration',
    privacy_pixels_independently_reviewed:false,
    apk_content_hash_verified:false,android_driver_host_admission:false,
    source_build_verified_on_device:false,
    technical_state:'UNKNOWN',classification:'imported',
    native_authority:false,platform_authority:false,
    physical_device_touched:false,app_launched:false,
    third_party_network_access_performed:false,
    acknowledge_emulator_only:true,acknowledge_imported_unknown:true
  };
  return{...core,plan_sha256:digest('android-emulator-observation',core)};
}
export function verifyAndroidEmulatorCapture(app,plan,runner=runLocalAdb){
  validateValue(plan);
  ensure(plan&&typeof plan==='object'&&!Array.isArray(plan),
    'Android capture plan must be a saved exact JSON object','InvalidArgument');
  const {plan_sha256,...core}=plan;
  ensure(hex(plan_sha256)&&digest('android-emulator-observation',core)===plan_sha256,
    'Saved Android emulator plan differs from its byte-bound digest','Conflict');
  const expected=planAndroidEmulatorCapture(app,{
    release_id:core.release_id,source_id:core.source_id,target_id:core.target_id,
    rights:core.rights,serial:core.emulator?.serial,
    package_name:core.emulator?.package_name,
    acknowledge_emulator_only:core.acknowledge_emulator_only,
    acknowledge_imported_unknown:core.acknowledge_imported_unknown
  },runner);
  ensure(JSON.stringify(expected)===JSON.stringify(plan),
    'Android device, installed package, target, source or build identity changed','StaleReference');
  return plan;
}
function foregroundPackage(runner,identity){
  // Android may change foreground activity during a screenshot. Require the
  // exact selected package in a focused/resumed activity marker.
  const output=text(runner,identity.serial,['shell','dumpsys','activity','activities'],262144);
  const lines=output.split(/\r?\n/u).filter(line=>
    /(?:topResumedActivity|mResumedActivity|mCurrentFocus|mFocusedApp)/u.test(line));
  ensure(lines.length>0&&lines.length<=32,
    'Android foreground activity cannot be unambiguously observed','Conflict');
  const matched=lines.some(line=>{
    const needle=identity.package_name+'/';
    return line.includes(needle)&&/^\s*(?:topResumedActivity|mResumedActivity|mCurrentFocus|mFocusedApp)\s*[:=]/u.test(line);
  });
  ensure(matched,
    'Android screenshot foreground is not the independently selected installed package','PermissionDenied');
  return sha(Buffer.from(lines.join('\n')));
}
function normalizedScreenshot(runner,identity){
  const raw=read(runner,identity.serial,['exec-out','screencap','-p'],{limit:3*1024*1024});
  ensure(raw.length>=33&&raw.subarray(0,8).equals(
    Buffer.from([137,80,78,71,13,10,26,10]))&&raw.subarray(12,16).toString()==='IHDR',
    'ADB did not return a valid PNG screenshot','InvalidArgument');
  ensure(raw.readUInt32BE(16)===identity.width&&
    raw.readUInt32BE(20)===identity.height,
    'Screenshot dimensions changed relative to reviewed emulator display','Conflict');
  let image;
  try{image=PNG.sync.read(raw,{checkCRC:true});}
  catch{throw new NativeError('InvalidArgument','Android screenshot PNG could not be decoded safely');}
  ensure(image.width===identity.width&&image.height===identity.height&&
    image.data.length===identity.width*identity.height*4,
    'Android screenshot decoded to unexpected pixels','Conflict');
  const normalized=PNG.sync.write({width:image.width,height:image.height,
    data:Buffer.from(image.data)},{colorType:6,inputColorType:6});
  ensure(normalized.length<=3*1024*1024,
    'Normalized private Android screenshot exceeds output budget','ResourceExhausted');
  return{png:normalized,original_png_sha256:sha(raw),
    normalized_png_sha256:sha(normalized)};
}
function privateDir(dir){
  ensure(typeof dir==='string'&&isAbsolute(dir)&&dir.length<=2048,
    'Android capture must use an existing absolute private output directory','InvalidArgument');
  const stat=lstatSync(dir);
  ensure(stat.isDirectory()&&!stat.isSymbolicLink()&&
    (process.platform==='win32'||(stat.mode&0o077)===0),
    'Android screenshot destination must be a private 0700 directory','PermissionDenied');
  return dir;
}
export async function captureAndroidEmulator(app,plan,dir,{
  confirm_plan_sha256,confirm_package,confirm_build_label,
  acknowledge_capture_current_screen=false,
  acknowledge_pixel_privacy_unverified=false
}={},runner=runLocalAdb){
  verifyAndroidEmulatorCapture(app,plan,runner);
  ensure(confirm_plan_sha256===plan.plan_sha256&&
    confirm_package===plan.emulator.package_name&&
    confirm_build_label===plan.release_build_label&&
    acknowledge_capture_current_screen===true&&
    acknowledge_pixel_privacy_unverified===true,
    'Operator must confirm the exact plan/package/build and screenshot privacy uncertainty','ConsentRequired');
  privateDir(dir);
  const basename='launchwright-android-'+plan.plan_sha256.slice(0,12);
  const imagePath=join(dir,basename+'.png'),
    receiptPath=join(dir,basename+'.receipt.json'),
    lockPath=join(app.store.root,'.android-emulator-capture.lock');
  let lock;
  try{lock=openSync(lockPath,'wx',0o600);}
  catch{throw new NativeError('Conflict','Another Android capture runs or its stale lock requires operator review');}
  try{
    let receipt=null,performedCapture=false;
    if(existsSync(receiptPath)){
      const stat=lstatSync(receiptPath);
      ensure(stat.isFile()&&!stat.isSymbolicLink()&&
        (process.platform==='win32'||(stat.mode&0o077)===0)&&
        stat.size<8192,
        'Saved Android capture receipt is unsafe or oversized','Conflict');
      try{receipt=JSON.parse(readFileSync(receiptPath,'utf8'));}
      catch{throw new NativeError('Conflict','Saved Android capture receipt is invalid JSON');}
      const {receipt_sha256,...receiptCore}=receipt;
      ensure(hex(receipt_sha256)&&
        digest('android-emulator-capture-receipt',receiptCore)===receipt_sha256&&
        receipt.schema_version==='launchwright-android-emulator-capture-receipt/1'&&
        receipt.plan_sha256===plan.plan_sha256&&
        receipt.source_id===plan.source_id&&
        receipt.target_id===plan.target_id&&
        receipt.release_id===plan.release_id&&
        receipt.release_build_label===plan.release_build_label&&
        receipt.package_name===plan.emulator.package_name&&
        receipt.emulator_fingerprint_sha256===plan.emulator.fingerprint_sha256&&
        receipt.width===plan.emulator.width&&receipt.height===plan.emulator.height&&
        receipt.rights===plan.rights&&
        hex(receipt.normalized_png_sha256)&&
        hex(receipt.original_png_sha256)&&hex(receipt.foreground_digest)&&
        hex(receipt.origin_digest)&&
        receipt.origin_digest===digest('android-emulator-captured-pixels/1',{
          plan_sha256:plan.plan_sha256,
          normalized_png_sha256:receipt.normalized_png_sha256,
          foreground_digest:receipt.foreground_digest
        })&&
        receipt.technical_state==='UNKNOWN'&&
        receipt.classification==='imported'&&
        receipt.privacy_pixels_independently_reviewed===false&&
        receipt.installed_apk_hash_verified===false&&
        receipt.source_build_verified_on_device===false&&
        receipt.native_driver_host_admitted===false&&
        receipt.platform_authority===false&&
        receipt.physical_device_touched===false&&
        receipt.app_launched===false&&
        receipt.third_party_network_access_performed===false,
        'Android capture receipt does not bind the same exact source, pixels or original intent',
        'Conflict');
      ensure(existsSync(imagePath),'Saved receipt has no matching screenshot','Conflict');
      const imageStat=lstatSync(imagePath);
      ensure(imageStat.isFile()&&!imageStat.isSymbolicLink()&&
        (process.platform==='win32'||(imageStat.mode&0o077)===0)&&
        imageStat.size<=3*1024*1024&&
        sha(readFileSync(imagePath))===receipt.normalized_png_sha256,
        'Private screenshot was edited or no longer matches its saved receipt','Conflict');
    }else{
      ensure(!existsSync(imagePath),
        'A screenshot exists without an exact receipt; operator reconciliation required before recapture','Conflict');
      const before=foregroundPackage(runner,plan.emulator);
      const image=normalizedScreenshot(runner,plan.emulator);
      const after=foregroundPackage(runner,plan.emulator);
      ensure(before===after,
        'Foreground activity drifted while capturing the Android screenshot','Conflict');
      const origin=digest('android-emulator-captured-pixels/1',{
        plan_sha256:plan.plan_sha256,
        normalized_png_sha256:image.normalized_png_sha256,
        foreground_digest:after
      });
      receipt={
        schema_version:'launchwright-android-emulator-capture-receipt/1',
        plan_sha256:plan.plan_sha256,
        source_id:plan.source_id,release_id:plan.release_id,
        target_id:plan.target_id,release_build_label:plan.release_build_label,
        package_name:plan.emulator.package_name,
        emulator_fingerprint_sha256:plan.emulator.fingerprint_sha256,
        foreground_digest:after,
        original_png_sha256:image.original_png_sha256,
        normalized_png_sha256:image.normalized_png_sha256,
        width:plan.emulator.width,height:plan.emulator.height,
        origin_digest:origin,rights:plan.rights,
        classification:'imported',technical_state:'UNKNOWN',
        privacy_pixels_independently_reviewed:false,
        installed_apk_hash_verified:false,source_build_verified_on_device:false,
        native_driver_host_admitted:false,platform_authority:false,
        physical_device_touched:false,app_launched:false,
        third_party_network_access_performed:false
      };
      receipt.receipt_sha256=digest('android-emulator-capture-receipt',receipt);
      writeFileSync(imagePath,image.png,{mode:0o600,flag:'wx'});
      writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n',
        {mode:0o600,flag:'wx'});
      performedCapture=true;
    }
    const matched=app.list('evidence',plan.release_id).filter(row=>
      row.data.origin_digest===receipt.origin_digest);
    ensure(matched.length<=1,'Android screenshot has ambiguous previously imported receipts','Conflict');
    let evidence=matched[0];
    if(evidence)ensure(evidence.data.source_id===plan.source_id&&
      evidence.data.target_id===plan.target_id&&
      evidence.data.release_id===plan.release_id&&
      evidence.data.rights===plan.rights&&
      evidence.data.classification==='imported'&&
      evidence.data.technical==='UNKNOWN'&&
      evidence.data.host_acceptance==='NOT_ESTABLISHED',
      'Existing Android evidence has an incompatible origin or scope','Conflict');
    if(!evidence){
      evidence=(await execute(app,'evidence.import',{
        release_id:plan.release_id,source_id:plan.source_id,
        target_id:plan.target_id,
        name:'Private Android emulator screenshot',
        build:plan.release_build_label,
        classification:'imported',rights:plan.rights,
        description:'Operator-reviewed emulator-only installed app snapshot for '+
          plan.emulator.package_name+'. Screenshot source SHA-256 '+
          receipt.normalized_png_sha256+
          '; technical/privacy/Driver Host/customer/Platform authority UNKNOWN.',
        origin_digest:receipt.origin_digest
      })).entity;
    }
    return{
      schema_version:'launchwright-android-emulator-capture-result/1',
      plan_sha256:plan.plan_sha256,
      screenshot_sha256:receipt.normalized_png_sha256,
      original_screenshot_sha256:receipt.original_png_sha256,
      screenshot_filename:basename+'.png',
      receipt_filename:basename+'.receipt.json',
      evidence_id:evidence.id,
      captured_now:performedCapture,
      reconciled_from_saved_receipt:!performedCapture,
      technical_state:'UNKNOWN',
      rights_basis:'operator-declaration',
      privacy_pixels_independently_reviewed:false,
      apk_build_content_verified:false,
      driver_host_admitted:false,platform_authority:false,
      external_service_contacted:false,physical_device_touched:false,
      public_release_created:false
    };
  }finally{try{closeSync(lock);}finally{unlinkSync(lockPath);}}
}
