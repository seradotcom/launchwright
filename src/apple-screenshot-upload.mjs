// SPDX-License-Identifier: AGPL-3.0-only
// R51: bounded App Store Connect SCREENSHOT asset reservation/upload.
// Only operator-approved R44 Apple screenshot pack, no app submission,
// version metadata writes, storefront activation or Platform API.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import JSZip from 'jszip';
import { NativeError, requireCondition as ensure, validateValue } from '@semwright/native-sdk';
import { digest } from './base.mjs';
import { verifyStorePackage } from './store-package.mjs';

export const APPLE_SCREENSHOT_SCHEMA='launchwright-apple-screenshot-intent/1';
const hash=v=>createHash('sha256').update(v).digest('hex');
const md5=v=>createHash('md5').update(v).digest('hex');
const isSha=v=>typeof v==='string'&&/^[0-9a-f]{64}$/u.test(v);
const isId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{5,128}$/u.test(v);
function fail(code,message){throw new NativeError(code,message);}
function dataObject(value,name){
  ensure(value&&typeof value==='object'&&!Array.isArray(value),
    name+' must be an exact object','InvalidArgument');
  return value;
}
function privateZip(path){
  ensure(typeof path==='string'&&isAbsolute(path)&&path.length<=2048,
    'Choose the exact absolute private R44 ZIP','InvalidArgument');
  const stat=lstatSync(path);
  ensure(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<=60*1024*1024&&
    (process.platform==='win32'||(stat.mode&0o077)===0),
    'Store bundle must be a private regular ZIP (0600 on POSIX), <=60 MiB',
    'PermissionDenied');
  return readFileSync(path);
}
async function loadSource(app,localPlan,localInput,zipPath){
  verifyStorePackage(app,localPlan,localInput);
  ensure(localPlan.platform==='apple-iphone-dynamic-island-medium'&&
    localPlan.channel==='app-store-connect-draft'&&
    localPlan.device==='iphone-dynamic-island-medium'&&
    localPlan.source_rights===localInput.source_rights,
    'Only approved bounded Apple iPhone screenshot packs are supported',
    'PermissionDenied');
  const bytes=privateZip(zipPath),zip=await JSZip.loadAsync(bytes,{checkCRC32:true});
  const expected=['README.txt','listing.json','manifest.json','preview.html',
    ...localPlan.screenshots.map(s=>'screenshots/'+String(s.ordinal).padStart(2,'0')+'.png')].sort();
  ensure(JSON.stringify(Object.keys(zip.files).sort())===JSON.stringify(expected),
    'Store source ZIP contains unexpected files or unreviewed executable content',
    'Conflict');
  const manifest=JSON.parse(await zip.file('manifest.json').async('string'));
  const listingBytes=await zip.file('listing.json').async('nodebuffer');
  const previewBytes=await zip.file('preview.html').async('nodebuffer');
  const listing=JSON.parse(listingBytes.toString('utf8'));
  ensure(manifest?.metadata_sha256===hash(listingBytes)&&
    manifest?.preview_sha256===hash(previewBytes)&&
    manifest?.screenshot_count===localPlan.screenshot_count&&
    manifest?.store_profile===localPlan.device&&
    manifest?.channel===localPlan.channel&&
    manifest?.store_policy_complete===false&&
    manifest?.store_account_accepted===false&&
    manifest?.app_binary_included===false&&
    manifest?.platform_authority===false&&
    listing.app_name===localPlan.metadata.name&&
    listing.summary===localPlan.metadata.summary&&
    listing.description===localPlan.metadata.description&&
    listing.keywords===localPlan.metadata.keywords&&
    listing.support_url===localPlan.metadata.support_url&&
    listing.privacy_policy_url===localPlan.metadata.privacy_policy_url,
    'Private R44 store ZIP metadata or review preview differs from exact approved plan',
    'Conflict');
  ensure(manifest?.schema_version==='launchwright-store-package-manifest/1'&&
    manifest.plan_sha256===localPlan.plan_sha256&&
    manifest.candidate_sha256===localPlan.candidate_sha256&&
    manifest.store_platform===localPlan.platform&&
    manifest.release_build===localPlan.build &&
    manifest.store_upload_performed===false &&
    listing?.schema_version==='launchwright-store-listing-metadata/1'&&
    listing.store_listing_state==='OPERATOR_LOCAL_REVIEW'&&
    listing.external_submission_state==='NOT_SENT'&&
    listing.locale===localPlan.locale&&
    listing.source_candidate_sha256===localPlan.candidate_sha256,
    'Store ZIP metadata differs from reviewed Native candidate and operator plan',
    'Conflict');
  const images=[];
  for(const [index,screen] of localPlan.screenshots.entries()){
    const name='screenshots/'+String(index+1).padStart(2,'0')+'.png';
    const image=await zip.file(name).async('nodebuffer');
    ensure(image.length>0&&image.length<=12*1024*1024&&
      image[25]===2&&hash(image)===screen.normalized_sha256&&
      image.readUInt32BE(16)===screen.width&&
      image.readUInt32BE(20)===screen.height,
      'Store screenshot does not match exact normalized reviewed pixels',
      'Conflict');
    ensure(manifest.screenshot_assets[index]?.normalized_png_sha256===
      screen.normalized_sha256,
      'R44 manifest screenshot SHA drifted','Conflict');
    images.push({
      ordinal:index+1,source_evidence_id:screen.evidence_id,
      sha256:hash(image),md5:md5(image),
      bytes:image.length,content_type:'image/png',
      path:name,body:image
    });
  }
  return {zip_sha256:hash(bytes),images};
}
export async function prepareAppleScreenshotUpload(app,localPlan,localInput,zipPath,{
  screenshot_set_id,localization_id,screenshot_display_type='APP_IPHONE_61',
  acknowledge_asset_only=false
}={}){
  ensure(acknowledge_asset_only===true,
    'A screenshot upload is not app submission, review or publication. Acknowledge this.',
    'ConsentRequired');
  ensure(isId(screenshot_set_id)&&isId(localization_id),
    'Choose existing exact App Store Connect screenshot set and localization IDs',
    'InvalidArgument');
  ensure(screenshot_display_type==='APP_IPHONE_61',
    'This bounded source profile supports only APP_IPHONE_61 set IDs after owner verification',
    'InvalidArgument');
  const source=await loadSource(app,localPlan,localInput,zipPath);
  const core={
    schema_version:APPLE_SCREENSHOT_SCHEMA,
    platform:'app-store-connect',
    store_plan_sha256:localPlan.plan_sha256,
    candidate_id:localPlan.candidate_id,
    candidate_sha256:localPlan.candidate_sha256,
    source_zip_sha256:source.zip_sha256,
    locale:localPlan.locale,
    screenshot_set_id,localization_id,screenshot_display_type,
    screenshot_count:source.images.length,
    images:source.images.map(({body,...item})=>({
      ...item,
      file_name:'launchwright-'+localPlan.plan_sha256.slice(0,12)+'-'+
        String(item.ordinal).padStart(2,'0')+'.png'
    })),
    source_pixels_certification:'OPERATOR_DECLARATION_ONLY',
    independent_privacy_review:false,
    technical_state:'UNKNOWN',
    asset_upload_scope_only:true,
    external_version_submission:false,
    app_published:false,platform_authority:false
  };
  return {...core,intent_sha256:digest('apple-screenshot-intent',core)};
}
export async function verifyAppleScreenshotUpload(app,localPlan,localInput,zipPath,intent){
  validateValue(intent);
  dataObject(intent,'Apple screenshot intent');
  const {intent_sha256,...core}=intent;
  ensure(isSha(intent_sha256)&&digest('apple-screenshot-intent',core)===intent_sha256,
    'Saved Apple screenshot intent has been modified','Conflict');
  const expected=await prepareAppleScreenshotUpload(app,localPlan,localInput,zipPath,{
    screenshot_set_id:intent.screenshot_set_id,localization_id:intent.localization_id,
    screenshot_display_type:intent.screenshot_display_type,acknowledge_asset_only:true
  });
  ensure(JSON.stringify(expected)===JSON.stringify(intent),
    'App Store source, candidate, rights or screenshot bytes have drifted',
    'StaleReference');
  return expected;
}
function attribute(data,name){
  ensure(data?.data?.type===name&&isId(data?.data?.id),
    'App Store Connect returned unexpected resource identity','ProtocolMismatch');
  return data.data;
}
function checkSet(set,intent){
  const target=attribute(set,'appScreenshotSets');
  ensure(target.id===intent.screenshot_set_id&&
    target.attributes?.screenshotDisplayType===intent.screenshot_display_type&&
    target.relationships?.appStoreVersionLocalization?.data?.id===intent.localization_id,
    'App Store screenshot set/locale/display target differs from reviewed intent',
    'Conflict');
}
function checkLocalization(item,intent){
  const loc=attribute(item,'appStoreVersionLocalizations');
  ensure(loc.id===intent.localization_id &&
    loc.attributes?.locale===intent.locale,
    'App Store localization or locale was substituted','Conflict');
}
function validatedExisting(res,intent){
  ensure(res&&Array.isArray(res.data)&&res.data.length<=10&&
    !res.links?.next,
    'Screenshot set returned unbounded/paginated data; manual review required',
    'ResourceExhausted');
  const found=new Map();
  for(const value of res.data){
    ensure(value?.type==='appScreenshots'&&isId(value.id),
      'Unexpected screenshot resource in the selected set','ProtocolMismatch');
    const name=value.attributes?.fileName;
    const item=intent.images.find(a=>a.file_name===name);
    ensure(item&&!found.has(name)&&value.attributes.fileSize===item.bytes,
      'Unreviewed or duplicate screenshot already exists in set; do not overwrite it',
      'Conflict');
    // Apple AppScreenshot.Attributes.assetDeliveryState is a structured
    // AppMediaAssetState: {state,errors:[...]}, NOT a bare status string.
    const delivery=value.attributes.assetDeliveryState;
    const state=delivery?.state;
    ensure(delivery&&typeof delivery==='object'&&!Array.isArray(delivery)&&
      Array.isArray(delivery.errors)&&delivery.errors.length===0&&
      ['AWAITING_UPLOAD','UPLOAD_COMPLETE','COMPLETE','FAILED'].includes(state),
      'Unknown Apple processing state must be reviewed manually','Conflict');
    if(['UPLOAD_COMPLETE','COMPLETE'].includes(state)){
      ensure(value.attributes.sourceFileChecksum===item.md5,
        'Remote screenshot MD5 differs from frozen R44 image bytes','Conflict');
    }
    if(state==='FAILED')fail('Conflict',
      'Remote screenshot processing failed; owner must manually resolve it');
    found.set(name,{id:value.id,state});
  }
  // Enforce deterministic owner upload order, no positional substitution.
  const states=intent.images.map(a=>found.get(a.file_name)??null);
  const index=states.findIndex(x=>x===null);
  if(index>=0)ensure(states.slice(index).every(x=>x===null),
    'Screenshot set contains an out-of-order reservation; manual review required',
    'Conflict');
  return states;
}
function checkReservation(response,intent,image){
  const item=attribute(response,'appScreenshots');
  ensure(item.attributes?.fileName===image.file_name&&
    item.attributes?.fileSize===image.bytes &&
    item.attributes?.assetDeliveryState?.state==='AWAITING_UPLOAD'&&
    Array.isArray(item.attributes.assetDeliveryState.errors)&&
    item.attributes.assetDeliveryState.errors.length===0,
    'App Store reservation differs from exact screenshot file','Conflict');
  const ops=item.attributes.uploadOperations;
  ensure(Array.isArray(ops)&&ops.length>=1&&ops.length<=32,
    'Reservation lacks bounded upload operations','ProtocolMismatch');
  const ordered=[...ops].sort((a,b)=>a.offset-b.offset);
  let offset=0;
  for(const op of ordered){
    ensure(Number.isSafeInteger(op.offset)&&op.offset===offset&&
      Number.isSafeInteger(op.length)&&op.length>0&&
      offset+op.length<=image.bytes,
      'Apple upload operation byte ranges overlap, skip or exceed approved PNG',
      'Conflict');
    offset+=op.length;
  }
  ensure(offset===image.bytes,'Apple upload operations omit source bytes','Conflict');
  return {id:item.id,operations:ordered};
}
export async function sendAppleScreenshotUpload(app,localPlan,localInput,zipPath,intent,remote,{
  confirm_intent_sha256,confirm_candidate_sha256,confirm_screenshot_set_id,
  acknowledge_first_remote_write=false,recover_only=false
}={}){
  await verifyAppleScreenshotUpload(app,localPlan,localInput,zipPath,intent);
  ensure(confirm_intent_sha256===intent.intent_sha256 &&
    confirm_candidate_sha256===intent.candidate_sha256 &&
    confirm_screenshot_set_id===intent.screenshot_set_id,
    'Operator must independently confirm exact intent/candidate/set IDs',
    'ConsentRequired');
  for(const key of ['getScreenshotSet','getLocalization','listScreenshots'])
    ensure(typeof remote?.[key]==='function',
      'Apple transport is missing required read-only operation','InvalidArgument');
  const [set,localization]=await Promise.all([
    remote.getScreenshotSet(intent.screenshot_set_id),
    remote.getLocalization(intent.localization_id)
  ]);
  checkSet(set,intent);checkLocalization(localization,intent);
  let states=validatedExisting(await remote.listScreenshots(intent.screenshot_set_id),intent);
  const incomplete=states.findIndex(s=>s&&s.state==='AWAITING_UPLOAD');
  if(incomplete>=0){
    return {schema_version:'launchwright-apple-asset-recovery/1',
      intent_sha256:intent.intent_sha256,
      state:'UNKNOWN_RESERVED_ASSET_REQUIRES_OPERATOR_REVIEW',
      outstanding_filename:intent.images[incomplete].file_name,
      remote_mutation_performed:false,
      app_submitted:false,app_published:false,platform_authority:false};
  }
  const complete=states.filter(s=>s&&s.state==='COMPLETE').length;
  const processed=states.filter(s=>s&&(s.state==='COMPLETE'||s.state==='UPLOAD_COMPLETE')).length;
  if(recover_only||processed===intent.images.length){
    return {schema_version:'launchwright-apple-asset-recovery/1',
      intent_sha256:intent.intent_sha256,
      state:processed===intent.images.length ?
        (complete===intent.images.length?'SCREENSHOTS_PROCESSED':'PROCESSING_PENDING') :
        'NOT_SENT_OR_PARTIAL',
      processed_screenshots:complete,
      upload_committed_screenshots:processed,
      remaining:intent.images.slice(processed).map(x=>x.file_name),
      remote_mutation_performed:false,
      app_submitted:false,app_published:false,platform_authority:false};
  }
  ensure(acknowledge_first_remote_write===true,
    'Explicit operator approval required before any remote screenshot reservation',
    'ConsentRequired');
  for(const key of ['createScreenshot','uploadPart','commitScreenshot'])
    ensure(typeof remote[key]==='function',
      'Apple transport is missing required screenshot mutation operation',
      'InvalidArgument');
  const zip=await loadSource(app,localPlan,localInput,zipPath);
  let mutations=0;
  for(let i=processed;i<intent.images.length;i++){
    const image=intent.images[i],content=zip.images[i].body;
    let reservation;
    try{reservation=await remote.createScreenshot({
      screenshot_set_id:intent.screenshot_set_id,
      file_name:image.file_name,file_size:image.bytes
    });mutations++;}
    catch{throw new NativeError('Unavailable',
      'Apple reservation reply is unknown; recover exact intent before retry',false);}
    const bounded=checkReservation(reservation,intent,image);
    try{
      for(const op of bounded.operations)await remote.uploadPart(op,content.subarray(
        op.offset,op.offset+op.length
      ));
      mutations+=bounded.operations.length;
    }catch{throw new NativeError('Unavailable',
      'Apple signed-part upload outcome is unknown; recover before any retry',false);}
    try{
      await remote.commitScreenshot(bounded.id,image.md5);
      mutations++;
    }catch{throw new NativeError('Unavailable',
      'Apple screenshot commit outcome is unknown; recover-only required',false);}
    states=validatedExisting(await remote.listScreenshots(intent.screenshot_set_id),intent);
    ensure(states[i]&&['UPLOAD_COMPLETE','COMPLETE'].includes(states[i].state),
      'Screenshot was not committed and independently readable in Apple set',
      'Conflict');
  }
  // Re-read final state and the original local source before claiming success.
  states=validatedExisting(await remote.listScreenshots(intent.screenshot_set_id),intent);
  ensure(states.every(s=>s&&['UPLOAD_COMPLETE','COMPLETE'].includes(s.state)),
    'Apple screenshot set does not contain every source-pinned asset',
    'Conflict');
  await verifyAppleScreenshotUpload(app,localPlan,localInput,zipPath,intent);
  const allProcessed=states.every(s=>s.state==='COMPLETE');
  return {
    schema_version:'launchwright-apple-screenshot-receipt/1',
    intent_sha256:intent.intent_sha256,
    screenshot_set_id:intent.screenshot_set_id,
    source_package_sha256:intent.source_zip_sha256,
    screenshots_reserved_and_uploaded:intent.images.length,
    state:allProcessed?'SCREENSHOTS_PROCESSED':'PROCESSING_PENDING',
    remote_asset_operations_observed:mutations,
    asset_submission_to_processing_performed:mutations>0,
    remote_app_review_submission_performed:false,
    app_published:false,external_storefront_activated:false,
    pixel_privacy_independently_verified:false,
    platform_authority:false,technical_state:'UNKNOWN'
  };
}
