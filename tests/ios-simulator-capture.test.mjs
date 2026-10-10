// SPDX-License-Identifier: AGPL-3.0-only
// R49 official Native SDK domain + fixed simctl IPC; the runner is synthetic
// in Node24 three-OS checks. The macOS lane exercises real CoreSimulator.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync,chmodSync,mkdtempSync,rmSync,readFileSync,
  writeFileSync,statSync,readdirSync,symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { setup,baseline,update } from './helpers.mjs';
import { execute } from '../src/application.mjs';
import {
  inspectIOSSimulator,planIOSSimulator,verifyIOSSimulator,
  captureIOSSimulator
} from '../src/ios-simulator-capture.mjs';

const UDID='91D14029-9201-43F5-92ED-A8422804D0CE';
const BUNDLE='com.launchwright.ownediosfixture';
const RUNTIME='com.apple.CoreSimulator.SimRuntime.iOS-18-5';
const hash=x=>createHash('sha256').update(x).digest('hex');
function screenshot(width=480,height=800){
  const p=new PNG({width,height});
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4;
    p.data[i]=x%200;p.data[i+1]=y%170;p.data[i+2]=82;p.data[i+3]=255;
  }
  return PNG.sync.write(p,{colorType:6,inputColorType:6});
}
class FakeSimctl{
  constructor(){
    this.calls=[];this.status='Booted';this.isAvailable=true;
    this.runtime=RUNTIME;this.udid=UDID;this.container=
      '/Users/runner/Library/Developer/CoreSimulator/Devices/'+UDID+
      '/data/Containers/Bundle/Application/ABC/OwnedFixture.app';
    this.width=480;this.height=800;this.png=screenshot();
    this.corrupt=false;this.skipWrite=false;this.appInstalled=true;
  }
  run=(args,{limit}={})=>{
    this.calls.push([...args]);
    const command=args.join(' ');
    let content;
    if(command==='list -j devices booted'){
      content=JSON.stringify({devices:{[this.runtime]:[{
        state:this.status,udid:this.udid,name:'iPhone 16 Pro',
        deviceTypeIdentifier:'com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro',
        isAvailable:this.isAvailable
      }]}});
    }else if(command==='get_app_container '+UDID+' '+BUNDLE+' app'){
      if(!this.appInstalled)throw Error('Owned app is not installed');
      content=this.container+'\n';
    }else if(command.startsWith('io '+UDID+' screenshot --type=png --mask=ignored ')){
      const file=args[args.length-1];
      if(!this.skipWrite)writeFileSync(file,this.corrupt?Buffer.from('garbage'):this.png);
      content='';
    }else throw Error('Forbidden simctl invocation: '+command);
    const bytes=Buffer.from(content);
    assert.ok(bytes.length<=(limit??1024*1024));
    return bytes;
  };
  captured(){return this.calls.filter(x=>x[0]==='io').length;}
}
async function fixture(t){
  const {app,root}=setup(t),b=await baseline(app);
  const source=(await update(app,b.source,{
    type:'mobile-import',approval:'approved',
    purpose:'Operator-owned synthetic CoreSimulator fixture',
    locator:'ios-simulator:'+BUNDLE
  })).entity;
  const target=(await update(app,b.target,{
    viewport:{width:480,height:800,scale_milli:1000}
  })).entity;
  const dir=mkdtempSync(join(tmpdir(),'launchwright-r49-private-'));
  if(process.platform!=='win32')chmodSync(dir,0o700);
  t.after(()=>rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:50}));
  const fake=new FakeSimctl();
  const input={release_id:b.release.id,source_id:source.id,target_id:target.id,
    udid:UDID,bundle_id:BUNDLE,rights:'owned',
    acknowledge_simulator_only:true,acknowledge_unknown:true};
  const plan=()=>planIOSSimulator(app,input,fake.run);
  const approval=p=>({
    confirm_plan_sha256:p.plan_sha256,confirm_bundle_id:BUNDLE,
    confirm_build_label:b.release.data.build,
    acknowledge_current_screen:true,acknowledge_unverified_foreground:true,
    acknowledge_unverified_pixel_privacy:true
  });
  return{app,root,b,source,target,dir,fake,input,plan,approval};
}
test('R49 no-effects plan pins exact available booted iOS simulator and Native source/target/release revisions',async t=>{
  const f=await fixture(t),plan=f.plan();
  assert.deepEqual(plan,f.plan());
  assert.deepEqual(verifyIOSSimulator(f.app,plan,f.fake.run),plan);
  assert.equal(plan.technical_state,'UNKNOWN');
  assert.equal(plan.classification,'imported');
  assert.equal(plan.simulator.ios_simulator_only,true);
  assert.equal(plan.simulator.app_foreground_verified,false);
  assert.equal(plan.simulator.app_build_verified_on_device,false);
  assert.equal(plan.app_launched_by_adapter,false);
  assert.equal(plan.real_hardware_touched,false);
  assert.equal(plan.platform_authority,false);
  assert.equal(plan.simulator.udid,UDID);
  assert.match(plan.simulator.app_container_path_sha256,/^[a-f0-9]{64}$/u);
  assert.ok(!JSON.stringify(plan).includes(f.fake.container));
  assert.equal(f.app.list('evidence').length,0);
  assert.deepEqual(readdirSync(f.dir),[]);
  assert.equal(f.fake.captured(),0);
  assert.ok(f.fake.calls.every(args=>['list','get_app_container'].includes(args[0])));
});
test('R49 real PNG from injected simulator is normalized and records imported UNKNOWN Native evidence only',async t=>{
  const f=await fixture(t),plan=f.plan();
  const result=await captureIOSSimulator(f.app,plan,f.dir,f.approval(plan),f.fake.run);
  assert.equal(result.screenshot_captured_now,true);
  assert.equal(result.technical_state,'UNKNOWN');
  assert.equal(result.driver_host_admission,false);
  assert.equal(result.platform_authority,false);
  assert.equal(result.app_foreground_verified,false);
  assert.equal(result.physical_device_touched,false);
  const file=join(f.dir,result.screenshot_filename);
  const bytes=readFileSync(file);
  const image=PNG.sync.read(bytes,{checkCRC:true});
  assert.equal(image.width,480);assert.equal(image.height,800);
  assert.equal(hash(bytes),result.normalized_png_sha256);
  const receipt=JSON.parse(readFileSync(join(f.dir,result.receipt_filename),'utf8'));
  assert.equal(receipt.normalized_png_sha256,result.normalized_png_sha256);
  assert.equal(receipt.runtime,RUNTIME);
  assert.equal(receipt.app_foreground_verified,false);
  assert.equal(receipt.privacy_independently_verified,false);
  const native=f.app.get(result.evidence_id,'evidence');
  assert.equal(native.data.classification,'imported');
  assert.equal(native.data.technical,'UNKNOWN');
  assert.equal(native.data.host_acceptance,'NOT_ESTABLISHED');
  assert.equal(native.data.origin_digest,receipt.origin_digest);
  assert.equal(native.data.source_id,f.source.id);
  assert.equal(native.data.build,f.b.release.data.build);
  assert.equal(f.fake.captured(),1);
  assert.equal(readdirSync(f.dir).length,2);
  if(process.platform!=='win32'){
    assert.equal(statSync(file).mode&0o077,0);
    assert.equal(statSync(join(f.dir,result.receipt_filename)).mode&0o077,0);
  }
});
test('R49 exact saved receipt recovers one Native evidence identity without simulator recapture',async t=>{
  const f=await fixture(t),plan=f.plan();
  const first=await captureIOSSimulator(f.app,plan,f.dir,f.approval(plan),f.fake.run);
  f.fake.png=screenshot(480,800);
  const again=await captureIOSSimulator(f.app,plan,f.dir,f.approval(plan),f.fake.run);
  assert.equal(again.recovered_without_recapture,true);
  assert.equal(again.screenshot_captured_now,false);
  assert.equal(again.evidence_id,first.evidence_id);
  assert.equal(f.app.list('evidence').length,1);
  assert.equal(f.fake.captured(),1);
});
test('R49 after screenshot/receipt and lost Native ACK recovers same bytes without another simctl IO',async t=>{
  const f=await fixture(t),plan=f.plan();
  const original=f.app.store.transaction.bind(f.app.store);
  f.app.store.transaction=(operation,...rest)=>{
    if(operation==='evidence.import')throw Error('Synthetic Native acknowledgement lost');
    return original(operation,...rest);
  };
  await assert.rejects(captureIOSSimulator(f.app,plan,f.dir,f.approval(plan),f.fake.run),
    /Synthetic Native acknowledgement lost/u);
  assert.equal(f.fake.captured(),1);
  assert.equal(f.app.list('evidence').length,0);
  assert.equal(readdirSync(f.dir).length,2);
  f.app.store.transaction=original;
  const result=await captureIOSSimulator(f.app,plan,f.dir,f.approval(plan),f.fake.run);
  assert.equal(result.recovered_without_recapture,true);
  assert.equal(f.app.list('evidence').length,1);
  assert.equal(f.fake.captured(),1);
});
test('R49 invalid physical-device selectors, non-iOS runtimes, nonbooted and uninstalled app fail before screenshot',async t=>{
  const f=await fixture(t);
  for(const udid of ['192.168.1.2:22','00008110-000951923490821E',
    'device','',UDID+';rm -rf /']){
    const calls=f.fake.calls.length;
    assert.throws(()=>planIOSSimulator(f.app,{...f.input,udid},f.fake.run),{code:'PermissionDenied'});
    assert.equal(f.fake.calls.length,calls);
  }
  f.fake.status='Shutdown';
  assert.throws(f.plan,{code:'PermissionDenied'});
  f.fake.status='Booted';f.fake.runtime='com.apple.CoreSimulator.SimRuntime.tvOS-18-5';
  assert.throws(f.plan,{code:'PermissionDenied'});
  f.fake.runtime=RUNTIME;f.fake.appInstalled=false;
  assert.throws(f.plan);
  assert.equal(f.fake.captured(),0);
});
test('R49 exact explicit screen/rights/privacy acknowledgements are required independently',async t=>{
  const f=await fixture(t),plan=f.plan();
  for(const key of ['acknowledge_simulator_only','acknowledge_unknown']){
    assert.throws(()=>planIOSSimulator(f.app,{...f.input,[key]:false},f.fake.run),
      {code:'ConsentRequired'});
  }
  for(const patch of [
    {acknowledge_current_screen:false},
    {acknowledge_unverified_foreground:false},
    {acknowledge_unverified_pixel_privacy:false},
    {confirm_plan_sha256:'a'.repeat(64)},
    {confirm_bundle_id:'com.example.foreign'},
    {confirm_build_label:'different-build'}
  ])await assert.rejects(captureIOSSimulator(f.app,plan,f.dir,{
    ...f.approval(plan),...patch
  },f.fake.run),{code:'ConsentRequired'});
  assert.deepEqual(readdirSync(f.dir),[]);
  assert.equal(f.fake.captured(),0);
});
test('R49 invalid PNG pixels/dimensions prevent any stored receipt or Native evidence',async t=>{
  const f=await fixture(t),plan=f.plan();
  f.fake.corrupt=true;
  await assert.rejects(captureIOSSimulator(f.app,plan,f.dir,f.approval(plan),f.fake.run));
  assert.equal(f.app.list('evidence').length,0);
  assert.deepEqual(readdirSync(f.dir),[]);
  f.fake.corrupt=false;f.fake.png=screenshot(600,800);
  await assert.rejects(captureIOSSimulator(f.app,plan,f.dir,f.approval(plan),f.fake.run),
    {code:'Conflict'});
  assert.equal(f.app.list('evidence').length,0);
  assert.deepEqual(readdirSync(f.dir),[]);
});
test('R49 modified or orphan PNG, receipt tampering, symlink/public folder and exclusive lock fail closed',async t=>{
  const f=await fixture(t),plan=f.plan();
  const result=await captureIOSSimulator(f.app,plan,f.dir,f.approval(plan),f.fake.run);
  const png=join(f.dir,result.screenshot_filename);
  writeFileSync(png,'edited by operator');
  await assert.rejects(captureIOSSimulator(f.app,plan,f.dir,f.approval(plan),f.fake.run),
    {code:'Conflict'});
  if(process.platform!=='win32'){
    const openDir=join(f.root,'public-output');
    mkdirSync(openDir,{mode:0o755});chmodSync(openDir,0o755);
    await assert.rejects(captureIOSSimulator(f.app,plan,openDir,f.approval(plan),f.fake.run),
      {code:'PermissionDenied'});
    const symlink=join(f.root,'sym-output');
    symlinkSync(f.dir,symlink);
    await assert.rejects(captureIOSSimulator(f.app,plan,symlink,f.approval(plan),f.fake.run),
      {code:'PermissionDenied'});
  }
  const lock=join(f.root,'.ios-simulator-capture.lock');
  writeFileSync(lock,'another operator',{mode:0o600});
  await assert.rejects(captureIOSSimulator(f.app,plan,f.dir,f.approval(plan),f.fake.run),
    {code:'Conflict'});
  assert.equal(readFileSync(lock,'utf8'),'another operator');
});
test('R49 changed app installation container, source version or target viewport invalidates saved plan',async t=>{
  const f=await fixture(t),plan=f.plan();
  assert.throws(()=>verifyIOSSimulator(f.app,{...plan,rights:'licensed'},f.fake.run),
    {code:'Conflict'});
  f.fake.container=f.fake.container.replace('ABC/','XYZ/');
  assert.throws(()=>verifyIOSSimulator(f.app,plan,f.fake.run),{code:'StaleReference'});
  f.fake.container=f.fake.container.replace('XYZ/','ABC/');
  await update(f.app,f.target,{viewport:{width:600,height:800,scale_milli:1000}});
  assert.throws(()=>verifyIOSSimulator(f.app,plan,f.fake.run),{code:'StaleReference'});
  assert.equal(f.fake.captured(),0);
});
test('R49 fixed CoreSimulator command grammar never installs/boots/launches apps or touches physical devices',async t=>{
  const f=await fixture(t),plan=f.plan();
  await captureIOSSimulator(f.app,plan,f.dir,f.approval(plan),f.fake.run);
  for(const args of f.fake.calls){
    assert.ok(args[0]==='list'||args[0]==='get_app_container'||args[0]==='io');
    assert.ok(!args.some(x=>/^(?:boot|install|uninstall|launch|shutdown|spawn|erase|push|connect)$/u.test(x)));
  }
  assert.equal(f.fake.captured(),1);
});
