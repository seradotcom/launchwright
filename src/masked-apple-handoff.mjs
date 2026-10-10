// SPDX-License-Identifier: AGPL-3.0-only
// R58: exact R55 pixel masks + Native SANITIZED_DERIVATIVE -> R44 Apple ZIP
// -> bounded R51 App Store Connect screenshot intent. This proves only
// operator-selected rectangles, NEVER general PII clearance/device authority.
import { createHash } from 'node:crypto';
import { openSync,closeSync,unlinkSync,existsSync,lstatSync,
  readFileSync,writeFileSync } from 'node:fs';
import { basename,isAbsolute,join } from 'node:path';
import JSZip from 'jszip';
import { PNG } from 'pngjs';
import { requireCondition as ensure,validateValue,NativeError } from '@semwright/native-sdk';
import { digest } from './base.mjs';
import { verifyPixelMask } from './pixel-redaction.mjs';
import { planStorePackage,verifyStorePackage,exportStorePackage } from './store-package.mjs';
import { prepareAppleScreenshotUpload,verifyAppleScreenshotUpload,sendAppleScreenshotUpload }
  from './apple-screenshot-upload.mjs';

export const MASKED_APPLE_SCHEMA='launchwright-masked-apple-asset-handoff/1';
const sha=b=>createHash('sha256').update(b).digest('hex');
const isSHA=v=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
function exact(value,keys){
  ensure(value&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).length===keys.length &&
    keys.every(k=>Object.hasOwn(value,k)),
    'Masked Apple handoff requires exact fields','InvalidArgument');
}
function privateDir(value){
  ensure(typeof value==='string'&&isAbsolute(value)&&value.length<=2048,
    'Choose an existing private absolute output directory','InvalidArgument');
  const stat=lstatSync(value);
  ensure(stat.isDirectory()&&!stat.isSymbolicLink()&&
    (process.platform==='win32'||(stat.mode&0o077)===0),
    'Masked Apple handoff requires a real private 0700 directory','PermissionDenied');
  return value;
}
function savedReceipt(file){
  const st=lstatSync(file);
  ensure(st.isFile()&&!st.isSymbolicLink()&&st.size<=80*1024&&
    (process.platform==='win32'||(st.mode&0o077)===0),
    'Existing Apple proof must be a private 0600 regular file','PermissionDenied');
  return readFileSync(file);
}
function maskSource(app,src,screen,image,plan,ordinal){
  exact(src,['mask_input','mask_plan','mask_receipt']);
  const mask=verifyPixelMask(app,src.mask_plan,src.mask_input);
  const receipt=src.mask_receipt;
  ensure(receipt?.schema_version==='launchwright-owned-pixel-mask-receipt/1'&&
    receipt.plan_sha256===mask.plan_sha256&&
    receipt.original_evidence_id===mask.parent_evidence_id&&
    receipt.source_evidence_id===mask.parent_evidence_id&&
    receipt.original_png_sha256===mask.source_png_sha256&&
    receipt.redacted_png_sha256===mask.masked_png_sha256&&
    receipt.redacted_pixels_sha256===mask.masked_pixel_sha256&&
    receipt.masked_pixels===mask.masked_pixels&&
    receipt.total_pixels===mask.total_pixels&&
    receipt.source_pixels_outside_mask_unchanged===true&&
    receipt.metadata_chunks_removed===true&&
    receipt.observed_state_eligible===false&&
    receipt.technical_state==='UNKNOWN'&&
    receipt.independent_privacy_review===false&&
    receipt.all_personal_information_removed===false&&
    receipt.platform_authority===false&&
    receipt.external_service_called===false&&
    typeof receipt.derived_evidence_id==='string',
    'R55 mask and Native-derived receipt must describe the exact same source pixels',
    'Conflict');
  const maskFile='launchwright-masked-'+mask.plan_sha256.slice(0,12)+'.png';
  ensure(receipt.output_filename===maskFile&&
    basename(screen.png.path)===maskFile&&
    screen.png.sha256===mask.masked_png_sha256&&
    image.source_png_sha256===mask.masked_png_sha256&&
    screen.source_evidence_id===receipt.derived_evidence_id&&
    image.evidence_id===receipt.derived_evidence_id,
    'R44 Apple screenshot is not the exact R55 opaque-masked PNG',
    'Conflict');
  const derivative=app.get(receipt.derived_evidence_id,'evidence');
  const transformations=derivative.data.provenance?.transformations;
  ensure(derivative.data.evidence_type==='capture'&&
    derivative.data.classification==='sanitized'&&
    derivative.data.provenance.capture_class==='SANITIZED_DERIVATIVE'&&
    derivative.data.parent_evidence_id===mask.parent_evidence_id&&
    Array.isArray(transformations)&&transformations.length===1&&
    transformations[0].kind==='REDACT'&&
    transformations[0].operation_ref===mask.plan_sha256&&
    transformations[0].semantic_effect==='changes-observed-state'&&
    derivative.data.receipt?.provider==='launchwright-pixel-mask'&&
    derivative.data.receipt?.operation_id===mask.plan_sha256&&
    derivative.data.receipt?.authority==='imported'&&
    derivative.data.technical==='UNKNOWN'&&
    derivative.data.host_acceptance==='NOT_ESTABLISHED'&&
    derivative.data.observed_state_eligible===false&&
    derivative.data.rights===plan.source_rights&&
    derivative.data.release_id===plan.release_id&&
    derivative.data.target_id===plan.target_id&&
    derivative.data.build===plan.build&&
    JSON.stringify(derivative.version)===JSON.stringify(image.evidence_revision)&&
    derivative.data.origin_digest===image.source_origin_digest,
    'R55 Native derivative authority or scoped revision mismatches Apple listing',
    'PermissionDenied');
  const observations=derivative.data.observations??[];
  ensure(observations.some(o=>o.kind==='pixel-mask'&&
    o.key==='output_png_sha256'&&o.value===mask.masked_png_sha256)&&
    observations.some(o=>o.kind==='pixel-mask'&&
      o.key==='masked_pixel_count'&&o.value===String(mask.masked_pixels))&&
    mask.rights===plan.source_rights&&
    mask.width===image.width&&mask.height===image.height&&
    ((mask.width===1179&&mask.height===2556)||
     (mask.width===1206&&mask.height===2622)),
    'Apple screenshots must preserve exact allowed R55 pixels and Native observations',
    'Conflict');
  return{
    ordinal,original_capture_evidence_id:mask.parent_evidence_id,
    derived_evidence_id:receipt.derived_evidence_id,
    derived_evidence_version:derivative.version,
    native_origin_digest:derivative.data.origin_digest,
    pixel_mask_plan_sha256:mask.plan_sha256,
    original_png_sha256:mask.source_png_sha256,
    redacted_png_sha256:mask.masked_png_sha256,
    redacted_pixel_sha256:mask.masked_pixel_sha256,
    store_png_normalized_sha256:image.normalized_sha256,
    masked_pixels:mask.masked_pixels,total_pixels:mask.total_pixels,
    changes_observed_state:true,technical_state:'UNKNOWN',
    privacy_outside_masks_verified:false,source_device_attested:false
  };
}
function collect(app,raw){
  validateValue(raw);
  exact(raw,['store_input','masked_sources',
    'acknowledge_mask_scope_only','acknowledge_private_apple_only']);
  ensure(raw.acknowledge_mask_scope_only===true&&
    raw.acknowledge_private_apple_only===true,
    'Operator must acknowledge mask-only privacy and private Apple asset staging',
    'ConsentRequired');
  const input=raw.store_input;
  ensure(input?.platform==='apple-iphone-dynamic-island-medium',
    'Only approved R44 Apple iPhone screenshot profile is supported',
    'PermissionDenied');
  const store=planStorePackage(app,input);
  verifyStorePackage(app,store,input);
  ensure(store.platform==='apple-iphone-dynamic-island-medium'&&
    store.channel==='app-store-connect-draft'&&
    store.source_rights===input.source_rights&&
    store.independent_pixel_privacy_pass===false&&
    store.store_api_upload_performed===false,
    'R44 App Store source may not claim pixel privacy or remote publication',
    'Conflict');
  ensure(Array.isArray(raw.masked_sources)&&
    raw.masked_sources.length===store.screenshot_count,
    'Every App Store screenshot requires its own exact R55 mask/Native source',
    'ResourceExhausted');
  const chains=raw.masked_sources.map((source,i)=>
    maskSource(app,source,input.screenshots[i],store.screenshots[i],store,i+1));
  ensure(new Set(chains.map(x=>x.pixel_mask_plan_sha256)).size===chains.length&&
    new Set(chains.map(x=>x.derived_evidence_id)).size===chains.length,
    'Duplicate redacted source/evidence cannot fill multiple Apple screenshots',
    'Conflict');
  return{store,chains};
}
export function planMaskedApple(app,raw){
  const {store,chains}=collect(app,raw);
  const core={
    schema_version:MASKED_APPLE_SCHEMA,
    store_plan_sha256:store.plan_sha256,
    candidate_id:store.candidate_id,candidate_sha256:store.candidate_sha256,
    release_id:store.release_id,target_id:store.target_id,build:store.build,
    locale:store.locale,device:store.device,
    screenshot_count:chains.length,masked_sources:chains,
    pixel_masks_operator_declared:true,
    all_personal_information_removed:false,privacy_outside_masks_verified:false,
    pixels_outside_explicit_masks_verified_unchanged:true,
    source_device_attested:false,real_apple_account_connected:false,
    apple_upload_performed:false,store_publication_performed:false,
    platform_authority:false,technical_state:'UNKNOWN'
  };
  return{...core,plan_sha256:digest('masked-apple-store-handoff',core)};
}
export function verifyMaskedApple(app,plan,raw){
  validateValue(plan);
  ensure(plan&&typeof plan==='object'&&!Array.isArray(plan),
    'Masked Apple plan must be an exact object','InvalidArgument');
  const {plan_sha256,...core}=plan;
  ensure(isSHA(plan_sha256)&&digest('masked-apple-store-handoff',core)===plan_sha256,
    'Saved Apple mask plan digest differs from source bytes','Conflict');
  const regenerated=planMaskedApple(app,raw);
  ensure(JSON.stringify(regenerated)===JSON.stringify(plan),
    'Apple mask source, Native derivative, candidate or operator declarations drifted',
    'StaleReference');
  return plan;
}
export async function withMaskedAppleLock(app,work){
  const file=join(app.store.root,'.masked-apple-apply.lock');
  let fd;
  try{fd=openSync(file,'wx',0o600);}
  catch{throw new NativeError('Conflict',
    'Another Apple masked export is running or an abandoned lock needs review');}
  try{return await work();}
  finally{try{closeSync(fd);}finally{unlinkSync(file);}}
}
export async function exportMaskedApple(app,plan,raw,outDir,{
  confirm_masked_plan_sha256,confirm_store_plan_sha256,
  confirm_candidate_sha256,acknowledge_private_export=false,
  acknowledge_remaining_privacy_unknown=false
}={}){
  verifyMaskedApple(app,plan,raw);
  ensure(confirm_masked_plan_sha256===plan.plan_sha256&&
    confirm_store_plan_sha256===plan.store_plan_sha256&&
    confirm_candidate_sha256===plan.candidate_sha256&&
    acknowledge_private_export===true&&
    acknowledge_remaining_privacy_unknown===true,
    'Confirm exact masked/store/candidate SHA, private output and residual PII UNKNOWN',
    'ConsentRequired');
  const dir=privateDir(outDir);
  return withMaskedAppleLock(app,async()=>{
    verifyMaskedApple(app,plan,raw);
    const store=planStorePackage(app,raw.store_input);
    ensure(store.plan_sha256===plan.store_plan_sha256,
      'R44 Apple source differs from original approved mask intent','StaleReference');
    const result=await exportStorePackage(app,store,raw.store_input,dir,{
      confirm_plan_sha256:store.plan_sha256,
      confirm_candidate_sha256:store.candidate_sha256,
      acknowledge_private_export:true
    });
    verifyMaskedApple(app,plan,raw);
    ensure(result.technical_state==='UNKNOWN'&&
      result.store_api_upload_performed===false&&
      result.platform_authority===false,
      'Apple store package was incorrectly promoted to technical/public authority',
      'Conflict');
    const zip=await JSZip.loadAsync(readFileSync(join(dir,result.filename)),{
      checkCRC32:true});
    for(const [i,image] of store.screenshots.entries()){
      const name='screenshots/'+String(i+1).padStart(2,'0')+'.png';
      const fromZip=await zip.file(name)?.async('nodebuffer');
      ensure(fromZip&&sha(fromZip)===image.normalized_sha256,
        'Apple ZIP screenshot differs from exact approved PNG','Conflict');
      const sourceBytes=readFileSync(raw.store_input.screenshots[i].png.path);
      const masked=PNG.sync.read(sourceBytes,{checkCRC:true});
      const packaged=PNG.sync.read(fromZip,{checkCRC:true});
      ensure(packaged.width===masked.width&&packaged.height===masked.height&&
        packaged.data.equals(masked.data),
        'Every App Store ZIP pixel must match the source R55 masked pixel','Conflict');
    }
    const proof={
      schema_version:'launchwright-masked-apple-receipt/1',
      masked_plan_sha256:plan.plan_sha256,
      store_plan_sha256:plan.store_plan_sha256,
      candidate_sha256:plan.candidate_sha256,
      store_zip_filename:result.filename,store_zip_sha256:result.zip_sha256,
      screenshot_count:plan.screenshot_count,masked_sources:plan.masked_sources,
      source_png_pixels_exact:true,original_unmasked_pixels_unchanged:true,
      privacy_outside_masks_verified:false,all_personal_information_removed:false,
      source_device_attested:false,technical_state:'UNKNOWN',
      apple_api_communicated:false,app_review_submitted:false,
      app_published:false,platform_authority:false
    };
    const name='launchwright-masked-apple-'+plan.plan_sha256.slice(0,12)+'.receipt.json';
    const path=join(dir,name),bytes=Buffer.from(JSON.stringify(proof,null,2)+'\n');
    if(existsSync(path))ensure(savedReceipt(path).equals(bytes),
      'Prior masked Apple receipt changed; never overwrite it','Conflict');
    let created=false;
    if(!existsSync(path)){writeFileSync(path,bytes,{flag:'wx',mode:0o600});created=true;}
    return{...proof,receipt_filename:name,
      proof_created:created,store_files_created:result.files_created,
      recovered:!created&&result.files_created===0};
  });
}
export async function prepareMaskedAppleUpload(app,plan,raw,outDir,proof,options){
  verifyMaskedApple(app,plan,raw);
  ensure(proof?.schema_version==='launchwright-masked-apple-receipt/1'&&
    proof.masked_plan_sha256===plan.plan_sha256&&
    proof.store_plan_sha256===plan.store_plan_sha256&&
    proof.candidate_sha256===plan.candidate_sha256&&
    proof.screenshot_count===plan.screenshot_count&&
    proof.technical_state==='UNKNOWN'&&
    proof.privacy_outside_masks_verified===false&&
    proof.apple_api_communicated===false&&
    proof.app_published===false,
    'R58 exact redacted Apple source receipt is required before R51 upload plan',
    'Conflict');
  ensure(proof.store_zip_filename==='launchwright-store-'+
    plan.store_plan_sha256.slice(0,12)+'.zip'&&
    proof.source_png_pixels_exact===true&&
    proof.original_unmasked_pixels_unchanged===true&&
    proof.all_personal_information_removed===false&&
    proof.source_device_attested===false&&
    JSON.stringify(proof.masked_sources)===JSON.stringify(plan.masked_sources),
    'Apple proof file names or R55 source/pixel assertions were altered','Conflict');
  const dir=privateDir(outDir),file=join(dir,proof.store_zip_filename);
  const proofFile=join(dir,'launchwright-masked-apple-'+
    plan.plan_sha256.slice(0,12)+'.receipt.json');
  const proofBytes=savedReceipt(proofFile),stored=JSON.parse(proofBytes);
  // The in-memory result includes runtime-only fields such as recovered and
  // file counters. The durable on-disk immutable proof is the authority.
  for(const [key,value] of Object.entries(stored))
    ensure(JSON.stringify(value)===JSON.stringify(proof[key]),
      'Operator-supplied R58 proof differs from the immutable private receipt',
      'Conflict');
  ensure(sha(readFileSync(file))===proof.store_zip_sha256,
    'R51 upload source differs from R58 masked Apple package','Conflict');
  const store=planStorePackage(app,raw.store_input);
  const intent=await prepareAppleScreenshotUpload(app,store,raw.store_input,file,options);
  ensure(intent.source_zip_sha256===proof.store_zip_sha256&&
    intent.screenshot_count===plan.screenshot_count&&
    intent.images.every((item,i)=>
      item.sha256===plan.masked_sources[i].store_png_normalized_sha256&&
      item.source_evidence_id===plan.masked_sources[i].derived_evidence_id),
    'Apple screenshot upload plan is not bound to every R55 masked Native source',
    'Conflict');
  return{schema_version:'launchwright-masked-apple-upload-intent/1',
    masked_plan_sha256:plan.plan_sha256,
    source_proof_sha256:sha(proofBytes),
    apple_intent:intent,operator_source_masked:true,
    residual_pii_unknown:true,remote_actions_performed:false,
    platform_authority:false,app_published:false};
}

