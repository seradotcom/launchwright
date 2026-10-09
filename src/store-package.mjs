// SPDX-License-Identifier: AGPL-3.0-only
// R44: local-only, source-bound Apple/Google store listing asset pack.
// Exact published platform-policy subset; no App Store/Play Console access.
import { createHash } from 'node:crypto';
import { closeSync,existsSync,lstatSync,openSync,readFileSync,unlinkSync,writeFileSync } from 'node:fs';
import { isAbsolute,join } from 'node:path';
import { PNG } from 'pngjs';
import { requireCondition as ensure,validateValue,NativeError } from '@semwright/native-sdk';
import { digest } from './base.mjs';
import { renderStorePackage } from './store-assets-zip.mjs';

export const STORE_ASSETS_SCHEMA='launchwright-store-assets-plan/1';
export const STORE_POLICIES=Object.freeze({
  'apple-iphone-dynamic-island-medium':{
    store:'apple-app-store',channel:'app-store-connect-draft',
    device:'iphone-dynamic-island-medium',min:1,max:10,
    sizes:[[1179,2556],[1206,2622]],summary_max:30,
    policy_url:'https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications'
  },
  'google-play-phone-portrait':{
    store:'google-play',channel:'google-play-draft',
    device:'phone-portrait',min:2,max:8,
    sizes:[[1080,1920]],summary_max:80,
    policy_url:'https://support.google.com/googleplay/android-developer/answer/9866151?hl=en-en'
  }
});
const sha=data=>createHash('sha256').update(data).digest('hex');
const exact=(v,keys,required=keys)=>{
  ensure(v&&typeof v==='object'&&!Array.isArray(v)&&
    Object.keys(v).every(k=>keys.includes(k))&&
    required.every(k=>Object.hasOwn(v,k)),
    'Store listing input has missing or unsupported fields','InvalidArgument');
  return v;
};
function safeText(text,max,label,{optional=false,multiline=false}={}){
  ensure(typeof text==='string'&&(optional||text.length>0)&&
    [...text].length<=max&&!/[\0-\x08\x0b-\x1f\x7f]/u.test(text)&&
    (multiline||!text.includes('\n'))&&!/[<>]/u.test(text),
    'Store '+label+' is empty, too long or contains unsafe markup/control characters','InvalidArgument');
  return text;
}
function safeUrl(value,label){
  ensure(typeof value==='string'&&value.length>0&&value.length<=1024,
    label+' URL is missing or too long','InvalidArgument');
  let url;try{url=new URL(value);}catch{throw new NativeError('InvalidArgument',label+' must be a valid HTTPS URL');}
  ensure(url.protocol==='https:'&&!url.username&&!url.password&&
    !url.hash&&url.hostname.length>2,
    label+' must be a public-looking HTTPS URL without auth/fragment',
    'InvalidArgument');
  return value;
}
function privateFile(path){
  ensure(typeof path==='string'&&isAbsolute(path)&&path.length<=2048,
    'Store assets require explicitly selected absolute PNG paths','InvalidArgument');
  const st=lstatSync(path);
  ensure(st.isFile()&&!st.isSymbolicLink()&&st.size>0&&st.size<=12*1024*1024&&
    (process.platform==='win32'||(st.mode&0o077)===0),
    'Store PNG must be a private 0600 real file <= 12 MiB','PermissionDenied');
  return path;
}
function loadPng(item,width,height,label,{retainAlpha=false}={}){
  exact(item,['path','sha256']);
  ensure(typeof item.sha256==='string'&&/^[a-f0-9]{64}$/u.test(item.sha256),
    label+' has no exact source SHA-256','InvalidArgument');
  const bytes=readFileSync(privateFile(item.path));
  ensure(sha(bytes)===item.sha256,
    label+' source PNG changed since operator review','Conflict');
  ensure(bytes.length>=33&&
    bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&
    bytes.subarray(12,16).toString()==='IHDR'&&
    bytes.readUInt32BE(16)===width&&bytes.readUInt32BE(20)===height,
    label+' screenshot dimensions must match the exact platform profile','Conflict');
  let original;
  try{original=PNG.sync.read(bytes,{checkCRC:true});}
  catch{throw new NativeError('InvalidArgument',label+' PNG could not be safely decoded');}
  ensure(original.width===width&&original.height===height&&
    original.data.length===width*height*4,
    label+' decoded pixels changed from the specified size','Conflict');
  if(!retainAlpha){
    for(let i=3;i<original.data.length;i+=4)
      ensure(original.data[i]===255,
        'Screenshots and feature graphics must be fully opaque; alpha is unsupported',
        'InvalidArgument');
  }
  // App icon is 32-bit PNG with alpha, while screenshots/feature are 24-bit
  // PNG WITHOUT alpha. Never silently resize, rewrite copy or change pixels.
  const normalized=PNG.sync.write({width,height,data:Buffer.from(original.data)},
    {colorType:retainAlpha?6:2,inputColorType:6});
  const png=PNG.sync.read(normalized,{checkCRC:true});
  ensure(png.width===width&&png.height===height &&
    normalized[25]===(retainAlpha?6:2),
    'Normalized store asset has a forbidden or missing alpha channel','ProtocolMismatch');
  for(let i=0;i<original.data.length;i++)
    ensure(png.data[i]===original.data[i],
      'Normalized store asset unexpectedly changed source pixels','Conflict');
  return{
    normalized,source_sha256:item.sha256,normalized_sha256:sha(normalized),
    width,height,source_path_sha256:sha(Buffer.from(item.path))
  };
}
function validateMeta(input,profile){
  exact(input.metadata,[
    'name','summary','description','keywords','support_url','privacy_policy_url'
  ]);
  const m=input.metadata;
  safeText(m.name,30,'app name');
  safeText(m.summary,profile.summary_max,'subtitle/short description');
  safeText(m.description,4000,'description',{multiline:true});
  safeText(m.keywords,100,'keywords',{optional:true});
  if(profile.store==='apple-app-store'){
    ensure(m.keywords.length>0,'Apple keyword field is required','InvalidArgument');
    ensure(Buffer.byteLength(m.keywords,'utf8')<=100,
      'Apple keywords must be <=100 UTF-8 bytes','InvalidArgument');
  }else ensure(m.keywords==='',
    'Google Play does not accept an Apple keyword list in this profile','InvalidArgument');
  safeUrl(m.support_url,'Support');
  safeUrl(m.privacy_policy_url,'Privacy policy');
  ensure(/^[A-Za-z]{2}(?:-[A-Za-z0-9]{2,8}){0,2}$/u.test(input.locale),
    'Store listing locale must be explicit','InvalidArgument');
  return structuredClone(m);
}
function resolveCandidate(app,raw,profile){
  const release=app.get(raw.release_id,'release');
  const target=app.get(raw.target_id,'target');
  const candidate=app.get(raw.candidate_id,'candidate');
  const channel=app.get(raw.channel_profile_id,'channel_profile');
  ensure(target.data.release_id===release.id &&
    candidate.data.release_id===release.id &&
    channel.data.product_id===release.data.product_id &&
    channel.data.channel===profile.channel &&
    channel.data.destination_class==='external-draft' &&
    channel.data.idempotency==='recover-first' &&
    channel.data.requirements?.format==='png' &&
    channel.data.requirements?.device===profile.device,
    'Candidate, target and channel must refer to the same exact store scope',
    'PermissionDenied');
  const inspected=app.inspectCandidate(candidate);
  ensure(inspected.fresh&&inspected.private_draft_allowed&&
    inspected.editorial_review.state==='APPROVED_EDITORIAL',
    'Store listing requires fresh candidate with independent editorial approval',
    'ConsentRequired');
  ensure(target.data.editorial_locale===raw.locale,
    'Store listing locale must match approved editorial target locale','Conflict');
  return{release,target,candidate,channel,inspected};
}
function collect(app,raw){
  validateValue(raw);
  exact(raw,[
    'platform','release_id','target_id','candidate_id','channel_profile_id',
    'locale','metadata','source_rights','screenshots','graphics',
    'acknowledge_private_only','acknowledge_source_rights',
    'acknowledge_pixel_privacy'
  ]);
  const profile=STORE_POLICIES[raw.platform];
  ensure(profile,'Unknown store or unsupported device size profile','NotFound');
  ensure(raw.acknowledge_private_only===true&&
    raw.acknowledge_source_rights===true&&
    raw.acknowledge_pixel_privacy===true,
    'Store package requires separate operator rights, privacy and private-only declarations',
    'ConsentRequired');
  ensure(['owned','licensed'].includes(raw.source_rights),
    'Operator must declare source screenshot rights','ConsentRequired');
  const metadata=validateMeta(raw,profile);
  const refs=resolveCandidate(app,raw,profile);
  ensure(Array.isArray(raw.screenshots)&&raw.screenshots.length>=profile.min&&
    raw.screenshots.length<=profile.max,
    'Screenshot count is outside this store device profile','ResourceExhausted');
  const seen=new Set(),screenshots=[];
  let size=0;
  for(const [index,item] of raw.screenshots.entries()){
    exact(item,['source_evidence_id','png','alt']);
    ensure(!seen.has(item.source_evidence_id),
      'Duplicate capture evidence in one store package','Conflict');
    seen.add(item.source_evidence_id);
    safeText(item.alt,180,'screenshot alternative');
    const evidence=app.get(item.source_evidence_id,'evidence');
    const parent=app.get(evidence.data.parent_evidence_id,'evidence');
    const src=app.get(evidence.data.source_id,'source');
    ensure(evidence.data.evidence_type==='capture'&&
      evidence.data.classification==='sanitized'&&
      evidence.data.provenance?.capture_class==='SANITIZED_DERIVATIVE'&&
      evidence.data.parent_evidence_id===parent.id &&
      parent.data.evidence_type==='capture'&&
      parent.data.release_id===refs.release.id &&
      evidence.data.release_id===refs.release.id&&
      evidence.data.target_id===refs.target.id&&
      evidence.data.build===refs.release.data.build&&
      evidence.data.rights===raw.source_rights&&
      src.data.product_id===refs.release.data.product_id &&
      src.data.approval==='approved' &&
      src.data.build===refs.release.data.build,
      'Screenshot is not a scoped, source-approved sanitized capture derivative',
      'PermissionDenied');
    // Dimensions come from PNG IHDR, not arbitrary user metadata.
    const sourceBytes=readFileSync(privateFile(item.png.path));
    ensure(sourceBytes.length>=26,'Store screenshot lacks a complete PNG header','InvalidArgument');
    const width=sourceBytes.readUInt32BE(16),height=sourceBytes.readUInt32BE(20);
    ensure(profile.sizes.some(([x,y])=>x===width&&y===height),
      'Screenshot does not match an explicitly supported store pixel size','Conflict');
    const png=loadPng(item.png,width,height,'Store screenshot '+(index+1));
    size+=png.normalized.length;
    ensure(size<=48*1024*1024,'Store screenshots exceed 48 MiB of local assets','ResourceExhausted');
    screenshots.push({
      ordinal:index+1,evidence_id:evidence.id,evidence_revision:evidence.version,
      parent_capture_id:parent.id,parent_revision:parent.version,
      source_revision:src.version,source_origin_digest:evidence.data.origin_digest,
      alt:item.alt,source_png_sha256:png.source_sha256,
      normalized_sha256:png.normalized_sha256,
      width,height,bytes:png.normalized
    });
  }
  exact(raw.graphics,['icon','feature']);
  const graphics=[];
  if(profile.store==='google-play'){
    for(const [role,sizes] of [['icon',[512,512]],['feature',[1024,500]]]){
      const file=raw.graphics[role];
      ensure(file,'Google Play requires an operator-provided icon and feature graphic',
        'InvalidArgument');
      const pixels=loadPng(file,sizes[0],sizes[1],'Google Play '+role,
        {retainAlpha:role==='icon'});
      if(role==='icon')ensure(pixels.normalized.length<=1024*1024,
        'Google Play icon must be at most 1024 KiB','ResourceExhausted');
      graphics.push({
        role,width:sizes[0],height:sizes[1],
        source_png_sha256:pixels.source_sha256,
        normalized_sha256:pixels.normalized_sha256,
        bytes:pixels.normalized
      });
    }
    size+=graphics.reduce((n,g)=>n+g.bytes.length,0);
  }else ensure(raw.graphics.icon===null&&raw.graphics.feature===null,
    'Apple iPhone screenshot profile does not include an unsupported icon/feature graphic',
    'InvalidArgument');
  ensure(size<=52*1024*1024,'Store asset set exceeds private package budget','ResourceExhausted');
  return{raw,profile,...refs,metadata,screenshots,graphics,bytes:size};
}
export function planStorePackage(app,input){
  const data=collect(app,input);
  const core={
    schema_version:STORE_ASSETS_SCHEMA,platform:input.platform,
    policy_snapshot:'2026-10-09',policy_url:data.profile.policy_url,
    release_id:data.release.id,release_version:data.release.version,
    build:data.release.data.build,target_id:data.target.id,
    target_version:data.target.version,candidate_id:data.candidate.id,
    candidate_sha256:data.candidate.data.candidate_sha256,
    channel_profile_id:data.channel.id,channel_profile_version:data.channel.version,
    channel:data.profile.channel,device:data.profile.device,
    locale:input.locale,metadata:data.metadata,
    source_rights:input.source_rights,
    screenshot_count:data.screenshots.length,
    screenshots:data.screenshots.map(({bytes,...s})=>s),
    graphics:data.graphics.map(({bytes,...g})=>g),
    privacy_operator_declaration:true,rights_operator_declaration:true,
    pixel_capture_authority:'operator-declared-sanitized-derivative',
    independent_pixel_privacy_pass:false,device_host_acceptance:false,
    store_api_upload_performed:false,listing_submission_accepted:false,
    external_publish_authority:false,platform_authority:false
  };
  return{...core,plan_sha256:digest('store-package-plan',core)};
}
export function verifyStorePackage(app,plan,input){
  validateValue(plan);
  ensure(plan&&typeof plan==='object'&&!Array.isArray(plan),
    'Store package plan must be an object','InvalidArgument');
  const{plan_sha256,...core}=plan;
  ensure(typeof plan_sha256==='string'&&/^[a-f0-9]{64}$/u.test(plan_sha256)&&
    digest('store-package-plan',core)===plan_sha256,
    'Store asset plan was modified','Conflict');
  ensure(JSON.stringify(planStorePackage(app,input))===JSON.stringify(plan),
    'Candidate, channel revision, source pixels or listing metadata changed',
    'StaleReference');
  return plan;
}
async function withPackageLock(app,work){
  const path=join(app.store.root,'.store-package-apply.lock');
  let fd;
  try{fd=openSync(path,'wx',0o600);}
  catch{throw new NativeError('Conflict',
    'Store package writer is running or a stale lock requires manual inspection');}
  try{return await work();}
  finally{try{closeSync(fd);}finally{unlinkSync(path);}}
}
export async function exportStorePackage(app,plan,input,outDir,{
  confirm_plan_sha256,confirm_candidate_sha256,
  acknowledge_private_export=false
}={}){
  verifyStorePackage(app,plan,input);
  ensure(confirm_plan_sha256===plan.plan_sha256&&
    confirm_candidate_sha256===plan.candidate_sha256&&
    acknowledge_private_export===true,
    'Confirm exact candidate, saved plan and private-only export','ConsentRequired');
  ensure(typeof outDir==='string'&&isAbsolute(outDir)&&outDir.length<=2048,
    'Output must be an explicitly selected private absolute directory','InvalidArgument');
  const stat=lstatSync(outDir);
  ensure(stat.isDirectory()&&!stat.isSymbolicLink()&&
    (process.platform==='win32'||(stat.mode&0o077)===0),
    'Store package directory must be a real private 0700 folder','PermissionDenied');
  return withPackageLock(app,async()=>{
    const data=collect(app,input);
    const bundle=await renderStorePackage(plan,data);
    const name='launchwright-store-'+plan.plan_sha256.slice(0,12);
    const receipt={
      schema_version:'launchwright-store-package-receipt/1',
      plan_sha256:plan.plan_sha256,candidate_sha256:plan.candidate_sha256,
      channel:plan.channel,locale:plan.locale,build:plan.build,
      zip_sha256:sha(bundle.bytes),bytes:bundle.bytes.length,
      screenshots:plan.screenshot_count,graphics:plan.graphics.length,
      local_png_policy_checks_passed:true,
      source_capture_truth:'operator-declared-sanitized-derivative',
      technical_state:'UNKNOWN',
      store_review_performed:false,store_api_upload_performed:false,
      publication_authority:false,platform_authority:false
    };
    const outputs=[
      {name:name+'.zip',bytes:bundle.bytes},
      {name:name+'.receipt.json',bytes:Buffer.from(JSON.stringify(receipt,null,2)+'\n')}
    ];
    for(const file of outputs){
      const path=join(outDir,file.name);
      if(!existsSync(path))continue;
      const info=lstatSync(path);
      ensure(info.isFile()&&!info.isSymbolicLink()&&
        (process.platform==='win32'||(info.mode&0o077)===0)&&
        sha(readFileSync(path))===sha(file.bytes),
        'Existing store file differs from the exact approved plan','Conflict');
    }
    let created=0;
    for(const file of outputs){
      const path=join(outDir,file.name);
      if(existsSync(path))continue;
      writeFileSync(path,file.bytes,{flag:'wx',mode:0o600});
      created++;
    }
    return{...receipt,filename:outputs[0].name,files_created:created,
      recovered:created===0,remote_mutations_performed:false};
  });
}
