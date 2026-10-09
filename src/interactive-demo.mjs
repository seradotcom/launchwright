// SPDX-License-Identifier: AGPL-3.0-only
// R43: source-pinned sanitized derivative screenshots -> offline interactive
// demo. Semwright Media and Native SDK own the plan/evidence/receipt; this
// module never replays the source app, contacts the web or grants Platform.
import { createHash } from 'node:crypto';
import { closeSync,existsSync,lstatSync,openSync,readFileSync,unlinkSync,writeFileSync } from 'node:fs';
import { isAbsolute,join } from 'node:path';
import { PNG } from 'pngjs';
import { requireCondition as ensure, validateValue, NativeError } from '@semwright/native-sdk';
import { execute } from './application.mjs';
import { digest } from './base.mjs';
import { renderOfflineDemo } from './interactive-demo-view.mjs';

export const INTERACTIVE_DEMO_SCHEMA='launchwright-offline-interactive-demo-plan/1';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
const shortText=(value,max,desc)=>{
  ensure(typeof value==='string'&&value.length>=2&&value.length<=max&&
    !/[\x00-\x1f\x7f]/u.test(value),
    desc+' must be short, plain text without controls','InvalidArgument');
  return value;
};
const privateFile=path=>{
  ensure(typeof path==='string'&&isAbsolute(path)&&path.length<=2048,
    'An explicit private absolute screenshot path is required','InvalidArgument');
  const stat=lstatSync(path);
  ensure(stat.isFile()&&!stat.isSymbolicLink()&&
    stat.size>0&&stat.size<=2*1024*1024 &&
    (process.platform==='win32'||(stat.mode&0o077)===0),
    'Screenshot file must be a private regular PNG, 0600 and at most 2 MiB',
    'PermissionDenied');
  return path;
};
const privateDirectory=path=>{
  ensure(typeof path==='string'&&isAbsolute(path)&&path.length<=2048,
    'Choose an existing absolute private output directory','InvalidArgument');
  const stat=lstatSync(path);
  ensure(stat.isDirectory()&&!stat.isSymbolicLink()&&
    (process.platform==='win32'||(stat.mode&0o077)===0),
    'Offline demo output directory must have owner-only 0700 access',
    'PermissionDenied');
  return path;
};
function loadPNG(path,expectedSha,width,height){
  const bytes=readFileSync(privateFile(path));
  ensure(hex(expectedSha)&&sha(bytes)===expectedSha,
    'Operator-supplied source PNG has changed since review','Conflict');
  ensure(bytes.length>=33&&
    bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&
    bytes.subarray(12,16).toString()==='IHDR',
    'Screenshot is not a real PNG with a valid IHDR','InvalidArgument');
  ensure(bytes.readUInt32BE(16)===width&&bytes.readUInt32BE(20)===height&&
    width<=1920&&height<=1080,
    'Screen dimension differs from the pinned interactive variant','Conflict');
  let image;
  try{image=PNG.sync.read(bytes,{checkCRC:true});}
  catch{throw new NativeError('InvalidArgument','Screenshot PNG could not be decoded safely');}
  ensure(image.width===width&&image.height===height&&
    image.data.length===width*height*4,
    'Decoded PNG pixel dimensions differ from the declared source','Conflict');
  // Metadata is discarded; pixels still require independent HUMAN PII review.
  const normalized=PNG.sync.write({
    width,height,data:Buffer.from(image.data)
  },{colorType:6,inputColorType:6});
  ensure(normalized.length<=2*1024*1024,
    'Normalized screenshot exceeds the private demo budget','ResourceExhausted');
  return{bytes:normalized,source_sha256:expectedSha,sanitized_sha256:sha(normalized)};
}
function collect(app,raw){
  validateValue(raw);
  ensure(raw&&typeof raw==='object'&&!Array.isArray(raw)&&
    Object.keys(raw).sort().join(',')===
      ['acknowledge_pixel_privacy','acknowledge_private_only','frames',
       'media_plan_id','source_rights','variant_id'].sort().join(','),
    'Interactive demo requires exact source/bindings/consents','InvalidArgument');
  ensure(raw.acknowledge_private_only===true&&
    raw.acknowledge_pixel_privacy===true,
    'Operator must acknowledge private-only distribution and visual pixel privacy review',
    'ConsentRequired');
  ensure(['owned','licensed'].includes(raw.source_rights),
    'Operator must explicitly declare source screenshot rights','ConsentRequired');
  const plan=app.get(raw.media_plan_id,'media_plan');
  const state=app.read('media.inspect',{id:plan.id});
  ensure(state.source_freshness==='CURRENT',
    'Media source pins have changed since reviewed planning','StaleReference');
  const variant=plan.data.variants.find(x=>x.id===raw.variant_id);
  ensure(variant?.kind==='interactive-demo'&&
    state.variants.find(x=>x.id===raw.variant_id)?.source_freshness==='CURRENT',
    'Only current interactive-demo Media variants can be exported','StaleReference');
  ensure(plan.data.interactive_policy.sanitized_only===true&&
    plan.data.interactive_policy.productive_auth===false&&
    plan.data.interactive_policy.active_source_scripts===false,
    'Source Media plan allows unsafe interactive execution','PolicyDenied');
  ensure(Array.isArray(raw.frames)&&raw.frames.length>=2&&raw.frames.length<=8&&
    raw.frames.length===variant.shot_ids.length&&
    new Set(raw.frames.map(x=>x.shot_id)).size===raw.frames.length,
    'Offline demo must cover every declared interactive shot once (2–8)','ResourceExhausted');
  const release=app.get(plan.data.release_id,'release'),frames=[];
  let totalBytes=0;
  for(let i=0;i<raw.frames.length;i++){
    const x=raw.frames[i];
    ensure(x&&typeof x==='object'&&!Array.isArray(x)&&
      Object.keys(x).sort().join(',')===
        ['alt','label','png_path','png_sha256','shot_id','source_evidence_id'].sort().join(','),
      'Each frame requires an exact source evidence/PDF-safe screenshot identity',
      'InvalidArgument');
    ensure(x.shot_id===variant.shot_ids[i],
      'Interactive demo frames must preserve the full source shot order','Conflict');
    shortText(x.label,72,'Interactive step label');
    shortText(x.alt,180,'Accessible screenshot alternative');
    const shot=plan.data.shots.find(s=>s.id===x.shot_id);
    ensure(shot&&shot.interactive_evidence_id===x.source_evidence_id,
      'Offline screenshot must reference the exact sanitized Media shot','PermissionDenied');
    const evidence=app.get(x.source_evidence_id,'evidence');
    ensure(evidence.data.evidence_type==='capture'&&
      evidence.data.classification==='sanitized'&&
      evidence.data.provenance?.capture_class==='SANITIZED_DERIVATIVE'&&
      evidence.data.parent_evidence_id===shot.capture_evidence_id&&
      evidence.data.release_id===release.id&&
      evidence.data.target_id===plan.data.target_id&&
      evidence.data.scenario_id===plan.data.scenario_id &&
      evidence.data.rights===raw.source_rights,
      'Screenshot must refer to an exact scoped sanitized derivative and declared rights',
      'PermissionDenied');
    const png=loadPNG(x.png_path,x.png_sha256,variant.width,variant.height);
    totalBytes+=png.bytes.length;
    ensure(totalBytes<=12*1024*1024,
      'Total offline screen set exceeds 12 MiB budget','ResourceExhausted');
    frames.push({
      shot_id:x.shot_id,source_evidence_id:x.source_evidence_id,
      source_origin_digest:evidence.data.origin_digest,
      screenshot_sha256:x.png_sha256,sanitized_png_sha256:png.sanitized_sha256,
      local_path_sha256:sha(Buffer.from(x.png_path)),
      label:x.label,alt:x.alt,
      png:png.bytes
    });
  }
  return{plan,release,variant,frames,totalBytes};
}
export function planInteractiveDemo(app,input){
  const data=collect(app,input);
  const core={
    schema_version:INTERACTIVE_DEMO_SCHEMA,
    media_plan_id:data.plan.id,media_plan_digest:data.plan.data.plan_digest,
    release_id:data.release.id,variant_id:data.variant.id,
    locale:data.variant.locale,width:data.variant.width,height:data.variant.height,
    frame_count:data.frames.length,
    frames:data.frames.map(({png,...rest})=>rest),
    source_rights:input.source_rights,
    operator_declared_pixel_review:true,private_only:true,
    technical_state:'UNKNOWN',pixel_privacy_independently_verified:false,
    media_driver_host_acceptance:false,external_publish_authority:false,
    platform_authority:false,external_network_access:false
  };
  return{...core,plan_sha256:digest('interactive-demo',core)};
}
export function verifyInteractiveDemo(app,plan,input){
  validateValue(plan);
  ensure(plan&&typeof plan==='object'&&!Array.isArray(plan),
    'Offline demo plan must be a valid JSON object','InvalidArgument');
  const {plan_sha256,...core}=plan;
  ensure(hex(plan_sha256)&&digest('interactive-demo',core)===plan_sha256,
    'Offline demo plan bytes were modified','Conflict');
  const exact=planInteractiveDemo(app,input);
  ensure(JSON.stringify(exact)===JSON.stringify(plan),
    'The source Media plan, screenshot bytes, rights or step order changed',
    'StaleReference');
  return exact;
}
export async function withInteractiveDemoLock(workspaceRoot,task){
  const path=join(workspaceRoot,'.interactive-demo-apply.lock');
  let fd;
  try{fd=openSync(path,'wx',0o600);}
  catch{
    throw new NativeError('Conflict',
      'An interactive demo export is running or its stale lock requires manual review');
  }
  try{return await task();}
  finally{try{closeSync(fd);}finally{unlinkSync(path);}}
}
export async function exportInteractiveDemo(app,plan,input,outDir,{
  confirm_plan_sha256,confirm_media_plan_digest,
  acknowledge_private_export=false
}={}){
  verifyInteractiveDemo(app,plan,input);
  ensure(confirm_plan_sha256===plan.plan_sha256&&
    confirm_media_plan_digest===plan.media_plan_digest&&
    acknowledge_private_export===true,
    'Operator must confirm the exact source Media plan and private output intent',
    'ConsentRequired');
  const dir=privateDirectory(outDir);
  return withInteractiveDemoLock(app.store.root,async()=>{
    const data=collect(app,input);
    const output=await renderOfflineDemo(data,plan);
    // Check conflicting Native media receipts BEFORE writing any local files:
    // a different variant output is a stop condition, not a partial export.
    const prior=app.list('media_output',data.release.id).filter(row=>
      row.data.plan_id===data.plan.id && row.data.variant_id===data.variant.id);
    ensure(prior.length<=1&&(!prior.length||(
      prior[0].data.artifact_sha256===sha(output.bytes)&&
      prior[0].data.authority==='imported'&&
      prior[0].data.technical_effective==='UNKNOWN')),
      'Another media output claims this same interactive variant','Conflict');
    const name='launchwright-demo-'+plan.plan_sha256.slice(0,12);
    const artifacts=[
      {name:name+'.zip',bytes:output.bytes},
      {name:name+'.receipt.json',bytes:Buffer.from(JSON.stringify({
        schema_version:'launchwright-interactive-demo-receipt/1',
        plan_sha256:plan.plan_sha256,
        media_plan_id:plan.media_plan_id,
        media_plan_digest:plan.media_plan_digest,
        variant_id:plan.variant_id,
        source_images:plan.frames.map(x=>x.screenshot_sha256),
        artifact_sha256:sha(output.bytes),bytes:output.bytes.length,
        steps:plan.frame_count,private_only:true,technical_state:'UNKNOWN',
        pixel_privacy_independently_verified:false,
        external_network:false,external_publication:false,
        platform_authority:false
      },null,2)+'\n')}
    ];
    for(const a of artifacts){
      const path=join(dir,a.name);
      if(!existsSync(path))continue;
      const stat=lstatSync(path);
      ensure(stat.isFile()&&!stat.isSymbolicLink()&&
        (process.platform==='win32'||(stat.mode&0o077)===0)&&
        sha(readFileSync(path))===sha(a.bytes),
        'Existing private demo files were changed; never overwrite them','Conflict');
    }
    let created=0;
    for(const a of artifacts){
      const path=join(dir,a.name);
      if(existsSync(path))continue;
      writeFileSync(path,a.bytes,{mode:0o600,flag:'wx'});
      created++;
    }
    const native=prior[0]??(await execute(app,'media.output_record',{
      plan_id:data.plan.id,variant_id:data.variant.id,
      state:'SUCCEEDED',authority:'imported',
      provider:'launchwright-offline-demo',provider_version:'r43',
      artifact_sha256:sha(output.bytes),mime:'application/zip',
      observed_at:new Date().toISOString(),reported_verification:'UNKNOWN'
    })).entity;
    return{
      schema_version:'launchwright-interactive-demo-export/1',
      plan_sha256:plan.plan_sha256,
      filename:artifacts[0].name,artifact_sha256:sha(output.bytes),
      media_output_id:native.id,media_output_created:prior.length===0,
      files_created:created,recovered:created===0,
      steps:data.frames.length,
      technical_state:'UNKNOWN',operator_declared_sanitized_pixels:true,
      pixel_privacy_independently_verified:false,
      source_metadata_removed:true,
      source_application_scripts_executed:false,
      external_network:false,external_publication:false,
      platform_authority:false
    };
  });
}
