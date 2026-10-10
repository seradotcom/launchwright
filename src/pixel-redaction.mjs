// SPDX-License-Identifier: AGPL-3.0-only
// R55: operator-defined, pixel-exact PNG rectangle redaction with canonical
// Semwright Native capture provenance. This verifies only masks, NOT all PII.
import { createHash } from 'node:crypto';
import { closeSync,existsSync,lstatSync,openSync,readFileSync,unlinkSync,writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { PNG } from 'pngjs';
import { requireCondition as ensure, validateValue, NativeError } from '@semwright/native-sdk';
import { digest } from './base.mjs';
import { execute } from './application.mjs';

export const MASK_SCHEMA='launchwright-owned-pixel-mask-plan/1';
// Also admit reviewed iPhone 1179x2556/1206x2622 screenshots without
// increasing the existing MAX_PIXELS memory/decode budget.
const MAX_PNG=12*1024*1024,MAX_WIDTH=3840,MAX_HEIGHT=2700,
  MAX_PIXELS=3840*2160;
const FILL=Object.freeze([8,22,33,255]);
const sha=v=>createHash('sha256').update(v).digest('hex');
const isSha=x=>typeof x==='string'&&/^[0-9a-f]{64}$/u.test(x);
function exactly(input,keys,required=keys){
  ensure(input&&typeof input==='object'&&!Array.isArray(input)&&
    Object.keys(input).every(k=>keys.includes(k))&&
    required.every(k=>Object.hasOwn(input,k)),
    'Pixel-mask request has missing or unsupported fields','InvalidArgument');
  return input;
}
function privateInput(path){
  ensure(typeof path==='string'&&isAbsolute(path)&&path.length<=2048,
    'A privately owned absolute PNG path must be selected','InvalidArgument');
  const stat=lstatSync(path);
  ensure(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>32&&
    stat.size<=MAX_PNG&&(process.platform==='win32'||(stat.mode&0o077)===0),
    'Source must be a regular 0600 PNG no larger than 12 MiB','PermissionDenied');
  return path;
}
function privateOutput(path){
  ensure(typeof path==='string'&&isAbsolute(path)&&path.length<=2048,
    'Choose an existing absolute private output directory','InvalidArgument');
  const stat=lstatSync(path);
  ensure(stat.isDirectory()&&!stat.isSymbolicLink()&&
    (process.platform==='win32'||(stat.mode&0o077)===0),
    'Pixel-mask output must be a real 0700 private directory','PermissionDenied');
  return path;
}
function inputContract(input){
  validateValue(input);
  exactly(input,['parent_evidence_id','source_png_path','source_png_sha256',
    'rights','rectangles','acknowledge_source_rights',
    'acknowledge_residual_privacy_unknown','acknowledge_masked_pixels']);
  ensure(input.acknowledge_source_rights===true&&
    input.acknowledge_residual_privacy_unknown===true&&
    input.acknowledge_masked_pixels===true,
    'Operator must separately authorize rights, explicit masks and residual privacy UNKNOWN',
    'ConsentRequired');
  ensure(['owned','licensed'].includes(input.rights),
    'Rights must be explicitly declared owned/licensed','ConsentRequired');
  ensure(isSha(input.source_png_sha256),'Source requires exact SHA-256','InvalidArgument');
  ensure(Array.isArray(input.rectangles)&&input.rectangles.length>=1&&
    input.rectangles.length<=24,'One to 24 pixel masks must be supplied',
    'ResourceExhausted');
  const seen=new Set();
  for(const rect of input.rectangles){
    exactly(rect,['label','x','y','width','height']);
    ensure(typeof rect.label==='string'&&/^[a-z][a-z0-9_-]{1,45}$/u.test(rect.label)&&
      !seen.has(rect.label),'Pixel mask label must be bounded and unique',
      'InvalidArgument');
    seen.add(rect.label);
    for(const k of ['x','y','width','height'])ensure(
      Number.isSafeInteger(rect[k])&&rect[k]>=0&&
      (k==='x'||k==='y'||rect[k]>=1),
      'Pixel mask coordinate is not a nonnegative integer','InvalidArgument');
  }
}
function loadSource(path,pinned){
  const raw=readFileSync(privateInput(path));
  ensure(sha(raw)===pinned,'Source PNG changed since operator review','Conflict');
  ensure(raw.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&
    raw.subarray(12,16).toString()==='IHDR',
    'Source is not a real PNG with IHDR','InvalidArgument');
  const width=raw.readUInt32BE(16),height=raw.readUInt32BE(20);
  ensure(width>0&&height>0&&width<=MAX_WIDTH&&height<=MAX_HEIGHT&&
    width*height<=MAX_PIXELS,
    'Uncompressed source dimensions exceed the declared pixel budget',
    'ResourceExhausted');
  let png;
  try{png=PNG.sync.read(raw,{checkCRC:true});}
  catch{throw new NativeError('InvalidArgument','Source PNG cannot be decoded safely');}
  ensure(png.width===width&&png.height===height&&png.data.length===width*height*4,
    'Decoded PNG dimensions do not match IHDR','Conflict');
  for(let i=3;i<png.data.length;i+=4)
    ensure(png.data[i]===255,
      'Input screenshot alpha is unsupported; flatten only with independently approved source',
      'InvalidArgument');
  return{raw,width,height,pixels:Buffer.from(png.data)};
}
function masksFor(rects,width,height){
  let covered=0;
  for(const mask of rects){
    ensure(mask.x+mask.width<=width&&mask.y+mask.height<=height,
      'Pixel mask exceeds the source image bounds','InvalidArgument');
    for(const prior of rects){
      if(prior===mask)break;
      const overlap=mask.x<prior.x+prior.width &&
        mask.x+mask.width>prior.x &&
        mask.y<prior.y+prior.height&&mask.y+mask.height>prior.y;
      ensure(!overlap,'Overlapping masks must be resolved by the operator','Conflict');
    }
    covered+=mask.width*mask.height;
  }
  ensure(covered>0&&covered*5<=width*height*3,
    'Masked pixels exceed 60% of the screenshot; use a different approved input',
    'ResourceExhausted');
  return covered;
}
function maskPixels(original,rectangles,width,height){
  const coverage=masksFor(rectangles,width,height);
  const masked=Buffer.from(original),area=new Uint8Array(width*height);
  let changed=0;
  for(const m of rectangles){
    for(let y=m.y;y<m.y+m.height;y++){
      for(let x=m.x;x<m.x+m.width;x++){
        const index=y*width+x,idx=index*4;
        area[index]=1;
        for(let c=0;c<4;c++){
          if(masked[idx+c]!==FILL[c])changed++;
          masked[idx+c]=FILL[c];
        }
      }
    }
  }
  for(let i=0;i<area.length;i++){
    const offset=i*4;
    if(area[i]){
      for(let c=0;c<4;c++)ensure(masked[offset+c]===FILL[c],
        'Masked pixel differs from opaque safe fill','Conflict');
    }else{
      for(let c=0;c<4;c++)ensure(masked[offset+c]===original[offset+c],
        'Unmasked source pixel was modified','Conflict');
    }
  }
  const output=PNG.sync.write({
    width,height,data:masked
  },{colorType:2,inputColorType:6,filterType:0});
  ensure(output[25]===2,'Redacted output must have no alpha channel','ProtocolMismatch');
  let parsed;
  try{parsed=PNG.sync.read(output,{checkCRC:true});}
  catch{throw new NativeError('ProtocolMismatch','Redacted PNG is undecodable');}
  ensure(parsed.width===width&&parsed.height===height&&
    parsed.data.equals(masked),
    'Redacted PNG pixels changed during source metadata stripping',
    'Conflict');
  return{
    bytes:output,maskedPixelCount:coverage,changedChannels:changed,
    totalPixels:width*height,outputPixelSha:sha(masked),
    sourcePixelSha:sha(original),outputSha:sha(output)
  };
}
function evaluate(app,input){
  inputContract(input);
  const parent=app.get(input.parent_evidence_id,'evidence');
  ensure(parent.data.evidence_type==='capture'&&
    ['actual','demo'].includes(parent.data.classification)&&
    ['CAPTURED_ACTUAL','CAPTURED_DEMO_DATA'].includes(parent.data.provenance?.capture_class)&&
    parent.data.build&&parent.data.source_id&&parent.data.target_id&&
    parent.data.scenario_id&&parent.data.release_id,
    'Only a scoped original observed/demo capture may be manually masked',
    'PermissionDenied');
  ensure(parent.data.rights===input.rights,
    'Mask output rights must match the source evidence rights','PermissionDenied');
  const source=app.get(parent.data.source_id,'source'),
    release=app.get(parent.data.release_id,'release'),
    target=app.get(parent.data.target_id,'target'),
    scenario=app.get(parent.data.scenario_id,'scenario');
  ensure(source.data.approval==='approved'&&
    source.data.product_id===release.data.product_id &&
    target.data.release_id===release.id&&scenario.data.release_id===release.id&&
    scenario.data.source_id===source.id&&scenario.data.target_id===target.id&&
    release.data.build===parent.data.build,
    'Source release, scenario, target or operator approval is not current',
    'StaleReference');
  const raw=loadSource(input.source_png_path,input.source_png_sha256);
  const derived=maskPixels(raw.pixels,input.rectangles,raw.width,raw.height);
  return{parent,source,release,target,scenario,raw,derived};
}
export function preparePixelMask(app,input){
  const x=evaluate(app,input);
  const core={
    schema_version:MASK_SCHEMA,
    parent_evidence_id:x.parent.id,
    parent_evidence_version:x.parent.version,
    parent_origin_digest:x.parent.data.origin_digest,
    release_id:x.release.id,source_id:x.source.id,
    scenario_id:x.scenario.id,target_id:x.target.id,
    source_version:x.source.version,release_version:x.release.version,
    target_version:x.target.version,scenario_version:x.scenario.version,
    build:x.release.data.build,
    source_png_sha256:input.source_png_sha256,
    source_pixel_sha256:x.derived.sourcePixelSha,
    source_png_path_sha256:sha(Buffer.from(input.source_png_path)),
    masked_png_sha256:x.derived.outputSha,
    masked_pixel_sha256:x.derived.outputPixelSha,
    rectangles:structuredClone(input.rectangles),
    width:x.raw.width,height:x.raw.height,
    total_pixels:x.derived.totalPixels,
    masked_pixels:x.derived.maskedPixelCount,
    changed_channels:x.derived.changedChannels,
    mask_coverage_fraction_x1000000:Math.round(
      x.derived.maskedPixelCount*1000000/x.derived.totalPixels),
    rights:input.rights,operator_confirmed_masks:true,
    operator_confirmed_rights:true,
    uncovered_pixels_verified_unchanged:true,
    masked_pixels_verified_opaque:true,
    metadata_chunks_removed:true,
    observed_state_eligible:false,technical_state:'UNKNOWN',
    pii_outside_masks_verified:false,
    independent_visual_review:false,platform_authority:false,
    external_publication:false
  };
  return{...core,plan_sha256:digest('pixel-mask-plan',core)};
}
export function verifyPixelMask(app,plan,input){
  validateValue(plan);
  ensure(plan&&typeof plan==='object'&&!Array.isArray(plan),
    'Pixel redaction plan must be an exact JSON object','InvalidArgument');
  const {plan_sha256,...core}=plan;
  ensure(isSha(plan_sha256)&&digest('pixel-mask-plan',core)===plan_sha256,
    'Saved pixel mask plan was modified','Conflict');
  const observed=preparePixelMask(app,input);
  ensure(JSON.stringify(observed)===JSON.stringify(plan),
    'Original source, masks, privileges or Native evidence revisions changed',
    'StaleReference');
  return observed;
}
function derivedRecord(x,plan){
  const p=x.parent.data;
  return{
    release_id:p.release_id,target_id:p.target_id,source_id:p.source_id,
    scenario_id:p.scenario_id,name:'Operator pixel-mask derivative',
    build:p.build,classification:'sanitized',rights:plan.rights,
    started_at:p.started_at,finished_at:p.finished_at,
    receipt:{
      authority:'imported',provider:'launchwright-pixel-mask',
      provider_version:'r55',operation_id:plan.plan_sha256,
      profile:'operator-local-pixel-redaction',outcome:'SUCCEEDED'
    },
    readiness:{state:'UNKNOWN',checks:[]},anchors:[],
    isolation:{context_id:'redaction-only',auth_scope:'not-applicable',mutable_state:false},
    cleanup:{policy:'none',created_resource_ids:[],removed_resource_ids:[]},
    provenance:{
      capture_class:'SANITIZED_DERIVATIVE',
      synthetic:p.provenance.synthetic===true,
      parent_evidence_id:x.parent.id,
      transformations:[{
        kind:'REDACT',operation_ref:plan.plan_sha256,
        semantic_effect:'changes-observed-state'
      }]
    },
    observations:[
      {kind:'pixel-mask',key:'output_png_sha256',
        value:plan.masked_png_sha256,source:'operator'},
      {kind:'pixel-mask',key:'masked_pixel_count',
        value:String(plan.masked_pixels),source:'operator'},
      {kind:'pixel-mask',key:'privacy_outside_masks',
        value:'UNKNOWN; only operator-selected regions were overwritten',source:'operator'}
    ]
  };
}
function findPrior(app,plan,x){
  const rows=app.list('evidence',plan.release_id).filter(item=>
    item.data.evidence_type==='capture'&&
    item.data.parent_evidence_id===plan.parent_evidence_id&&
    item.data.provenance?.transformations?.some(t=>
      t.operation_ref===plan.plan_sha256));
  ensure(rows.length<=1,'Ambiguous prior sanitized derivative evidence','Conflict');
  if(!rows.length)return null;
  const row=rows[0];
  const data=derivedRecord(x,plan);
  const expectedOrigin=digest('capture-contract-v2',{
    receipt:data.receipt,readiness:data.readiness,anchors:data.anchors,
    isolation:data.isolation,cleanup:data.cleanup,provenance:data.provenance
  });
  ensure(row.data.origin_digest===expectedOrigin&&
    row.data.release_id===plan.release_id&&
    row.data.source_id===plan.source_id&&
    row.data.scenario_id===plan.scenario_id&&
    row.data.target_id===plan.target_id&&
    row.data.build===plan.build&&
    JSON.stringify(row.data.observations)===JSON.stringify(data.observations)&&
    row.data.classification==='sanitized'&&
    row.data.rights===plan.rights&&
    row.data.observed_state_eligible===false&&
    row.data.technical==='UNKNOWN'&&
    row.data.receipt.authority==='imported'&&
    row.data.observations.some(o=>o.key==='output_png_sha256'&&
      o.value===plan.masked_png_sha256),
    'Existing derived capture receipt has incompatible content or authority',
    'Conflict');
  return row;
}
export async function withPixelMaskLock(app,task){
  const file=join(app.store.root,'.pixel-mask-apply.lock');
  let fd;
  try{fd=openSync(file,'wx',0o600);}
  catch{throw new NativeError('Conflict',
    'Another pixel-mask export is active or an abandoned lock needs manual review');}
  try{return await task();}
  finally{try{closeSync(fd);}finally{unlinkSync(file);}}
}
export async function applyPixelMask(app,plan,input,outDir,{
  confirm_plan_sha256,confirm_source_png_sha256,
  acknowledge_private_file_write=false
}={}){
  verifyPixelMask(app,plan,input);
  ensure(confirm_plan_sha256===plan.plan_sha256&&
    confirm_source_png_sha256===plan.source_png_sha256&&
    acknowledge_private_file_write===true,
    'Confirm exact original source/plan SHA and private output rights',
    'ConsentRequired');
  const dir=privateOutput(outDir);
  return withPixelMaskLock(app,async()=>{
    const x=evaluate(app,input),current=preparePixelMask(app,input);
    ensure(current.plan_sha256===plan.plan_sha256,
      'Source changed before pixel mask write','StaleReference');
    const prior=findPrior(app,plan,x);
    const prefix='launchwright-masked-'+plan.plan_sha256.slice(0,12);
    const result={
      schema_version:'launchwright-owned-pixel-mask-receipt/1',
      plan_sha256:plan.plan_sha256,
      original_evidence_id:plan.parent_evidence_id,
      original_png_sha256:plan.source_png_sha256,
      redacted_png_sha256:plan.masked_png_sha256,
      redacted_pixels_sha256:plan.masked_pixel_sha256,
      masked_pixels:plan.masked_pixels,
      total_pixels:plan.total_pixels,
      unmasked_pixels:plan.total_pixels-plan.masked_pixels,
      source_pixels_outside_mask_unchanged:true,
      opaque_mask_fill_rgb:[8,22,33],
      metadata_chunks_removed:true,technical_state:'UNKNOWN',
      independent_privacy_review:false,
      all_personal_information_removed:false,
      native_capture_class:'SANITIZED_DERIVATIVE',
      observed_state_eligible:false,
      external_service_called:false,platform_authority:false
    };
    const files=[
      {name:prefix+'.png',bytes:x.derived.bytes},
      {name:prefix+'.receipt.json',
        bytes:Buffer.from(JSON.stringify(result,null,2)+'\n')}
    ];
    for(const item of files){
      const path=join(dir,item.name);
      if(!existsSync(path))continue;
      const stat=lstatSync(path);
      ensure(stat.isFile()&&!stat.isSymbolicLink()&&
        (process.platform==='win32'||(stat.mode&0o077)===0)&&
        sha(readFileSync(path))===sha(item.bytes),
        'Preexisting masked file differs from the reviewed plan','Conflict');
    }
    let created=0;
    for(const item of files){
      const path=join(dir,item.name);
      if(existsSync(path))continue;
      writeFileSync(path,item.bytes,{flag:'wx',mode:0o600});
      created++;
    }
    const receipt=prior??(await execute(app,'capture.ingest',derivedRecord(x,plan))).entity;
    return{
      ...result,source_evidence_id:plan.parent_evidence_id,
      derived_evidence_id:receipt.id,derived_evidence_created:!prior,
      output_filename:files[0].name,receipt_filename:files[1].name,
      files_created:created,recovered:created===0&&!!prior,
      publication_authority:false
    };
  });
}
