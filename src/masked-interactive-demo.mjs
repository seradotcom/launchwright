// SPDX-License-Identifier: AGPL-3.0-only
// R59: exact R55 opaque-mask / Native derivative proof to the existing R43
// HTML-only offline viewer. Not a second media runtime or privacy oracle.
import { createHash } from 'node:crypto';
import { existsSync,lstatSync,readFileSync,writeFileSync } from 'node:fs';
import { isAbsolute,join } from 'node:path';
import JSZip from 'jszip';
import { PNG } from 'pngjs';
import { requireCondition as ensure,validateValue,NativeError } from '@semwright/native-sdk';
import { digest } from './base.mjs';
import { verifyPixelMask } from './pixel-redaction.mjs';
import {
  planInteractiveDemo,verifyInteractiveDemo,
  inspectInteractiveDemoSource,withInteractiveDemoLock
} from './interactive-demo.mjs';
import { renderOfflineDemo } from './interactive-demo-view.mjs';
import { execute } from './application.mjs';

export const MASKED_DEMO_SCHEMA='launchwright-r59-masked-interactive-demo/1';
const sha=v=>createHash('sha256').update(v).digest('hex');
const isSha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
const exact=(raw,fields,required=fields)=>{
  ensure(raw&&typeof raw==='object'&&!Array.isArray(raw)&&
    Object.keys(raw).every(k=>fields.includes(k))&&required.every(k=>Object.hasOwn(raw,k)),
    'Masked offline demo has missing or unsupported fields','InvalidArgument');
};
const receiptFields=[
  'schema_version','plan_sha256','original_evidence_id','original_png_sha256',
  'redacted_png_sha256','redacted_pixels_sha256','masked_pixels',
  'total_pixels','unmasked_pixels','source_pixels_outside_mask_unchanged',
  'opaque_mask_fill_rgb','metadata_chunks_removed','technical_state',
  'independent_privacy_review','all_personal_information_removed',
  'native_capture_class','observed_state_eligible','external_service_called',
  'platform_authority','source_evidence_id','derived_evidence_id',
  'derived_evidence_created','output_filename','receipt_filename',
  'files_created','recovered','publication_authority'
];
function privateDir(path){
  ensure(typeof path==='string'&&isAbsolute(path)&&path.length<=2048,
    'Choose a pre-existing private absolute masked demo directory','InvalidArgument');
  const stat=lstatSync(path);
  ensure(stat.isDirectory()&&!stat.isSymbolicLink()&&
    (process.platform==='win32'||(stat.mode&0o077)===0),
    'Masked demo output must be real owner-only 0700 directory','PermissionDenied');
  return path;
}
function collect(app,raw){
  validateValue(raw);
  exact(raw,['demo_input','masked_sources','acknowledge_mask_scope_only','acknowledge_private_only']);
  ensure(raw.acknowledge_mask_scope_only===true&&raw.acknowledge_private_only===true,
    'Operator must acknowledge masks cover selected pixels only and private-only delivery',
    'ConsentRequired');
  const base=planInteractiveDemo(app,raw.demo_input);
  const data=inspectInteractiveDemoSource(app,raw.demo_input);
  ensure(Array.isArray(raw.masked_sources)&&
    raw.masked_sources.length===base.frame_count&&
    raw.masked_sources.length>=2&&raw.masked_sources.length<=8,
    'Exactly one R55 pixel mask per R43 sanitized Media screenshot is required',
    'ResourceExhausted');
  const used=new Set(),proofs=[];
  for(let i=0;i<raw.masked_sources.length;i++){
    const item=raw.masked_sources[i];
    exact(item,['mask_input','mask_plan','mask_receipt','masked_png_path']);
    const mask=verifyPixelMask(app,item.mask_plan,item.mask_input);
    const receipt=item.mask_receipt;
    exact(receipt,receiptFields);
    ensure(receipt.schema_version==='launchwright-owned-pixel-mask-receipt/1'&&
      receipt.plan_sha256===mask.plan_sha256&&
      receipt.original_evidence_id===mask.parent_evidence_id&&
      receipt.source_evidence_id===mask.parent_evidence_id&&
      receipt.original_png_sha256===mask.source_png_sha256&&
      receipt.masked_pixels===mask.masked_pixels&&
      receipt.total_pixels===mask.total_pixels&&
      receipt.unmasked_pixels===mask.total_pixels-mask.masked_pixels&&
      JSON.stringify(receipt.opaque_mask_fill_rgb)===JSON.stringify([8,22,33])&&
      receipt.native_capture_class==='SANITIZED_DERIVATIVE'&&
      receipt.external_service_called===false&&
      receipt.platform_authority===false&&
      receipt.publication_authority===false&&
      receipt.output_filename==='launchwright-masked-'+mask.plan_sha256.slice(0,12)+'.png'&&
      receipt.receipt_filename==='launchwright-masked-'+mask.plan_sha256.slice(0,12)+'.receipt.json'&&
      Number.isSafeInteger(receipt.files_created)&&
      receipt.files_created>=0&&receipt.files_created<=2&&
      typeof receipt.derived_evidence_created==='boolean'&&
      typeof receipt.recovered==='boolean'&&
      receipt.redacted_png_sha256===mask.masked_png_sha256&&
      receipt.redacted_pixels_sha256===mask.masked_pixel_sha256&&
      receipt.source_pixels_outside_mask_unchanged===true&&
      receipt.metadata_chunks_removed===true&&
      receipt.technical_state==='UNKNOWN'&&
      receipt.independent_privacy_review===false&&
      receipt.all_personal_information_removed===false&&
      receipt.observed_state_eligible===false,
      'R55 source/receipt identity or UNKNOWN privacy boundary is invalid',
      'Conflict');
    const r43frame=raw.demo_input.frames[i];
    ensure(r43frame.source_evidence_id===receipt.derived_evidence_id&&
      r43frame.png_path===item.masked_png_path&&
      r43frame.png_sha256===mask.masked_png_sha256&&
      base.frames[i].source_evidence_id===receipt.derived_evidence_id&&
      base.frames[i].screenshot_sha256===mask.masked_png_sha256,
      'Offline step does not use the exact indexed R55 masked PNG and Native derivative',
      'Conflict');
    ensure(!used.has(receipt.derived_evidence_id)&&
      !used.has(mask.plan_sha256),'Masked source cannot impersonate multiple steps','Conflict');
    used.add(receipt.derived_evidence_id);used.add(mask.plan_sha256);
    const evidence=app.get(receipt.derived_evidence_id,'evidence');
    const transformation=evidence.data.provenance?.transformations;
    ensure(evidence.data.evidence_type==='capture'&&
      evidence.data.classification==='sanitized'&&
      evidence.data.provenance?.capture_class==='SANITIZED_DERIVATIVE'&&
      evidence.data.parent_evidence_id===mask.parent_evidence_id&&
      Array.isArray(transformation)&&transformation.length===1&&
      transformation[0].kind==='REDACT'&&
      transformation[0].operation_ref===mask.plan_sha256&&
      transformation[0].semantic_effect==='changes-observed-state'&&
      evidence.data.receipt?.provider==='launchwright-pixel-mask'&&
      evidence.data.receipt?.operation_id===mask.plan_sha256&&
      evidence.data.receipt?.authority==='imported'&&
      evidence.data.technical==='UNKNOWN'&&
      evidence.data.host_acceptance==='NOT_ESTABLISHED'&&
      evidence.data.observed_state_eligible===false&&
      evidence.data.release_id===base.release_id&&
      evidence.data.target_id===data.plan.data.target_id&&
      evidence.data.scenario_id===data.plan.data.scenario_id&&
      evidence.data.build===data.release.data.build&&
      evidence.data.rights===mask.rights&&
      evidence.data.rights===raw.demo_input.source_rights&&
      evidence.data.observations?.some(o=>o.kind==='pixel-mask'&&
        o.key==='output_png_sha256'&&o.value===mask.masked_png_sha256),
      'Media source is not the exact current R55 Native sanitized derivative',
      'PermissionDenied');
    ensure(mask.release_id===base.release_id&&
      mask.target_id===data.plan.data.target_id&&
      mask.scenario_id===data.plan.data.scenario_id&&
      mask.build===data.release.data.build&&
      mask.width===base.width&&mask.height===base.height&&
      mask.masked_pixels>0&&
      mask.masked_pixels_verified_opaque===true&&
      mask.uncovered_pixels_verified_unchanged===true&&
      mask.pii_outside_masks_verified===false,
      'R55 mask is not a current same-release pixel-exact mask','Conflict');
    const encoded=data.frames[i].png;
    const pixel=PNG.sync.read(encoded,{checkCRC:true});
    ensure(sha(pixel.data)===mask.masked_pixel_sha256,
      'Rendered R43 screenshot pixels do not match R55 opaque-masked output',
      'Conflict');
    proofs.push({
      ordinal:i+1,shot_id:r43frame.shot_id,
      parent_evidence_id:mask.parent_evidence_id,
      derived_evidence_id:evidence.id,
      derived_evidence_version:evidence.version,
      derived_origin_digest:evidence.data.origin_digest,
      r55_plan_sha256:mask.plan_sha256,
      original_png_sha256:mask.source_png_sha256,
      masked_png_sha256:mask.masked_png_sha256,
      masked_pixel_sha256:mask.masked_pixel_sha256,
      redacted_path_sha256:sha(Buffer.from(item.masked_png_path)),
      mask_rectangles:mask.rectangles.length,
      masked_pixels:mask.masked_pixels,width:mask.width,height:mask.height,
      rights:mask.rights,
      scope_only:true,privacy_outside_masks:'UNKNOWN',
      independent_device_origin:false,host_acceptance:false
    });
  }
  return{base,data,proofs};
}
export function planMaskedInteractiveDemo(app,request){
  const x=collect(app,request);
  const core={
    schema_version:MASKED_DEMO_SCHEMA,
    r43_plan_sha256:x.base.plan_sha256,
    media_plan_id:x.base.media_plan_id,
    media_plan_digest:x.base.media_plan_digest,
    variant_id:x.base.variant_id,
    release_id:x.base.release_id,
    build:x.data.release.data.build,
    width:x.base.width,height:x.base.height,
    frame_count:x.base.frame_count,
    masks:x.proofs,
    operator_mask_scope_acknowledged:true,
    private_only:true,
    technical_state:'UNKNOWN',
    privacy_outside_masks_verified:false,
    customer_capture_accepted:false,
    device_origin_accepted:false,
    external_publication:false,platform_authority:false
  };
  return{...core,plan_sha256:digest('masked-interactive-demo',core)};
}
export function verifyMaskedInteractiveDemo(app,plan,request){
  validateValue(plan);
  exact(plan,['schema_version','r43_plan_sha256','media_plan_id',
    'media_plan_digest','variant_id','release_id','build','width','height',
    'frame_count','masks','operator_mask_scope_acknowledged','private_only',
    'technical_state','privacy_outside_masks_verified','customer_capture_accepted',
    'device_origin_accepted','external_publication','platform_authority','plan_sha256']);
  const{plan_sha256,...core}=plan;
  ensure(isSha(plan_sha256)&&digest('masked-interactive-demo',core)===plan_sha256,
    'Saved masked interactive demo intent was changed','Conflict');
  const expected=planMaskedInteractiveDemo(app,request);
  ensure(JSON.stringify(expected)===JSON.stringify(plan),
    'R43 Media, R55 pixels, Native derivative, rights or source version changed',
    'StaleReference');
  return plan;
}
async function packageMaskedOfflineDemo(x,plan){
  const original=await renderOfflineDemo(x.data,x.base);
  const zip=await JSZip.loadAsync(original.bytes,{checkCRC32:true});
  const files=Object.keys(zip.files).sort();
  ensure(JSON.stringify(files)===JSON.stringify(['README.txt','index.html','manifest.json']),
    'R43 source ZIP contains unsupported files','ProtocolMismatch');
  const currentManifest=JSON.parse(await zip.file('manifest.json').async('string'));
  ensure(currentManifest.plan_sha256===plan.r43_plan_sha256&&
    currentManifest.html_sha256===original.html_sha256,
    'R43 source manifest changed before mask lineage handoff','Conflict');
  const maskedManifest={
    ...currentManifest,
    r59_masked_demo_schema:MASKED_DEMO_SCHEMA,
    r59_plan_sha256:plan.plan_sha256,
    r55_mask_chain:plan.masks.map(p=>({...p})),
    r55_only_selected_rectangles_verified:true,
    pixels_outside_masks_independently_private:false,
    opaque_mask_pixels_checked:true,
    source_scripts_executed:false,external_publication:false,
    technical_state:'UNKNOWN',platform_authority:false
  };
  const epoch=new Date('2000-01-01T00:00:00.000Z');
  zip.file('manifest.json',JSON.stringify(maskedManifest,null,2)+'\n',{
    date:epoch,unixPermissions:'0600'
  });
  for(const entry of Object.values(zip.files))entry.date=epoch;
  const bytes=Buffer.from(await zip.generateAsync({
    type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6},
    platform:'UNIX'
  }));
  ensure(bytes.length<=21*1024*1024,'Masked offline ZIP exceeds package budget','ResourceExhausted');
  const reread=await JSZip.loadAsync(bytes,{checkCRC32:true});
  const manifest=JSON.parse(await reread.file('manifest.json').async('string'));
  const html=await reread.file('index.html').async('nodebuffer');
  ensure(sha(html)===original.html_sha256&&
    JSON.stringify(manifest.r55_mask_chain)===JSON.stringify(plan.masks)&&
    manifest.r59_plan_sha256===plan.plan_sha256&&
    manifest.script_execution_permitted===false&&
    manifest.technical_state==='UNKNOWN',
    'Rendered masked offline bundle failed source/pixel lineage readback','Conflict');
  return{bytes,zip_sha256:sha(bytes),html_sha256:sha(html),manifest};
}
function privateOutput(dir){
  ensure(typeof dir==='string'&&isAbsolute(dir)&&dir.length<=2048,
    'Choose pre-existing private absolute demo output folder','InvalidArgument');
  const info=lstatSync(dir);
  ensure(info.isDirectory()&&!info.isSymbolicLink()&&
    (process.platform==='win32'||(info.mode&0o077)===0),
    'Masked offline output directory requires owner-only 0700 permissions',
    'PermissionDenied');
  return dir;
}
export async function exportMaskedInteractiveDemo(app,plan,request,outDir,{
  confirm_plan_sha256,confirm_media_plan_digest,
  acknowledge_private_export=false,
  acknowledge_privacy_outside_masks_unknown=false
}={}){
  verifyMaskedInteractiveDemo(app,plan,request);
  ensure(confirm_plan_sha256===plan.plan_sha256&&
    confirm_media_plan_digest===plan.media_plan_digest&&
    acknowledge_private_export===true&&
    acknowledge_privacy_outside_masks_unknown===true,
    'Confirm exact masked plan, Media digest, private export and residual privacy UNKNOWN',
    'ConsentRequired');
  const dir=privateOutput(outDir);
  // Use exactly the same exclusive local lock as the legacy R43 exporter.
  return withInteractiveDemoLock(app.store.root,async()=>{
    const x=collect(app,request);
    const output=await packageMaskedOfflineDemo(x,plan);
    const former=app.list('media_output',x.data.release.id).filter(row=>
      row.data.plan_id===x.data.plan.id&&row.data.variant_id===x.data.variant.id);
    ensure(former.length<=1&&(!former.length||(
      former[0].data.artifact_sha256===output.zip_sha256&&
      former[0].data.authority==='imported'&&
      former[0].data.provider==='launchwright-r59-masked-offline'&&
      former[0].data.technical_effective==='UNKNOWN')),
      'Another output claims this Media variant; never overwrite its Native receipt','Conflict');
    const prefix='launchwright-masked-demo-'+plan.plan_sha256.slice(0,12);
    const receipt={
      schema_version:'launchwright-masked-interactive-demo-receipt/1',
      plan_sha256:plan.plan_sha256,
      r43_plan_sha256:plan.r43_plan_sha256,
      media_plan_id:plan.media_plan_id,
      media_plan_digest:plan.media_plan_digest,
      variant_id:plan.variant_id,
      source_lineage:plan.masks,
      offline_zip_sha256:output.zip_sha256,
      html_sha256:output.html_sha256,
      mask_scope_only:true,
      masked_pixels_verified_opaque:true,
      pixels_outside_masks_unchanged:true,
      remaining_pixel_privacy_unknown:true,
      technical_state:'UNKNOWN',
      external_publication:false,platform_authority:false,
      customer_acceptance:false
    };
    const files=[
      {name:prefix+'.zip',bytes:output.bytes},
      {name:prefix+'.receipt.json',bytes:Buffer.from(JSON.stringify(receipt,null,2)+'\n')}
    ];
    for(const item of files){
      const path=join(dir,item.name);
      if(!existsSync(path))continue;
      const stat=lstatSync(path);
      ensure(stat.isFile()&&!stat.isSymbolicLink()&&
        (process.platform==='win32'||(stat.mode&0o077)===0)&&
        sha(readFileSync(path))===sha(item.bytes),
        'Existing masked demo files differ from the exact source; no clobber',
        'Conflict');
    }
    let created=0;
    for(const item of files){
      const path=join(dir,item.name);
      if(existsSync(path))continue;
      writeFileSync(path,item.bytes,{flag:'wx',mode:0o600});
      created++;
    }
    const entry=former[0]??(await execute(app,'media.output_record',{
      plan_id:x.data.plan.id,variant_id:x.data.variant.id,
      state:'SUCCEEDED',authority:'imported',
      provider:'launchwright-r59-masked-offline',provider_version:'r59',
      artifact_sha256:output.zip_sha256,mime:'application/zip',
      observed_at:new Date().toISOString(),reported_verification:'UNKNOWN'
    })).entity;
    return{
      schema_version:'launchwright-r59-masked-interactive-demo-export/1',
      plan_sha256:plan.plan_sha256,
      bundle_filename:files[0].name,
      bundle_sha256:output.zip_sha256,
      media_output_id:entry.id,media_output_created:former.length===0,
      files_created:created,recovered:created===0,
      mask_proof_count:plan.masks.length,
      technical_state:'UNKNOWN',
      independent_privacy_approval:false,
      source_application_execution:false,
      remote_network:false,external_publication:false,
      platform_authority:false
    };
  });
}
