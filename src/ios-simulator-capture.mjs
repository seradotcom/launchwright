// SPDX-License-Identifier: AGPL-3.0-only
// R49 bounded APPLE CORE SIMULATOR screenshot observation. Not an iOS
// Driver Host, physical-device connector, account client or app executor.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync,existsSync,lstatSync,mkdtempSync,openSync,readFileSync,
  rmSync,unlinkSync,writeFileSync } from 'node:fs';
import { isAbsolute,join } from 'node:path';
import { PNG } from 'pngjs';
import { requireCondition as ensure,validateValue,NativeError } from '@semwright/native-sdk';
import { digest } from './base.mjs';
import { execute } from './application.mjs';

export const IOS_SIMULATOR_SCHEMA='launchwright-ios-simulator-observation/1';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
const uuid=v=>typeof v==='string'&&/^[A-F0-9]{8}-(?:[A-F0-9]{4}-){3}[A-F0-9]{12}$/iu.test(v);
const bundle=v=>typeof v==='string'&&v.length<=160&&
  /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*){1,12}$/u.test(v);
const exact=(obj,keys)=>{
  ensure(obj&&typeof obj==='object'&&!Array.isArray(obj)&&
    Object.keys(obj).sort().join(',')===keys.slice().sort().join(','),
    'Simulator operation requires a complete, exact source/consent contract',
    'InvalidArgument');
  return obj;
};
export function runLocalSimctl(args,{limit=1024*1024,timeout=20000}={}){
  const r=spawnSync('xcrun',['simctl',...args],{
    shell:false,encoding:null,timeout,maxBuffer:limit+65536,
    env:{...process.env,NSUnbufferedIO:'YES'}
  });
  if(r.error||r.status!==0||!Buffer.isBuffer(r.stdout)||
    r.stdout.length>limit)
    throw new NativeError('Unavailable','Bounded local CoreSimulator request failed');
  return r.stdout;
}
const output=(runner,args,max=1024*1024)=>{
  const data=runner(args,{limit:max,timeout:20000});
  ensure(Buffer.isBuffer(data)&&data.length<=max,
    'CoreSimulator reply is malformed or exceeds the bounded budget',
    'ProtocolMismatch');
  return data;
};
function asText(bytes,max=4096){
  let text;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes).trim();}
  catch{throw new NativeError('InvalidArgument','CoreSimulator returned non-UTF-8 data');}
  ensure(text.length>0&&Buffer.byteLength(text)<=max,
    'CoreSimulator returned a missing or oversized identity','InvalidArgument');
  return text;
}
function iosDevice(runner,udid,bundleId){
  ensure(uuid(udid),'Only the exact UUID of a local iOS simulator is allowed','PermissionDenied');
  ensure(bundle(bundleId),'iOS app bundle ID must be a bounded developer identifier','InvalidArgument');
  let devices;
  try{devices=JSON.parse(asText(output(runner,['list','-j','devices','booted']),262144));}
  catch{throw new NativeError('InvalidArgument','Unable to read CoreSimulator booted devices JSON');}
  ensure(devices&&typeof devices.devices==='object'&&!Array.isArray(devices.devices),
    'CoreSimulator JSON does not contain a device inventory','ProtocolMismatch');
  const choices=[];
  for(const [runtime,items] of Object.entries(devices.devices)){
    if(!/^com[.]apple[.]CoreSimulator[.]SimRuntime[.]iOS-[0-9]+(?:-[0-9]+)*$/u.test(runtime))continue;
    ensure(Array.isArray(items)&&items.length<=100,
      'CoreSimulator iOS inventory is not bounded','ResourceExhausted');
    for(const item of items){
      if(item.udid?.toLowerCase()===udid.toLowerCase())
        choices.push({...item,runtime});
    }
  }
  ensure(choices.length===1,'Selected UUID is not one unique booted iOS simulator','PermissionDenied');
  const device=choices[0];
  ensure(device.state==='Booted'&&device.isAvailable!==false&&
    typeof device.name==='string'&&device.name.length<=100&&
    !/[\0-\x1f\x7f]/u.test(device.name)&&
    /^com[.]apple[.]CoreSimulator[.]SimDeviceType[.]iPhone-[A-Za-z0-9-]+$/u.test(device.deviceTypeIdentifier??''),
    'Selected device is not a booted available iPhone simulator','PermissionDenied');
  const appPath=asText(output(runner,
    ['get_app_container',udid,bundleId,'app'],4096));
  ensure(appPath.startsWith('/')&&appPath.endsWith('.app')&&
    !/[\0-\x1f\x7f]/u.test(appPath)&&appPath.length<=2048,
    'Chosen app is not visibly installed in selected iOS simulator',
    'PermissionDenied');
  return{
    udid:device.udid,runtime:device.runtime,
    device_type:device.deviceTypeIdentifier,
    device_name:device.name,
    app_bundle_id:bundleId,
    app_container_path_sha256:hash(Buffer.from(appPath)),
    app_binary_verified:false,
    app_foreground_verified:false,
    app_build_verified_on_device:false,
    ios_simulator_only:true
  };
}
export function inspectIOSSimulator({udid,bundle_id},runner=runLocalSimctl){
  return iosDevice(runner,udid,bundle_id);
}
function scope(app,input){
  app.allow('edit');
  ensure(['owned','licensed'].includes(input.rights),
    'Operator must declare screenshot pixel rights as owned or licensed','ConsentRequired');
  const release=app.get(input.release_id,'release');
  const source=app.get(input.source_id,'source');
  const target=app.get(input.target_id,'target');
  ensure(source.data.type==='mobile-import'&&source.data.approval==='approved'&&
    source.data.purpose&&
    source.data.locator==='ios-simulator:'+input.bundle_id&&
    source.data.product_id===release.data.product_id&&
    source.data.build===release.data.build&&
    target.data.release_id===release.id,
    'iOS app source/target/release declaration is not approved or version scoped',
    'PermissionDenied');
  return{release,source,target};
}
export function planIOSSimulator(app,input,runner=runLocalSimctl){
  validateValue(input);
  exact(input,['release_id','source_id','target_id','udid','bundle_id','rights',
    'acknowledge_simulator_only','acknowledge_unknown']);
  ensure(input.acknowledge_simulator_only===true&&input.acknowledge_unknown===true,
    'The operator must acknowledge local simulator-only source and imported UNKNOWN truth',
    'ConsentRequired');
  const objects=scope(app,input);
  const sim=iosDevice(runner,input.udid,input.bundle_id);
  const core={
    schema_version:IOS_SIMULATOR_SCHEMA,
    release_id:objects.release.id,release_version:objects.release.version,
    source_id:objects.source.id,source_version:objects.source.version,
    target_id:objects.target.id,target_version:objects.target.version,
    build_label:objects.release.data.build,
    expected_dimensions:[objects.target.data.viewport.width,
      objects.target.data.viewport.height],
    rights:input.rights,simulator:sim,
    source_rights_basis:'operator-declaration',
    technical_state:'UNKNOWN',classification:'imported',
    app_foreground_verified:false,app_binary_verified:false,
    source_build_verified_on_device:false,independent_pixel_privacy_review:false,
    real_hardware_touched:false,app_launched_by_adapter:false,
    driver_host_admission:false,platform_authority:false,
    public_release_created:false,
    acknowledge_simulator_only:true,acknowledge_unknown:true
  };
  return{...core,plan_sha256:digest('ios-simulator-plan',core)};
}
export function verifyIOSSimulator(app,plan,runner=runLocalSimctl){
  validateValue(plan);
  ensure(plan&&typeof plan==='object'&&!Array.isArray(plan),
    'iOS simulator plan must be an exact saved JSON object','InvalidArgument');
  const {plan_sha256,...core}=plan;
  ensure(sha(plan_sha256)&&digest('ios-simulator-plan',core)===plan_sha256,
    'Saved iOS simulator plan was changed','Conflict');
  const expected=planIOSSimulator(app,{
    release_id:core.release_id,source_id:core.source_id,
    target_id:core.target_id,udid:core.simulator?.udid,
    bundle_id:core.simulator?.app_bundle_id,rights:core.rights,
    acknowledge_simulator_only:core.acknowledge_simulator_only,
    acknowledge_unknown:core.acknowledge_unknown
  },runner);
  ensure(JSON.stringify(expected)===JSON.stringify(plan),
    'Selected simulator, app container or Native release revision changed',
    'StaleReference');
  return plan;
}
function privateDir(path){
  ensure(typeof path==='string'&&isAbsolute(path)&&path.length<=2048,
    'An absolute existing owner-private directory is required','InvalidArgument');
  const s=lstatSync(path);
  ensure(s.isDirectory()&&!s.isSymbolicLink()&&
    (process.platform==='win32'||(s.mode&0o077)===0),
    'iOS simulator output must be a private 0700 non-symlink directory',
    'PermissionDenied');
  return path;
}
function realScreenshot(runner,plan,dir){
  const temp=mkdtempSync(join(dir,'.launchwright-ios-shot-'));
  try{
    const path=join(temp,'captured.png');
    const bytes=output(runner,
      ['io',plan.simulator.udid,'screenshot','--type=png','--mask=ignored',path],4096);
    // simctl prints success to stderr; stdout is ignored, never serialized.
    ensure(existsSync(path),'iOS simulator screenshot was not created','Unavailable');
    const st=lstatSync(path);
    ensure(st.isFile()&&!st.isSymbolicLink()&&st.size>=33&&st.size<=4*1024*1024,
      'CoreSimulator image is missing, unsafe or oversized','InvalidArgument');
    const raw=readFileSync(path);
    ensure(raw.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&
      raw.subarray(12,16).toString()==='IHDR',
      'iOS simulator screenshot must be a valid PNG','InvalidArgument');
    const width=raw.readUInt32BE(16),height=raw.readUInt32BE(20);
    ensure(width===plan.expected_dimensions[0]&&height===plan.expected_dimensions[1]&&
      width*height<=5000000&&width>=240&&height>=240,
      'iOS screenshot dimensions differ from declared target or budget','Conflict');
    let decoded;
    try{decoded=PNG.sync.read(raw,{checkCRC:true});}
    catch{throw new NativeError('InvalidArgument','iOS screenshot PNG pixels could not be decoded safely');}
    ensure(decoded.width===width&&decoded.height===height&&
      decoded.data.length===width*height*4,'iOS screenshot pixels changed unexpectedly','Conflict');
    const normalized=PNG.sync.write({width,height,
      data:Buffer.from(decoded.data)},{colorType:6,inputColorType:6});
    ensure(normalized.length<=4*1024*1024,
      'iOS normalized PNG exceeds private output budget','ResourceExhausted');
    return{png:normalized,original_sha256:hash(raw),sha256:hash(normalized),
      width,height};
  }finally{rmSync(temp,{recursive:true,force:true,maxRetries:3,retryDelay:50});}
}
export async function captureIOSSimulator(app,plan,outDir,{
  confirm_plan_sha256,confirm_bundle_id,confirm_build_label,
  acknowledge_current_screen=false,acknowledge_unverified_foreground=false,
  acknowledge_unverified_pixel_privacy=false
}={},runner=runLocalSimctl){
  verifyIOSSimulator(app,plan,runner);
  ensure(confirm_plan_sha256===plan.plan_sha256&&
    confirm_bundle_id===plan.simulator.app_bundle_id&&
    confirm_build_label===plan.build_label&&
    acknowledge_current_screen===true&&
    acknowledge_unverified_foreground===true&&
    acknowledge_unverified_pixel_privacy===true,
    'Operator must independently confirm screenshot, bundle/build and UNKNOWN foreground/privacy',
    'ConsentRequired');
  const dir=privateDir(outDir),prefix='launchwright-ios-'+plan.plan_sha256.slice(0,12);
  const pngPath=join(dir,prefix+'.png'),receiptPath=join(dir,prefix+'.receipt.json');
  const lockPath=join(app.store.root,'.ios-simulator-capture.lock');
  let fd;
  try{fd=openSync(lockPath,'wx',0o600);}
  catch{throw new NativeError('Conflict','iOS simulator capture already running or stale lock needs manual review');}
  try{
    let receipt=null,captured=false;
    if(existsSync(receiptPath)){
      const st=lstatSync(receiptPath);
      ensure(st.isFile()&&!st.isSymbolicLink()&&st.size<=8192&&
        (process.platform==='win32'||(st.mode&0o077)===0),
        'Existing iOS screenshot receipt is unsafe or oversized','Conflict');
      try{receipt=JSON.parse(readFileSync(receiptPath,'utf8'));}
      catch{throw new NativeError('Conflict','iOS receipt was not valid JSON');}
      const {receipt_sha256,...body}=receipt;
      ensure(sha(receipt_sha256)&&
        digest('ios-simulator-receipt',body)===receipt_sha256&&
        receipt.schema_version==='launchwright-ios-simulator-capture-receipt/1'&&
        receipt.plan_sha256===plan.plan_sha256&&
        receipt.release_id===plan.release_id&&
        receipt.source_id===plan.source_id&&receipt.target_id===plan.target_id&&
        receipt.build_label===plan.build_label&&
        receipt.bundle_id===plan.simulator.app_bundle_id&&
        receipt.simulator_udid===plan.simulator.udid&&
        receipt.runtime===plan.simulator.runtime&&
        receipt.app_container_path_sha256===plan.simulator.app_container_path_sha256&&
        receipt.width===plan.expected_dimensions[0]&&
        receipt.height===plan.expected_dimensions[1]&&
        receipt.rights===plan.rights&&
        sha(receipt.original_png_sha256)&&sha(receipt.normalized_png_sha256)&&
        sha(receipt.origin_digest)&&
        receipt.origin_digest===digest('ios-simulator-pixels',{
          plan_sha256:plan.plan_sha256,pixels:receipt.normalized_png_sha256
        })&&
        receipt.technical_state==='UNKNOWN'&&
        receipt.privacy_independently_verified===false&&
        receipt.app_foreground_verified===false&&
        receipt.app_build_verified_on_device===false&&
        receipt.real_hardware_touched===false&&receipt.driver_host_admission===false&&
        receipt.platform_authority===false&&receipt.published===false,
        'Saved iOS screenshot receipt has drifted or escalated authority','Conflict');
      ensure(existsSync(pngPath),'Receipt lacks its original PNG','Conflict');
      const imageStat=lstatSync(pngPath);
      ensure(imageStat.isFile()&&!imageStat.isSymbolicLink()&&
        imageStat.size<=4*1024*1024&&
        (process.platform==='win32'||(imageStat.mode&0o077)===0)&&
        hash(readFileSync(pngPath))===receipt.normalized_png_sha256,
        'Original iOS simulator screenshot was modified','Conflict');
    }else{
      ensure(!existsSync(pngPath),'Orphan PNG without receipt requires manual review','Conflict');
      const screenshot=realScreenshot(runner,plan,dir);
      receipt={
        schema_version:'launchwright-ios-simulator-capture-receipt/1',
        plan_sha256:plan.plan_sha256,
        release_id:plan.release_id,source_id:plan.source_id,
        target_id:plan.target_id,build_label:plan.build_label,
        bundle_id:plan.simulator.app_bundle_id,
        simulator_udid:plan.simulator.udid,runtime:plan.simulator.runtime,
        app_container_path_sha256:plan.simulator.app_container_path_sha256,
        width:screenshot.width,height:screenshot.height,rights:plan.rights,
        original_png_sha256:screenshot.original_sha256,
        normalized_png_sha256:screenshot.sha256,
        origin_digest:digest('ios-simulator-pixels',{
          plan_sha256:plan.plan_sha256,pixels:screenshot.sha256
        }),
        technical_state:'UNKNOWN',classification:'imported',
        privacy_independently_verified:false,app_foreground_verified:false,
        app_build_verified_on_device:false,real_hardware_touched:false,
        driver_host_admission:false,platform_authority:false,published:false
      };
      receipt.receipt_sha256=digest('ios-simulator-receipt',receipt);
      writeFileSync(pngPath,screenshot.png,{flag:'wx',mode:0o600});
      writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n',
        {flag:'wx',mode:0o600});
      captured=true;
    }
    const existing=app.list('evidence',plan.release_id)
      .filter(e=>e.data.origin_digest===receipt.origin_digest);
    ensure(existing.length<=1,'Ambiguous prior iOS evidence has the same origin digest','Conflict');
    let evidence=existing[0];
    if(evidence)ensure(evidence.data.release_id===plan.release_id&&
      evidence.data.source_id===plan.source_id&&
      evidence.data.target_id===plan.target_id&&
      evidence.data.rights===plan.rights&&
      evidence.data.classification==='imported'&&
      evidence.data.technical==='UNKNOWN'&&
      evidence.data.host_acceptance==='NOT_ESTABLISHED',
      'Existing iOS imported evidence has a different source or authority','Conflict');
    if(!evidence){
      evidence=(await execute(app,'evidence.import',{
        release_id:plan.release_id,target_id:plan.target_id,
        source_id:plan.source_id,name:'Private iOS simulator screenshot',
        build:plan.build_label,classification:'imported',rights:plan.rights,
        description:'Operator-declared iOS Simulator snapshot for '+
          plan.simulator.app_bundle_id+', source SHA256 '+receipt.normalized_png_sha256+
          '. Actual app foreground, installed application build, independent privacy, Driver Host and Platform UNKNOWN.',
        origin_digest:receipt.origin_digest
      })).entity;
    }
    return{
      schema_version:'launchwright-ios-simulator-capture-result/1',
      plan_sha256:plan.plan_sha256,screenshot_filename:prefix+'.png',
      receipt_filename:prefix+'.receipt.json',
      original_png_sha256:receipt.original_png_sha256,
      normalized_png_sha256:receipt.normalized_png_sha256,
      evidence_id:evidence.id,
      screenshot_captured_now:captured,recovered_without_recapture:!captured,
      technical_state:'UNKNOWN',independent_privacy_verification:false,
      app_foreground_verified:false,device_binary_attested:false,
      driver_host_admission:false,platform_authority:false,
      physical_device_touched:false,published:false
    };
  }finally{try{closeSync(fd);}finally{unlinkSync(lockPath);}}
}
