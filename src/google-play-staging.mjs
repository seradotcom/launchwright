// SPDX-License-Identifier: AGPL-3.0-only
// R52: R44 Google Play assets -> operator-supplied EXISTING, UNCOMMITTED Edit.
// Never creates/commits/deletes edits or images; never publishes or runs apps.
import { createHash } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { lstatSync, readFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import JSZip from 'jszip';
import { NativeError, requireCondition as ensure, validateValue } from '@semwright/native-sdk';
import { digest } from './base.mjs';
import { verifyStorePackage } from './store-package.mjs';

export const GOOGLE_PLAY_STAGING_SCHEMA='launchwright-google-play-images-intent/1';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const isSha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
const packageName=v=>typeof v==='string'&&v.length<=210&&
  /^(?:[A-Za-z][A-Za-z0-9_]*\.)+[A-Za-z][A-Za-z0-9_]*$/u.test(v);
const editId=v=>typeof v==='string'&&v.length>=4&&v.length<=128&&
  /^[A-Za-z0-9_-]+$/u.test(v);
const TYPES=Object.freeze(['phoneScreenshots','icon','featureGraphic']);
function privateZipFile(path){
  ensure(typeof path==='string'&&isAbsolute(path)&&path.length<=2048,
    'Operator must select the original private R44 ZIP','InvalidArgument');
  const st=lstatSync(path);
  ensure(st.isFile()&&!st.isSymbolicLink()&&st.size>0&&st.size<=60*1024*1024&&
    (process.platform==='win32'||(st.mode&0o077)===0),
    'Google source ZIP must be a private 0600 file, at most 60 MiB',
    'PermissionDenied');
  return readFileSync(path);
}
async function verifiedStoreAssets(app,storePlan,sourceInput,zipPath){
  verifyStorePackage(app,storePlan,sourceInput);
  ensure(storePlan.platform==='google-play-phone-portrait'&&
    storePlan.channel==='google-play-draft'&&
    storePlan.device==='phone-portrait'&&
    storePlan.source_rights===sourceInput.source_rights,
    'Only exact approved R44 Google Play phone portrait packages can be staged',
    'PermissionDenied');
  const raw=privateZipFile(zipPath);
  const archive=await JSZip.loadAsync(raw,{checkCRC32:true});
  const paths=[
    'README.txt','listing.json','manifest.json','preview.html',
    ...storePlan.screenshots.map(s=>'screenshots/'+String(s.ordinal).padStart(2,'0')+'.png'),
    'graphics/icon.png','graphics/feature.png'
  ];
  ensure(JSON.stringify(Object.keys(archive.files).sort())===JSON.stringify([...paths].sort()),
    'Unreviewed files, scripts or paths exist in the Google store ZIP','Conflict');
  const manifest=JSON.parse(await archive.file('manifest.json').async('string'));
  const listingBytes=await archive.file('listing.json').async('nodebuffer');
  const previewBytes=await archive.file('preview.html').async('nodebuffer');
  const listing=JSON.parse(listingBytes.toString('utf8'));
  ensure(manifest?.schema_version==='launchwright-store-package-manifest/1'&&
    manifest.plan_sha256===storePlan.plan_sha256&&
    manifest.candidate_sha256===storePlan.candidate_sha256&&
    manifest.store_platform===storePlan.platform&&
    manifest.channel===storePlan.channel&&
    manifest.release_build===storePlan.build&&
    manifest.store_upload_performed===false&&
    manifest.store_account_accepted===false&&
    manifest.store_policy_complete===false&&
    manifest.app_binary_included===false&&
    manifest.platform_authority===false&&
    manifest.metadata_sha256===sha(listingBytes)&&
    manifest.preview_sha256===sha(previewBytes)&&
    manifest.screenshot_count===storePlan.screenshot_count&&
    listing?.schema_version==='launchwright-store-listing-metadata/1'&&
    listing.external_submission_state==='NOT_SENT'&&
    listing.source_candidate_sha256===storePlan.candidate_sha256&&
    listing.locale===storePlan.locale&&
    listing.app_name===storePlan.metadata.name&&
    listing.summary===storePlan.metadata.summary&&
    listing.description===storePlan.metadata.description,
    'R44 ZIP listing/manifest no longer matches reviewed Native store plan',
    'Conflict');
  const assets=[];
  async function add(path,type,sourceInfo){
    const bytes=await archive.file(path).async('nodebuffer');
    ensure(bytes.length>30&&bytes.length<=12*1024*1024&&
      bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&
      bytes.readUInt32BE(16)===sourceInfo.width&&
      bytes.readUInt32BE(20)===sourceInfo.height&&
      bytes[25]===(type==='icon'?6:2)&&
      sha(bytes)===sourceInfo.normalized_sha256,
      'Image bytes, type, size or exact SHA differ from the R44 store package',
      'Conflict');
    assets.push({
      path,type,ordinal:assets.filter(x=>x.type===type).length+1,
      sha256:sha(bytes),bytes:bytes.length,
      evidence_id:sourceInfo.evidence_id??null,body:bytes
    });
  }
  for(const s of storePlan.screenshots){
    const name='screenshots/'+String(s.ordinal).padStart(2,'0')+'.png';
    ensure(manifest.screenshot_assets[s.ordinal-1]?.normalized_png_sha256===
      s.normalized_sha256,'R44 screenshot source lineage changed','Conflict');
    await add(name,'phoneScreenshots',s);
  }
  for(const [role,type] of [['icon','icon'],['feature','featureGraphic']]){
    const spec=storePlan.graphics.find(x=>x.role===role);
    ensure(spec&&manifest.marketing_graphics.find(x=>x.role===role)?.
      normalized_png_sha256===spec.normalized_sha256,
      'R44 store graphic lineage differs from approved source','Conflict');
    await add('graphics/'+role+'.png',type,spec);
  }
  ensure(assets.filter(x=>x.type==='phoneScreenshots').length>=2&&
    assets.filter(x=>x.type==='phoneScreenshots').length<=8&&
    assets.length<=10,'This subset admits 2–8 phone screenshots plus icon and feature graphic',
    'ResourceExhausted');
  return{zip_sha256:sha(raw),assets};
}
export async function prepareGooglePlayStaging(app,storePlan,sourceInput,zipPath,{
  package_name,edit_id,acknowledge_uncommitted_only=false
}={}){
  ensure(acknowledge_uncommitted_only===true,
    'Google Play edits are provisional; this operation NEVER commits or publishes',
    'ConsentRequired');
  ensure(packageName(package_name)&&editId(edit_id),
    'Operator must provide exact existing Google Play package name and Edit ID',
    'InvalidArgument');
  const source=await verifiedStoreAssets(app,storePlan,sourceInput,zipPath);
  const core={
    schema_version:GOOGLE_PLAY_STAGING_SCHEMA,
    store_plan_sha256:storePlan.plan_sha256,
    source_zip_sha256:source.zip_sha256,
    candidate_id:storePlan.candidate_id,
    candidate_sha256:storePlan.candidate_sha256,
    channel_profile_id:storePlan.channel_profile_id,
    package_name,edit_id,locale:storePlan.locale,
    device_profile:'google-play-phone-portrait',
    assets:source.assets.map(({body,...asset})=>asset),
    image_types:[...TYPES],
    source_rights:'OPERATOR_DECLARATION_ONLY',
    independent_pixel_privacy_review:false,
    source_device_attestation:false,
    upload_into_existing_edit_only:true,
    creates_edit:false,commits_edit:false,deletes_existing_images:false,
    updates_store_listing_copy:false,app_submitted:false,published:false,
    platform_authority:false,technical_state:'UNKNOWN'
  };
  return{...core,intent_sha256:digest('google-play-images',core)};
}
export async function verifyGooglePlayStaging(app,storePlan,sourceInput,zipPath,intent){
  validateValue(intent);
  ensure(intent&&typeof intent==='object'&&!Array.isArray(intent),
    'Saved Google Play intent must be a JSON object','InvalidArgument');
  const{intent_sha256,...core}=intent;
  ensure(isSha(intent_sha256)&&digest('google-play-images',core)===intent_sha256,
    'Saved Google Play image upload intent has been modified','Conflict');
  const actual=await prepareGooglePlayStaging(app,storePlan,sourceInput,zipPath,{
    package_name:core.package_name,edit_id:core.edit_id,
    acknowledge_uncommitted_only:core.upload_into_existing_edit_only
  });
  ensure(JSON.stringify(actual)===JSON.stringify(intent),
    'Source, candidate, Edit identity, PNG bytes or rights have changed',
    'StaleReference');
  return actual;
}
export const googleImageSHA=value=>{
  ensure(typeof value==='string'&&value.length>=43&&value.length<=88,
    'Remote Google Play image must declare a SHA-256','ProtocolMismatch');
  if(/^[a-fA-F0-9]{64}$/u.test(value))return value.toLowerCase();
  const raw=Buffer.from(value,'base64');
  ensure(raw.length===32&&raw.toString('base64').replace(/=+$/u,'')===
    value.replace(/=+$/u,''),
    'Remote Google Play image SHA is not canonical hex/base64','ProtocolMismatch');
  return raw.toString('hex');
};
export function checkGooglePlayImages(intent,type,images){
  ensure(TYPES.includes(type)&&Array.isArray(images)&&images.length<=10,
    'Google Play returned unexpected type or unbounded image list','ProtocolMismatch');
  const expected=intent.assets.filter(x=>x.type===type);
  ensure(images.length<=expected.length,
    'An existing Google Play Edit contains extra images; never overwrite/delete them',
    'Conflict');
  const expectedHashes=new Set(expected.map(x=>x.sha256));
  ensure(expectedHashes.size===expected.length,
    'Distinct screenshot SHA hashes are required; remote Play image order is not certified',
    'InvalidArgument');
  const ids=new Set(),observedHashes=new Set();
  for(const image of images){
    ensure(image&&typeof image==='object'&&
      typeof image.id==='string'&&/^[A-Za-z0-9_-]{1,160}$/u.test(image.id)&&
      !ids.has(image.id),'Google Play image IDs are malformed or duplicated','ProtocolMismatch');
    ids.add(image.id);
    const remoteHash=googleImageSHA(image.sha256);
    ensure(expectedHashes.has(remoteHash)&&!observedHashes.has(remoteHash),
      'An image in this Google Play Edit is foreign or duplicated by SHA-256',
      'Conflict');
    observedHashes.add(remoteHash);
  }
  return{type,expected:expected.length,observed:images.length,
    image_ids:images.map(x=>x.id),
    observed_sha256:images.map(x=>googleImageSHA(x.sha256)),
    image_order_independently_verified:false};
}
// Local operator exclusivity only. Cross-host Google Play Edit contention still
// requires separate owner coordination and an exact remote GET before writes.
export async function withGooglePlayStagingLock(workspaceRoot,task){
  ensure(typeof task==='function','Google Play lock needs a scoped task','InvalidArgument');
  const path=join(workspaceRoot,'.google-play-staging.lock');
  let fd;
  try{fd=openSync(path,'wx',0o600);}
  catch{
    throw new NativeError('Conflict',
      'A Google Play upload is running or an abandoned local lock needs manual review');
  }
  try{return await task();}
  finally{try{closeSync(fd);}finally{unlinkSync(path);}}
}
export async function inspectGooglePlayStaging(intent,remote,{nowMs=Date.now()}={}){
  ensure(intent?.schema_version===GOOGLE_PLAY_STAGING_SCHEMA,
    'Exact Google Play staging intent required','InvalidArgument');
  const edit=await remote.getEdit(intent.package_name,intent.edit_id);
  const expiry=Number(edit?.expiryTimeSeconds)*1000;
  ensure(edit?.id===intent.edit_id&&Number.isSafeInteger(expiry)&&expiry>0,
    'Remote Google Play Edit does not match the exact operator-owned Edit ID',
    'Conflict');
  ensure(nowMs<expiry,'Google Play Edit has expired; NEVER create a replacement edit automatically',
    'StaleReference');
  const categories=[];
  for(const type of TYPES){
    const images=await remote.listImages(intent.package_name,intent.edit_id,
      intent.locale,type);
    categories.push(checkGooglePlayImages(intent,type,images));
  }
  const total=categories.reduce((n,c)=>n+c.observed,0);
  const expected=intent.assets.length;
  return{
    schema_version:'launchwright-google-play-edit-inspection/1',
    intent_sha256:intent.intent_sha256,
    package_name:intent.package_name,edit_id:intent.edit_id,
    edit_expires_at:new Date(expiry).toISOString(),
    categories,observed_images:total,expected_images:expected,
    state:total===expected?'STAGED_IN_UNCOMMITTED_EDIT':
      total===0?'NO_IMAGES_IN_EDIT':'PARTIAL_UNCOMMITTED_EDIT',
    edit_committed:false,published:false,
    network_write_performed:false,technical_state:'UNKNOWN',
    can_stage_first_time:total===0&&expiry-nowMs>120000,
    operator_action_required:total!==expected
  };
}
export async function sendGooglePlayStaging(app,storePlan,sourceInput,
  zipPath,intent,remote,{
    confirm_intent_sha256,confirm_store_plan_sha256,
    confirm_package_name,confirm_edit_id,
    acknowledge_first_upload=false,recover_only=false
  }={}){
  await verifyGooglePlayStaging(app,storePlan,sourceInput,zipPath,intent);
  ensure(confirm_intent_sha256===intent.intent_sha256&&
    confirm_store_plan_sha256===intent.store_plan_sha256&&
    confirm_package_name===intent.package_name&&
    confirm_edit_id===intent.edit_id,
    'Operator must separately confirm exact intent, store plan, package and edit ID',
    'ConsentRequired');
  for(const method of ['getEdit','listImages','uploadImage'])
    ensure(remote&&typeof remote[method]==='function',
      'Google Play staging requires a bounded images transport','InvalidArgument');
  if(recover_only){
    const observed=await inspectGooglePlayStaging(intent,remote);
    return{...observed,recovery_only:true,uploads_performed:0};
  }
  ensure(acknowledge_first_upload===true,
    'Operator must independently authorize first upload into this existing Edit',
    'ConsentRequired');
  return withGooglePlayStagingLock(app.store.root,async()=>{
    const before=await inspectGooglePlayStaging(intent,remote);
    ensure(before.can_stage_first_time&&before.state==='NO_IMAGES_IN_EDIT',
      'Edit must have no images in these three slots. Use recover-only or prepare a different operator-owned Edit.',
      'Conflict');
    const verified=await verifiedStoreAssets(app,storePlan,sourceInput,zipPath);
    let acknowledged=0;
    for(const item of verified.assets){
      try{
        await remote.uploadImage(intent.package_name,intent.edit_id,intent.locale,
          item.type,item.body);
        acknowledged++;
      }catch{
        throw new NativeError('Unavailable',
          'Google Play image POST outcome is unknown. Use recover-only with the SAME intent; never automatically upload again.',
          false);
      }
      const checked=await inspectGooglePlayStaging(intent,remote);
      // Google does not promise listing order; compare the approved SHA set
      // and the exact growing total, never an inferred screenshot order.
      ensure(checked.observed_images===acknowledged,
        'Google Play Edit readback does not contain exactly the confirmed SHA-bound images',
        'Conflict');
    }
    const after=await inspectGooglePlayStaging(intent,remote);
    ensure(after.state==='STAGED_IN_UNCOMMITTED_EDIT',
      'Remote Google Play Edit is incomplete; recover-only inspection required',
      'Conflict');
    await verifyGooglePlayStaging(app,storePlan,sourceInput,zipPath,intent);
    return{...after,uploads_performed:acknowledged,recovery_only:false,
      edit_committed:false,published:false,remote_edit_changed:true,
      edit_expiration_requires_operator_action:true,
      human_store_review_pending:true,platform_authority:false};
  });
}
