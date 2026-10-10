// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync,mkdirSync,rmSync,chmodSync,readFileSync,
  readdirSync,writeFileSync,symlinkSync,statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { setup,baseline,update } from './helpers.mjs';
import { execute } from '../src/application.mjs';
import {
  planAndroidEmulatorCapture,verifyAndroidEmulatorCapture,
  captureAndroidEmulator
} from '../src/android-emulator-capture.mjs';

const PKG='com.launchwright.ownedfixture';
const SERIAL='emulator-5554';
const digest=data=>createHash('sha256').update(data).digest('hex');
function syntheticPng(w=480,h=800){
  const p=new PNG({width:w,height:h});
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=(y*w+x)*4;
    p.data[i]=x%160;p.data[i+1]=y%200;p.data[i+2]=67;p.data[i+3]=255;
  }
  return PNG.sync.write(p,{colorType:6,inputColorType:6});
}
class FakeAdb{
  constructor(){
    this.calls=[];
    this.package=PKG;this.qemu='1';this.sdk='35';
    this.fingerprint='synthetic/owned-emulator/test:35/ci:debug/test-keys';
    this.width=480;this.height=800;
    this.image=syntheticPng();this.focusReads=0;
    this.shiftForeground=false;this.corruptedPng=false;
    this.packagePath='package:/data/app/ownedfixture/base.apk\n';
  }
  run=(args,{limit}={})=>{
    assert.deepEqual(args.slice(0,2),['-s',SERIAL]);
    const command=args.slice(2).join(' ');
    this.calls.push(command);
    let result;
    switch(command){
      case'get-state':result='device\n';break;
      case'shell getprop ro.kernel.qemu':result=this.qemu+'\n';break;
      case'shell getprop ro.build.fingerprint':result=this.fingerprint+'\n';break;
      case'shell getprop ro.build.version.sdk':result=this.sdk+'\n';break;
      case'shell pm path '+PKG:result=this.packagePath;break;
      case'shell wm size':result='Physical size: '+this.width+'x'+this.height+'\n';break;
      case'shell dumpsys activity activities':
        this.focusReads++;
        result='topResumedActivity=ActivityRecord{123 u0 '+
          (this.shiftForeground&&this.focusReads>=2?'com.foreign.app':this.package)+
          '/.MainActivity t1}\n';
        break;
      case'exec-out screencap -p':
        result=this.corruptedPng?Buffer.from('garbage'):this.image;
        break;
      default:throw Error('Unapproved ADB command: '+command);
    }
    const bytes=Buffer.isBuffer(result)?result:Buffer.from(result);
    assert.ok(bytes.length<=(limit??262144));
    return bytes;
  };
}
async function fixture(t){
  const {app,root}=setup(t),b=await baseline(app);
  const source=(await update(app,b.source,{
    type:'mobile-import',approval:'approved',
    purpose:'Explicit owner authorization for synthetic emulator snapshot',
    locator:'android-emulator:'+PKG
  })).entity;
  const target=(await update(app,b.target,{
    viewport:{width:480,height:800,scale_milli:1000}
  })).entity;
  const output=mkdtempSync(join(tmpdir(),'launchwright-r48-output-'));
  if(process.platform!=='win32')chmodSync(output,0o700);
  t.after(()=>rmSync(output,{recursive:true,force:true,maxRetries:5,retryDelay:50}));
  const adb=new FakeAdb();
  const input={
    release_id:b.release.id,target_id:target.id,source_id:source.id,
    serial:SERIAL,package_name:PKG,rights:'owned',
    acknowledge_emulator_only:true,acknowledge_imported_unknown:true
  };
  const plan=()=>planAndroidEmulatorCapture(app,input,adb.run);
  const confirm=p=>({
    confirm_plan_sha256:p.plan_sha256,confirm_package:PKG,
    confirm_build_label:b.release.data.build,
    acknowledge_capture_current_screen:true,
    acknowledge_pixel_privacy_unverified:true
  });
  return{app,root,b,source,target,output,adb,input,plan,confirm};
}
test('R48 exact owner-scoped emulator plan performs read-only ADB metadata without source mutation',async t=>{
  const f=await fixture(t);
  const plan=f.plan();
  assert.deepEqual(plan,f.plan());
  assert.deepEqual(verifyAndroidEmulatorCapture(f.app,plan,f.adb.run),plan);
  assert.match(plan.plan_sha256,/^[a-f0-9]{64}$/);
  assert.equal(plan.emulator.serial,SERIAL);
  assert.equal(plan.emulator.sdk,35);
  assert.equal(plan.emulator.width,480);
  assert.equal(plan.emulator.apk_content_hash_verified,false);
  assert.equal(plan.source_build_verified_on_device,false);
  assert.equal(plan.technical_state,'UNKNOWN');
  assert.equal(plan.platform_authority,false);
  assert.equal(plan.privacy_pixels_independently_reviewed,false);
  assert.equal(f.app.list('evidence').length,0);
  assert.deepEqual(readdirSync(f.output),[]);
  assert.ok(f.adb.calls.every(x=>!/(install|start|input|reboot|push|pull|connect)/u.test(x)));
});
test('R48 real validated PNG captured once, metadata removed and imported via canonical Native evidence UNKNOWN',async t=>{
  const f=await fixture(t),plan=f.plan();
  const r=await captureAndroidEmulator(f.app,plan,f.output,f.confirm(plan),f.adb.run);
  assert.equal(r.captured_now,true);
  assert.equal(r.technical_state,'UNKNOWN');
  assert.equal(r.apk_build_content_verified,false);
  assert.equal(r.privacy_pixels_independently_reviewed,false);
  assert.equal(r.platform_authority,false);
  assert.equal(r.public_release_created,false);
  const bytes=readFileSync(join(f.output,r.screenshot_filename));
  const png=PNG.sync.read(bytes,{checkCRC:true});
  assert.equal(png.width,480);assert.equal(png.height,800);
  assert.equal(digest(bytes),r.screenshot_sha256);
  const receipt=JSON.parse(readFileSync(join(f.output,r.receipt_filename),'utf8'));
  assert.equal(receipt.normalized_png_sha256,r.screenshot_sha256);
  assert.equal(receipt.package_name,PKG);
  assert.equal(receipt.physical_device_touched,false);
  assert.equal(receipt.native_driver_host_admitted,false);
  const imported=f.app.get(r.evidence_id,'evidence');
  assert.equal(imported.data.classification,'imported');
  assert.equal(imported.data.technical,'UNKNOWN');
  assert.equal(imported.data.host_acceptance,'NOT_ESTABLISHED');
  assert.equal(imported.data.origin_digest,receipt.origin_digest);
  assert.equal(imported.data.source_id,f.source.id);
  assert.equal(imported.data.build,f.b.release.data.build);
  if(process.platform!=='win32'){
    assert.equal(statSync(join(f.output,r.screenshot_filename)).mode&0o077,0);
    assert.equal(statSync(join(f.output,r.receipt_filename)).mode&0o077,0);
  }
});
test('R48 receipt-based exact retry never recaptures or duplicates imported evidence',async t=>{
  const f=await fixture(t),plan=f.plan();
  const first=await captureAndroidEmulator(f.app,plan,f.output,f.confirm(plan),f.adb.run);
  const captures=f.adb.calls.filter(x=>x==='exec-out screencap -p').length;
  f.adb.image=syntheticPng(480,800);
  const second=await captureAndroidEmulator(f.app,plan,f.output,f.confirm(plan),f.adb.run);
  assert.equal(second.captured_now,false);
  assert.equal(second.reconciled_from_saved_receipt,true);
  assert.equal(second.evidence_id,first.evidence_id);
  assert.equal(f.adb.calls.filter(x=>x==='exec-out screencap -p').length,captures);
  assert.equal(f.app.list('evidence').length,1);
});
test('R48 a locally edited exact-receipt origin cannot mint a replacement Native evidence assertion',async t=>{
  const f=await fixture(t),plan=f.plan();
  const first=await captureAndroidEmulator(f.app,plan,f.output,f.confirm(plan),f.adb.run);
  const file=join(f.output,first.receipt_filename);
  const saved=JSON.parse(readFileSync(file,'utf8'));
  const original=readFileSync(file,'utf8');
  saved.origin_digest='f'.repeat(64);
  writeFileSync(file,JSON.stringify(saved,null,2)+'\\n');
  await assert.rejects(captureAndroidEmulator(f.app,plan,f.output,f.confirm(plan),f.adb.run),
    {code:'Conflict'});
  assert.equal(f.app.list('evidence').length,1);
  writeFileSync(file,original);
  const reused=await captureAndroidEmulator(f.app,plan,f.output,f.confirm(plan),f.adb.run);
  assert.equal(reused.evidence_id,first.evidence_id);
});