// No alternative remote implementation: the SAME bounded R51 transport
// enforces remote screenshot-set, locale, MD5, ranges, status and recover-only.
export async function sendMaskedAppleUpload(app,plan,raw,outDir,proof,
  wrappedIntent,remote,{
    confirm_masked_plan_sha256,
    confirm_intent_sha256,confirm_candidate_sha256,
    confirm_screenshot_set_id,
    acknowledge_first_remote_write=false,recover_only=false
  }={}){
  ensure(confirm_masked_plan_sha256===plan.plan_sha256,
    'Exact mask/provenance SHA must be confirmed separately from Apple intent',
    'ConsentRequired');
  ensure(wrappedIntent?.schema_version==='launchwright-masked-apple-upload-intent/1'&&
    wrappedIntent.masked_plan_sha256===plan.plan_sha256&&
    wrappedIntent.operator_source_masked===true&&
    wrappedIntent.residual_pii_unknown===true&&
    wrappedIntent.remote_actions_performed===false,
    'Apple upload requires the original complete R55-to-R44 intent','Conflict');
  const prior=await prepareMaskedAppleUpload(app,plan,raw,outDir,proof,{
    screenshot_set_id:wrappedIntent.apple_intent?.screenshot_set_id,
    localization_id:wrappedIntent.apple_intent?.localization_id,
    screenshot_display_type:wrappedIntent.apple_intent?.screenshot_display_type,
    acknowledge_asset_only:true
  });
  ensure(JSON.stringify(prior)===JSON.stringify(wrappedIntent),
    'Saved Apple screenshot upload was changed or source became stale','StaleReference');
  const store=planStorePackage(app,raw.store_input);
  const zip=join(privateDir(outDir),proof.store_zip_filename);
  const result=await sendAppleScreenshotUpload(app,store,raw.store_input,
    zip,prior.apple_intent,remote,{
      confirm_intent_sha256,confirm_candidate_sha256,
      confirm_screenshot_set_id,
      acknowledge_first_remote_write,
      recover_only
    });
  try{verifyMaskedApple(app,plan,raw);}
  catch{
    throw new NativeError('Unavailable',
      'Remote Apple outcome could be known but source masks changed; recover the original intent before any retry',
      false);
  }
  return{
    ...result,
    masked_source_proof_sha256:prior.source_proof_sha256,
    masked_plan_sha256:plan.plan_sha256,
    pixels_outside_operator_masks_proven_unchanged:true,
    pii_outside_masks_verified:false,
    app_published:false,platform_authority:false
  };
}
