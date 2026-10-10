// SPDX-License-Identifier: AGPL-3.0-only
// R61: declarative click-through links on EXACT R55/R59 masked screenshot bytes.
// No scripts, source-app actions, new Media claims or Platform execution.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import JSZip from 'jszip';
import { PNG } from 'pngjs';
import { requireCondition as ensure, validateValue, NativeError } from '@semwright/native-sdk';
import { digest } from './base.mjs';
import { withInteractiveDemoLock } from './interactive-demo.mjs';
import { verifyMaskedInteractiveDemo } from './masked-interactive-demo.mjs';
import { renderHotspotWalkthrough } from './offline-hotspot-view.mjs';

export const OFFLINE_HOTSPOT_SCHEMA='launchwright-r61-masked-hotspot-plan/1';
const SHA=v=>createHash('sha256').update(v).digest('hex');
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
const exact=(o,keys,required=keys)=>{
  ensure(o&&typeof o==='object'&&!Array.isArray(o)&&
    Object.keys(o).every(k=>keys.includes(k))&&
    required.every(k=>Object.hasOwn(o,k)),
    'Hotspot plan contains missing or extra fields','InvalidArgument');
};
function privateDirectory(path){
  ensure(typeof path==='string'&&isAbsolute(path)&&path.length<=2048,
    'A local absolute private directory is required','InvalidArgument');
  const st=lstatSync(path);
  ensure(st.isDirectory()&&!st.isSymbolicLink()&&
    (process.platform==='win32'||(st.mode&0o077)===0),
    'Offline source/export directory must be real, private and 0700 on POSIX',
    'PermissionDenied');
  return path;
}
function privateFile(path,maximum){
  const st=lstatSync(path);
  ensure(st.isFile()&&!st.isSymbolicLink()&&st.size>0&&st.size<=maximum&&
    (process.platform==='win32'||(st.mode&0o077)===0),
    'Exact R59 source ZIP/receipt must be a private regular file','PermissionDenied');
  return readFileSync(path);
}
function readSourceReceipt(raw){
  let entry;
  try{entry=JSON.parse(raw.toString('utf8'));}catch{
    throw new NativeError('InvalidArgument','R59 source receipt is invalid JSON');
  }
  exact(entry,[
    'schema_version','plan_sha256','r43_plan_sha256','media_plan_id',
    'media_plan_digest','variant_id','source_lineage','offline_zip_sha256',
    'html_sha256','mask_scope_only','masked_pixels_verified_opaque',
    'pixels_outside_masks_unchanged','remaining_pixel_privacy_unknown',
    'technical_state','external_publication','platform_authority',
    'customer_acceptance'
  ]);
  ensure(entry.schema_version==='launchwright-masked-interactive-demo-receipt/1'&&
    entry.mask_scope_only===true&&entry.masked_pixels_verified_opaque===true&&
    entry.pixels_outside_masks_unchanged===true&&
    entry.remaining_pixel_privacy_unknown===true&&
    entry.technical_state==='UNKNOWN'&&entry.external_publication===false&&
    entry.platform_authority===false&&entry.customer_acceptance===false,
    'R59 receipt would promote source/privacy authority','Conflict');
  return entry;
}
function sanitizeLinks(links,plan){
  ensure(Array.isArray(links)&&links.length>=1&&links.length<=20,
    'One to twenty explicit review-only hotspots are required','ResourceExhausted');
  const shots=plan.masks.map(m=>m.shot_id);
  ensure(new Set(shots).size===shots.length&&shots.length===plan.frame_count,
    'R59 screenshots are not uniquely pinned to the Media shot order','Conflict');
  const fromCounts=new Map(),result=[],seen=new Set();
  for(const link of links){
    validateValue(link);
    exact(link,['from_shot_id','to_shot_id','label','x','y','width','height']);
    ensure(shots.includes(link.from_shot_id)&&shots.includes(link.to_shot_id)&&
      link.from_shot_id!==link.to_shot_id,
      'Every hotspot must link between two distinct approved masked Media states',
      'PermissionDenied');
    ensure(typeof link.label==='string'&&link.label.length>=2&&link.label.length<=72&&
      !/[\x00-\x1f\x7f]/u.test(link.label),
      'Hotspot accessible label must be plain, bounded operator text','InvalidArgument');
    for(const k of ['x','y','width','height'])
      ensure(Number.isSafeInteger(link[k])&&link[k]>=0,
        'Hotspot geometry requires finite nonnegative integer pixels','InvalidArgument');
    ensure(link.width>=44&&link.height>=44&&
      link.x+link.width<=plan.width&&link.y+link.height<=plan.height,
      'Clickable region must fit the approved image and be at least 44x44 pixels',
      'InvalidArgument');
    const key=link.from_shot_id+':'+link.to_shot_id+':'+link.x+':'+link.y;
    ensure(!seen.has(key),'Duplicate hotspot is ambiguous','Conflict');
    seen.add(key);
    const count=(fromCounts.get(link.from_shot_id)??0)+1;
    ensure(count<=3,'At most three actionable hotspots per screen','ResourceExhausted');
    fromCounts.set(link.from_shot_id,count);
    // Never place a pseudo-control over a masked block: pixels at this
    // location are deliberately hidden and cannot establish app behavior.
    const fromIndex=shots.indexOf(link.from_shot_id);
    const rectangle=plan.masks[fromIndex];
    ensure(rectangle?.masked_pixels>0&&rectangle.width===plan.width&&
      rectangle.height===plan.height,'Source mask geometry is unavailable','Conflict');
    result.push({
      from_shot_id:link.from_shot_id,to_shot_id:link.to_shot_id,
      label:link.label,x:link.x,y:link.y,width:link.width,height:link.height
    });
  }
  for(let i=0;i<result.length;i++){
    const a=result[i],idx=shots.indexOf(a.from_shot_id);
    // R59 mask rectangles are retained in the ORIGINAL R55 request, checked
    // by the caller separately; they must not be inferred from count alone.
    for(let j=i+1;j<result.length;j++){
      const b=result[j];
      if(a.from_shot_id!==b.from_shot_id)continue;
      ensure(!(a.x<b.x+b.width&&b.x<a.x+a.width&&
        a.y<b.y+b.height&&b.y<a.y+a.height),
        'Overlapping operator hotspots would make navigation ambiguous',
        'Conflict');
    }
  }
  // All states must be accessible by at least one click-through route
  // originating from the initial page. The topbar also lists all states.
  const reached=new Set([shots[0]]),stack=[shots[0]];
  while(stack.length){
    const from=stack.pop();
    for(const link of result.filter(l=>l.from_shot_id===from)){
      if(!reached.has(link.to_shot_id)){
        reached.add(link.to_shot_id);stack.push(link.to_shot_id);
      }
    }
  }
  ensure(reached.size===shots.length,
    'Every masked source state must be reachable via the declared click-through path',
    'Conflict');
  return result.sort((a,b)=>
    shots.indexOf(a.from_shot_id)-shots.indexOf(b.from_shot_id) ||
    a.y-b.y || a.x-b.x || a.to_shot_id.localeCompare(b.to_shot_id));
}
function avoidMaskedPixels(links,sourceRequest){
  const shotIndex=new Map(sourceRequest.demo_input.frames.map((f,i)=>[f.shot_id,i]));
  for(const link of links){
    const i=shotIndex.get(link.from_shot_id);
    ensure(i!==undefined,'Hotspot source was not declared in R59','PermissionDenied');
    const masks=sourceRequest.masked_sources[i].mask_plan.rectangles;
    ensure(Array.isArray(masks)&&masks.length>0,
      'R55 source must declare actual mask rectangles','Conflict');
    for(const mask of masks){
      ensure(!(link.x<mask.x+mask.width&&mask.x<link.x+link.width &&
        link.y<mask.y+mask.height&&mask.y<link.y+link.height),
        'Hotspots cannot be placed over source R55 privacy mask areas',
        'PermissionDenied');
    }
  }
}
async function source(app,maskedPlan,maskedRequest,sourceDir){
  verifyMaskedInteractiveDemo(app,maskedPlan,maskedRequest);
  const dir=privateDirectory(sourceDir);
  const name='launchwright-masked-demo-'+maskedPlan.plan_sha256.slice(0,12);
  const receipt=readSourceReceipt(privateFile(join(dir,name+'.receipt.json'),96*1024));
  const bytes=privateFile(join(dir,name+'.zip'),21*1024*1024);
  ensure(receipt.plan_sha256===maskedPlan.plan_sha256&&
    receipt.r43_plan_sha256===maskedPlan.r43_plan_sha256&&
    receipt.media_plan_digest===maskedPlan.media_plan_digest&&
    receipt.media_plan_id===maskedPlan.media_plan_id&&
    receipt.variant_id===maskedPlan.variant_id&&
    JSON.stringify(receipt.source_lineage)===JSON.stringify(maskedPlan.masks)&&
    receipt.offline_zip_sha256===SHA(bytes),
    'R59 output differs from the exact current R55/Native mask source','Conflict');
  const records=app.list('media_output',maskedPlan.release_id).filter(row=>
    row.data.plan_id===maskedPlan.media_plan_id&&
    row.data.variant_id===maskedPlan.variant_id);
  ensure(records.length===1&&
    records[0].data.provider==='launchwright-r59-masked-offline'&&
    records[0].data.authority==='imported'&&
    records[0].data.technical_effective==='UNKNOWN'&&
    records[0].data.artifact_sha256===SHA(bytes),
    'An exact imported/UNKNOWN R59 Native media_output is required','Conflict');
  const zip=await JSZip.loadAsync(bytes,{checkCRC32:true});
  const names=Object.keys(zip.files).sort();
  ensure(JSON.stringify(names)===JSON.stringify(['README.txt','index.html','manifest.json']),
    'R59 source ZIP contains unsupported files','ProtocolMismatch');
  const html=await zip.file('index.html').async('nodebuffer');
  const manifestBytes=await zip.file('manifest.json').async('nodebuffer');
  ensure(html.length<=20*1024*1024&&manifestBytes.length<=96*1024,
    'Source HTML/manifest exceeds bounded read size','ResourceExhausted');
  let manifest;
  try{manifest=JSON.parse(manifestBytes.toString('utf8'));}catch{
    throw new NativeError('InvalidArgument','R59 manifest JSON is invalid');
  }
  ensure(manifest.r59_plan_sha256===maskedPlan.plan_sha256&&
    manifest.html_sha256===SHA(html)&&manifest.html_sha256===receipt.html_sha256&&
    JSON.stringify(manifest.r55_mask_chain)===JSON.stringify(maskedPlan.masks)&&
    manifest.script_execution_permitted===false&&
    manifest.pixels_outside_masks_independently_private===false&&
    manifest.technical_state==='UNKNOWN'&&manifest.platform_authority===false,
    'R59 source manifest does not preserve masked pixel and non-authority lineage','Conflict');
  const matches=[...html.toString('utf8').matchAll(/<img src="data:image\/png;base64,([^"]+)"/gu)];
  ensure(matches.length===maskedPlan.frame_count,
    'Exact masked images are missing from R59 ZIP HTML','Conflict');
  const frames=[];
  for(let i=0;i<matches.length;i++){
    const pixels=Buffer.from(matches[i][1],'base64');
    let png;
    try{png=PNG.sync.read(pixels,{checkCRC:true});}catch{
      throw new NativeError('InvalidArgument','R59 masked PNG cannot be decoded safely');
    }
    ensure(png.width===maskedPlan.width&&png.height===maskedPlan.height&&
      SHA(png.data)===maskedPlan.masks[i].masked_pixel_sha256&&
      manifest.screenshots[i].source_evidence_id===maskedPlan.masks[i].derived_evidence_id,
      'Embedded R59 image pixels or Native evidence differ from approved R55 mask','Conflict');
    frames.push({
      shot_id:maskedPlan.masks[i].shot_id,
      label:manifest.screenshots[i].label,
      alt:manifest.screenshots[i].alt,
      normalized_png:Buffer.from(pixels)
    });
  }
  return{bundle_sha256:SHA(bytes),manifest_sha256:SHA(manifestBytes),
    r59_html_sha256:SHA(html),media_output:records[0],
    native_media_version:records[0].version,
    frames,masked_manifest:manifest};
}
export async function planOfflineHotspots(app,{
  masked_plan,masked_request,source_dir,links,
  acknowledge_mask_scope_only=false,acknowledge_private_only=false
}={}){
  ensure(acknowledge_mask_scope_only===true&&acknowledge_private_only===true,
    'Hotspots are a static private viewer; masking does not prove privacy outside rectangles',
    'ConsentRequired');
  const sourceData=await source(app,masked_plan,masked_request,source_dir);
  const validated=sanitizeLinks(links,masked_plan);
  avoidMaskedPixels(validated,masked_request);
  const core={
    schema_version:OFFLINE_HOTSPOT_SCHEMA,
    r59_plan_sha256:masked_plan.plan_sha256,
    r59_bundle_sha256:sourceData.bundle_sha256,
    r59_manifest_sha256:sourceData.manifest_sha256,
    r59_html_sha256:sourceData.r59_html_sha256,
    r59_media_output_id:sourceData.media_output.id,
    r59_media_output_version:sourceData.native_media_version,
    media_plan_digest:masked_plan.media_plan_digest,
    release_id:masked_plan.release_id,
    width:masked_plan.width,height:masked_plan.height,
    frame_count:masked_plan.frame_count,
    links:validated,
    technical_state:'UNKNOWN',
    masking_scope_only:true,private_only:true,
    source_scripts_executed:false,
    pixel_privacy_outside_masks_verified:false,
    customer_capture_accepted:false,
    no_native_media_output_created:true,
    external_publication:false,platform_authority:false
  };
  return{...core,plan_sha256:digest('r61-offline-hotspots',core)};
}
export async function verifyOfflineHotspots(app,plan,args){
  validateValue(plan);
  exact(plan,[
    'schema_version','r59_plan_sha256','r59_bundle_sha256','r59_manifest_sha256',
    'r59_html_sha256','r59_media_output_id','r59_media_output_version',
    'media_plan_digest','release_id','width','height','frame_count','links',
    'technical_state','masking_scope_only','private_only',
    'source_scripts_executed','pixel_privacy_outside_masks_verified',
    'customer_capture_accepted','no_native_media_output_created',
    'external_publication','platform_authority','plan_sha256'
  ]);
  const {plan_sha256,...core}=plan;
  ensure(hash(plan_sha256)&&digest('r61-offline-hotspots',core)===plan_sha256,
    'Private hotspot plan was modified','Conflict');
  const expected=await planOfflineHotspots(app,args);
  ensure(JSON.stringify(expected)===JSON.stringify(plan),
    'R55 masks, R59 ZIP, Native Media receipt or hotspot routing has changed',
    'StaleReference');
  return expected;
}
export async function exportOfflineHotspots(app,plan,args,outDir,{
  confirm_plan_sha256,confirm_r59_bundle_sha256,
  acknowledge_private_export=false,
  acknowledge_privacy_outside_masks_unknown=false
}={}){
  await verifyOfflineHotspots(app,plan,args);
  ensure(confirm_plan_sha256===plan.plan_sha256&&
    confirm_r59_bundle_sha256===plan.r59_bundle_sha256&&
    acknowledge_private_export===true&&
    acknowledge_privacy_outside_masks_unknown===true,
    'Confirm exact hotspot/r59 ZIP hashes, private export and privacy UNKNOWN',
    'ConsentRequired');
  const dir=privateDirectory(outDir);
  return withInteractiveDemoLock(app.store.root,async()=>{
    const sourceData=await source(app,args.masked_plan,args.masked_request,args.source_dir);
    const built=await renderHotspotWalkthrough(sourceData,plan,args.masked_plan);
    const prefix='launchwright-hotspot-demo-'+plan.plan_sha256.slice(0,12);
    const receipt={
      schema_version:'launchwright-r61-offline-hotspot-receipt/1',
      plan_sha256:plan.plan_sha256,
      r59_bundle_sha256:plan.r59_bundle_sha256,
      r59_media_output_id:plan.r59_media_output_id,
      hotspot_zip_sha256:SHA(built.bytes),html_sha256:built.html_sha256,
      hotspot_count:plan.links.length,frame_count:plan.frame_count,
      source_mask_sha256s:args.masked_plan.masks.map(m=>m.masked_pixel_sha256),
      technical_state:'UNKNOWN',private_only:true,
      customer_capture_accepted:false,
      pixel_privacy_outside_masks_verified:false,
      native_media_output_created:false,
      source_application_actions_executed:false,
      remote_network:false,external_publication:false,
      platform_authority:false
    };
    const files=[
      {name:prefix+'.zip',bytes:built.bytes},
      {name:prefix+'.receipt.json',bytes:Buffer.from(JSON.stringify(receipt,null,2)+'\n')}
    ];
    for(const file of files){
      const path=join(dir,file.name);
      if(!existsSync(path))continue;
      const st=lstatSync(path);
      ensure(st.isFile()&&!st.isSymbolicLink()&&
        (process.platform==='win32'||(st.mode&0o077)===0)&&
        SHA(readFileSync(path))===SHA(file.bytes),
        'A private derived demo file was modified; refuse overwrite','Conflict');
    }
    let created=0;
    for(const file of files){
      const path=join(dir,file.name);
      if(existsSync(path))continue;
      writeFileSync(path,file.bytes,{mode:0o600,flag:'wx'});
      created++;
    }
    return{
      ...receipt,bundle_filename:files[0].name,
      files_created:created,recovered:created===0,
      parent_media_technical:'UNKNOWN',derived_html_navigation_only:true
    };
  });
}