test('R48 after local PNG/receipt but before Native import recovery uses SAME original pixels only',async t=>{
  const f=await fixture(t),plan=f.plan();
  const original=f.app.store.transaction.bind(f.app.store);
  f.app.store.transaction=(op,...args)=>{
    if(op==='evidence.import')throw Error('Synthetic Native acknowledgement lost');
    return original(op,...args);
  };
  await assert.rejects(captureAndroidEmulator(f.app,plan,f.output,f.confirm(plan),f.adb.run),
    /Synthetic Native acknowledgement lost/u);
  assert.equal(readdirSync(f.output).length,2);
  assert.equal(f.app.list('evidence').length,0);
  f.app.store.transaction=original;
  const before=f.adb.calls.filter(x=>x==='exec-out screencap -p').length;
  const recovered=await captureAndroidEmulator(f.app,plan,f.output,f.confirm(plan),f.adb.run);
  assert.equal(recovered.captured_now,false);
  assert.equal(recovered.reconciled_from_saved_receipt,true);
  assert.equal(f.app.list('evidence').length,1);
  assert.equal(f.adb.calls.filter(x=>x==='exec-out screencap -p').length,before);
});
test('R48 physical device, TCP ADB, non-QEMU, wrong Android SDK or package mismatch fail before screencap',async t=>{
  const f=await fixture(t);
  for(const serial of ['192.168.0.2:5555','R58P5000A','emulator-5554;rm -rf /','']){
    const before=f.adb.calls.length;
    assert.throws(()=>planAndroidEmulatorCapture(f.app,{...f.input,serial},f.adb.run),
      {code:'PermissionDenied'});
    assert.equal(f.adb.calls.length,before,'Invalid physical/TCP serial must never reach adb');
  }
  f.adb.qemu='0';
  assert.throws(f.plan,{code:'PermissionDenied'});
  f.adb.qemu='1';f.adb.sdk='22';
  assert.throws(f.plan);
  f.adb.sdk='35';f.adb.packagePath='No packages found\n';
  assert.throws(f.plan);
  assert.ok(!f.adb.calls.includes('exec-out screencap -p'));
});
test('R48 operator must authorize screen capture, imported class and pixel/privacy uncertainty',async t=>{
  const f=await fixture(t),plan=f.plan();
  for(const key of ['acknowledge_emulator_only','acknowledge_imported_unknown']){
    assert.throws(()=>planAndroidEmulatorCapture(f.app,{...f.input,[key]:false},f.adb.run),
      {code:'ConsentRequired'});
  }
  for(const patch of [
    {acknowledge_capture_current_screen:false},
    {acknowledge_pixel_privacy_unverified:false},
    {confirm_plan_sha256:'a'.repeat(64)},
    {confirm_package:'com.foreign.package'},
    {confirm_build_label:'other-build'}
  ])await assert.rejects(captureAndroidEmulator(f.app,plan,f.output,{
    ...f.confirm(plan),...patch
  },f.adb.run),{code:'ConsentRequired'});
  assert.deepEqual(readdirSync(f.output),[]);
  assert.equal(f.app.list('evidence').length,0);
});
test('R48 a changed foreground or malformed image can never become a recorded capture',async t=>{
  const f=await fixture(t),plan=f.plan();
  f.adb.shiftForeground=true;
  await assert.rejects(captureAndroidEmulator(f.app,plan,f.output,f.confirm(plan),f.adb.run),
    {code:'PermissionDenied'});
  assert.deepEqual(readdirSync(f.output),[]);
  f.adb.shiftForeground=false;f.adb.focusReads=0;f.adb.corruptedPng=true;
  await assert.rejects(captureAndroidEmulator(f.app,plan,f.output,f.confirm(plan),f.adb.run));
  assert.equal(f.app.list('evidence').length,0);
});
test('R48 changed observed emulator/build/target/source invalidates saved plan before any capture',async t=>{
  const f=await fixture(t),plan=f.plan();
  const tampered={...plan,rights:'licensed'};
  assert.throws(()=>verifyAndroidEmulatorCapture(f.app,tampered,f.adb.run),{code:'Conflict'});
  f.adb.fingerprint+=':different';
  assert.throws(()=>verifyAndroidEmulatorCapture(f.app,plan,f.adb.run),{code:'StaleReference'});
  f.adb.fingerprint=f.adb.fingerprint.replace(':different','');
  await update(f.app,f.target,{viewport:{width:600,height:800,scale_milli:1000}});
  assert.throws(()=>verifyAndroidEmulatorCapture(f.app,plan,f.adb.run),{code:'Conflict'});
  assert.deepEqual(readdirSync(f.output),[]);
});
test('R48 refuses modified files, a missing receipt, symlink/public folders and stale lock instead of overwriting',async t=>{
  const f=await fixture(t),plan=f.plan();
  const first=await captureAndroidEmulator(f.app,plan,f.output,f.confirm(plan),f.adb.run);
  const pngPath=join(f.output,first.screenshot_filename);
  writeFileSync(pngPath,'human edited screenshot');
  await assert.rejects(captureAndroidEmulator(f.app,plan,f.output,f.confirm(plan),f.adb.run),
    {code:'Conflict'});
  assert.equal(readFileSync(pngPath,'utf8'),'human edited screenshot');
  if(process.platform!=='win32'){
    const exposed=join(f.root,'exposed');
    mkdirSync(exposed,{mode:0o755});chmodSync(exposed,0o755);
    await assert.rejects(captureAndroidEmulator(f.app,plan,exposed,f.confirm(plan),f.adb.run),
      {code:'PermissionDenied'});
    const link=join(f.root,'linked');
    symlinkSync(f.output,link);
    await assert.rejects(captureAndroidEmulator(f.app,plan,link,f.confirm(plan),f.adb.run),
      {code:'PermissionDenied'});
  }
  const lock=join(f.root,'.android-emulator-capture.lock');
  writeFileSync(lock,'another operator',{mode:0o600});
  await assert.rejects(captureAndroidEmulator(f.app,plan,f.output,f.confirm(plan),f.adb.run),
    {code:'Conflict'});
  assert.equal(readFileSync(lock,'utf8'),'another operator');
});
