// SPDX-License-Identifier: AGPL-3.0-only
// R56: operator-owned R55 exact pixel mask -> R44 Google Play store ZIP.
// The chain adds byte and Native receipt binding, NOT general PII truth,
// real device proof, Google account authorization or Platform publication.
import { createHash } from 'node:crypto';
import { openSync,closeSync,unlinkSync,existsSync,lstatSync,readFileSync,writeFileSync } from 'node:fs';
import { basename,isAbsolute,join } from 'node:path';
import { requireCondition as ensure,validateValue,NativeError } from '@semwright/native-sdk';
import { digest } from './base.mjs';
import { verifyPixelMask } from './pixel-redaction.mjs';
import { planStorePackage,verifyStorePackage,exportStorePackage } from './store-package.mjs';

export const MASKED_STORE_SCHEMA='launchwright-masked-google-store-plan/1';
const SHA=bytes=>createHash('sha256').update(bytes).digest('hex');
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
function exact(value,keys,required=keys){
  ensure(value&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).every(k=>keys.includes(k))&&
    required.every(k=>Object.hasOwn(value,k)),
    'Masked store handoff has missing or unsupported fields','InvalidArgument');
  return value;
}
function privateOutput(dir){
  ensure(typeof dir==='string'&&isAbsolute(dir)&&dir.length<=2048,
    'Choose a private absolute output directory','InvalidArgument');
  const st=lstatSync(dir);
  ensure(st.isDirectory()&&!st.isSymbolicLink()&&
    (process.platform==='win32'||(st.mode&0o077)===0),
    'Masked store output directory must be a real private 0700 directory',
    'PermissionDenied');
  return dir;
}
function readPrivate(file){
  const st=lstatSync(file);
  ensure(st.isFile()&&!st.isSymbolicLink()&&st.size<64*1024&&
    (process.platform==='win32'||(st.mode&0o077)===0),
    'Existing handoff receipt must be a private 0600 regular file','PermissionDenied');
  return readFileSync(file);
}
function checkMask(app,src,storeScreenshot,storeImage,storePlan,ordinal){
  exact(src,['mask_input','mask_plan','mask_receipt']);
  const mask=verifyPixelMask(app,src.mask_plan,src.mask_input);
  const r=src.mask_receipt;
  ensure(r&&typeof r==='object'&&!Array.isArray(r)&&
    r.schema_version==='launchwright-owned-pixel-mask-receipt/1'&&
    r.plan_sha256===mask.plan_sha256&&
    r.original_evidence_id===mask.parent_evidence_id&&
    r.source_evidence_id===mask.parent_evidence_id&&
    r.original_png_sha256===mask.source_png_sha256&&
    r.redacted_png_sha256===mask.masked_png_sha256&&
    r.redacted_pixels_sha256===mask.masked_pixel_sha256&&
    r.masked_pixels===mask.masked_pixels&&
    r.total_pixels===mask.total_pixels&&
    r.source_pixels_outside_mask_unchanged===true&&
    r.metadata_chunks_removed===true&&
    r.observed_state_eligible===false&&
    r.technical_state==='UNKNOWN'&&
    r.independent_privacy_review===false&&
    r.all_personal_information_removed===false&&
    r.platform_authority===false&&
    r.external_service_called===false&&
    typeof r.derived_evidence_id==='string',
    'R55 receipt must identify the exact UNKNOWN masked PNG and imported Native derivative',
    'Conflict');
  const expectedName='launchwright-masked-'+mask.plan_sha256.slice(0,12)+'.png';
  ensure(r.output_filename===expectedName&&
    basename(storeScreenshot.png.path)===expectedName&&
    storeScreenshot.png.sha256===mask.masked_png_sha256&&
    storeImage.source_png_sha256===mask.masked_png_sha256&&
    storeScreenshot.source_evidence_id===r.derived_evidence_id&&
    storeImage.evidence_id===r.derived_evidence_id,
    'Store screenshot is not the exact R55 masked PNG and Native derivative',
    'Conflict');
  const evidence=app.get(r.derived_evidence_id,'evidence');
  const masks=evidence.data.provenance?.transformations;
  ensure(evidence.data.evidence_type==='capture'&&
    evidence.data.classification==='sanitized'&&
    evidence.data.provenance?.capture_class==='SANITIZED_DERIVATIVE'&&
    evidence.data.parent_evidence_id===mask.parent_evidence_id&&
    Array.isArray(masks)&&masks.length===1&&
    masks[0].kind==='REDACT'&&
    masks[0].operation_ref===mask.plan_sha256&&
    masks[0].semantic_effect==='changes-observed-state'&&
    evidence.data.receipt?.provider==='launchwright-pixel-mask'&&
    evidence.data.receipt?.operation_id===mask.plan_sha256&&
    evidence.data.receipt?.authority==='imported'&&
    evidence.data.technical==='UNKNOWN'&&
    evidence.data.host_acceptance==='NOT_ESTABLISHED'&&
    evidence.data.observed_state_eligible===false&&
    evidence.data.rights===storePlan.source_rights&&
    evidence.data.release_id===storePlan.release_id&&
    evidence.data.target_id===storePlan.target_id&&
    evidence.data.build===storePlan.build&&
    JSON.stringify(evidence.version)===JSON.stringify(storeImage.evidence_revision)&&
    evidence.data.origin_digest===storeImage.source_origin_digest,
    'Store screenshot evidence is not the original R55 native redaction record',
    'PermissionDenied');
  const observations=evidence.data.observations??[];
  ensure(observations.some(x=>x.kind==='pixel-mask'&&
    x.key==='output_png_sha256'&&x.value===mask.masked_png_sha256)&&
    observations.some(x=>x.kind==='pixel-mask'&&
      x.key==='masked_pixel_count'&&x.value===String(mask.masked_pixels))&&
    mask.rights===storePlan.source_rights&&
    mask.width===storeImage.width&&mask.height===storeImage.height &&
    mask.width===1080&&mask.height===1920,
    'R55 mask dimensions, native pixel digest or declared rights mismatch Google Play phone profile',
    'Conflict');
  return{
    ordinal,original_capture_evidence_id:mask.parent_evidence_id,
    derived_evidence_id:r.derived_evidence_id,
    derived_evidence_version:evidence.version,
    native_origin_digest:evidence.data.origin_digest,
    pixel_mask_plan_sha256:mask.plan_sha256,
    original_png_sha256:mask.source_png_sha256,
    redacted_png_sha256:mask.masked_png_sha256,
    redacted_pixel_sha256:mask.masked_pixel_sha256,
    store_png_normalized_sha256:storeImage.normalized_sha256,
    masked_pixels:mask.masked_pixels,total_pixels:mask.total_pixels,
    changes_observed_state:true,
    independent_privacy_review:false,
    source_device_capture_admitted:false
  };
}
function collect(app,raw){
  validateValue(raw);
  exact(raw,['store_input','masked_sources',
    'acknowledge_mask_scope_only','acknowledge_private_store_only']);
  ensure(raw.acknowledge_mask_scope_only===true&&
    raw.acknowledge_private_store_only===true,
    'Operator must separately acknowledge mask-only privacy and no store publication',
    'ConsentRequired');
  const input=raw.store_input;
  ensure(input?.platform==='google-play-phone-portrait',
    'Only R55-sized Google Play phone portrait screenshots are supported',
    'PermissionDenied');
  const store=planStorePackage(app,input);
  verifyStorePackage(app,store,input);
  ensure(store.platform==='google-play-phone-portrait'&&
    store.channel==='google-play-draft'&&
    store.source_rights===input.source_rights&&
    store.independent_pixel_privacy_pass===false&&
    store.store_api_upload_performed===false,
    'R44 store plan must be the exact private Google Play phone subset',
    'Conflict');
  ensure(Array.isArray(raw.masked_sources)&&
    raw.masked_sources.length===store.screenshot_count,
    'Every Google Play screenshot requires one R55 masked source and Native receipt',
    'ResourceExhausted');
  const chains=[];
  for(let i=0;i<store.screenshot_count;i++)
    chains.push(checkMask(app,raw.masked_sources[i],input.screenshots[i],
      store.screenshots[i],store,i+1));
  ensure(new Set(chains.map(x=>x.pixel_mask_plan_sha256)).size===chains.length&&
    new Set(chains.map(x=>x.derived_evidence_id)).size===chains.length,
    'Duplicate R55 mask source or derivative may not fill multiple store screenshot slots',
    'Conflict');
  return{store,chains};
}
export function planMaskedStore(app,raw){
  const {store,chains}=collect(app,raw);
  const core={
    schema_version:MASKED_STORE_SCHEMA,
    store_plan_sha256:store.plan_sha256,
    candidate_id:store.candidate_id,candidate_sha256:store.candidate_sha256,
    release_id:store.release_id,build:store.build,
    locale:store.locale,device:store.device,
    screenshot_count:chains.length,masked_sources:chains,
    rights_operator_declared:true,
    pixels_outside_explicit_masks_independently_verified_unchanged:true,
    all_personal_information_removed:false,
    privacy_outside_masks_verified:false,
    source_device_attestation:false,
    store_account_accepted:false,external_store_upload_performed:false,
    store_publication_performed:false,platform_authority:false,
    technical_state:'UNKNOWN'
  };
  return{...core,plan_sha256:digest('masked-store-handoff',core)};
}
export function verifyMaskedStore(app,plan,raw){
  validateValue(plan);
  ensure(plan&&typeof plan==='object'&&!Array.isArray(plan),
    'Masked store plan must be an exact object','InvalidArgument');
  const {plan_sha256,...core}=plan;
  ensure(hex(plan_sha256)&&digest('masked-store-handoff',core)===plan_sha256,
    'Saved R55-to-R44 masked store plan bytes changed','Conflict');
  const current=planMaskedStore(app,raw);
  ensure(JSON.stringify(current)===JSON.stringify(plan),
    'Store, Native derivative, pixel masks, local paths or source revisions changed',
    'StaleReference');
  return plan;
}
export async function withMaskedStoreLock(app,task){
  const file=join(app.store.root,'.masked-store-apply.lock');
  let fd;
  try{fd=openSync(file,'wx',0o600);}
  catch{throw new NativeError('Conflict',
    'A masked store export is active or an abandoned lock needs operator review');}
  try{return await task();}
  finally{try{closeSync(fd);}finally{unlinkSync(file);}}
}
export async function exportMaskedStore(app,plan,raw,outdir,{
  confirm_handoff_sha256,confirm_store_plan_sha256,
  confirm_candidate_sha256,acknowledge_private_export=false,
  acknowledge_remaining_privacy_unknown=false
}={}){
  verifyMaskedStore(app,plan,raw);
  ensure(confirm_handoff_sha256===plan.plan_sha256&&
    confirm_store_plan_sha256===plan.store_plan_sha256&&
    confirm_candidate_sha256===plan.candidate_sha256&&
    acknowledge_private_export===true&&
    acknowledge_remaining_privacy_unknown===true,
    'Operator must confirm handoff/store/candidate digests and incomplete privacy verification',
    'ConsentRequired');
  const dir=privateOutput(outdir);
  return withMaskedStoreLock(app,async()=>{
    verifyMaskedStore(app,plan,raw);
    const receiptName='launchwright-masked-store-'+plan.plan_sha256.slice(0,12)+'.receipt.json';
    const proofPath=join(dir,receiptName);
    if(existsSync(proofPath)){
      const old=JSON.parse(readPrivate(proofPath));
      ensure(old?.schema_version==='launchwright-masked-store-receipt/1'&&
        old.plan_sha256===plan.plan_sha256&&
        old.store_plan_sha256===plan.store_plan_sha256&&
        old.candidate_sha256===plan.candidate_sha256,
        'Preexisting masked store receipt belongs to another source intent',
        'Conflict');
    }
    const storePlan=planStorePackage(app,raw.store_input);
    ensure(storePlan.plan_sha256===plan.store_plan_sha256,
      'R44 source plan changed before store package output','StaleReference');
    const result=await exportStorePackage(app,storePlan,raw.store_input,dir,{
      confirm_plan_sha256:storePlan.plan_sha256,
      confirm_candidate_sha256:storePlan.candidate_sha256,
      acknowledge_private_export:true
    });
    verifyMaskedStore(app,plan,raw);
    ensure(result.technical_state==='UNKNOWN'&&
      result.store_api_upload_performed===false&&
      result.platform_authority===false,
      'Native R44 result cannot promote imported mask evidence to verified/published',
      'Conflict');
    const proof={
      schema_version:'launchwright-masked-store-receipt/1',
      plan_sha256:plan.plan_sha256,
      store_plan_sha256:plan.store_plan_sha256,
      candidate_sha256:plan.candidate_sha256,
      store_zip_filename:result.filename,
      store_zip_sha256:result.zip_sha256,
      screenshot_count:plan.screenshot_count,
      masked_sources:plan.masked_sources,
      exact_native_redaction_bytes_bound:true,
      pixels_outside_masks_verified_unchanged:true,
      privacy_outside_masks_verified:false,
      graphics_independent_privacy_review:false,
      source_device_attestation:false,
      technical_state:'UNKNOWN',
      store_api_upload_performed:false,
      store_publication_performed:false,
      platform_authority:false
    };
    const bytes=Buffer.from(JSON.stringify(proof,null,2)+'\n');
    if(existsSync(proofPath))ensure(readPrivate(proofPath).equals(bytes),
      'Existing masked store proof was modified; no overwrite','Conflict');
    let created=false;
    if(!existsSync(proofPath)){
      writeFileSync(proofPath,bytes,{flag:'wx',mode:0o600});
      created=true;
    }
    return{
      ...proof,proof_filename:receiptName,
      proof_created:created,store_files_created:result.files_created,
      store_bundle_recovered:result.recovered,
      recovered:!created&&result.files_created===0,
      remote_actions_performed:false
    };
  });
}
