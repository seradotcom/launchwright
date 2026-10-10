// SPDX-License-Identifier: AGPL-3.0-only
// R57: frozen approved editorial deck -> actual editable PPTX and PDF images
// sourced ONLY from exact R55 masked PNG + canonical Native derivative receipts.
// No independent privacy/rights certification, source execution or publication.
import { createHash } from 'node:crypto';
import { existsSync,lstatSync,readFileSync,writeFileSync,openSync,closeSync,unlinkSync } from 'node:fs';
import { isAbsolute,join } from 'node:path';
import { PNG } from 'pngjs';
import { requireCondition as ensure,validateValue,NativeError } from '@semwright/native-sdk';
import { digest } from './base.mjs';
import { planDeckPdf,parseDeckMarkdown } from './deck-pdf.mjs';
import { verifyPixelMask } from './pixel-redaction.mjs';
import { renderDeckFormats } from './deck-renderers.mjs';

export const MASKED_DECK_SCHEMA='launchwright-masked-deck-plan/1';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const isSha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/u.test(x);
const exact=(value,keys,required=keys)=>{
  ensure(value&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).every(k=>keys.includes(k))&&
    required.every(k=>Object.hasOwn(value,k)),
    'Masked deck has unsupported or missing input fields','InvalidArgument');
};
const privateFile=path=>{
  ensure(typeof path==='string'&&isAbsolute(path)&&path.length<=2048,
    'Masked screenshot needs explicit absolute private path','InvalidArgument');
  const st=lstatSync(path);
  ensure(st.isFile()&&!st.isSymbolicLink()&&st.size>100&&st.size<=12*1024*1024&&
    (process.platform==='win32'||(st.mode&0o077)===0),
    'Masked image must be a private 0600 PNG <=12MiB','PermissionDenied');
  return path;
};
function loadMaskedImage(path,mask){
  const bytes=readFileSync(privateFile(path));
  ensure(sha(bytes)===mask.masked_png_sha256&&
    bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&
    bytes.readUInt32BE(16)===mask.width&&bytes.readUInt32BE(20)===mask.height&&
    bytes[25]===2,
    'Masked screenshot is not exact RGB PNG from R55 source','Conflict');
  let image;
  try{image=PNG.sync.read(bytes,{checkCRC:true});}
  catch{throw new NativeError('InvalidArgument','Masked PNG could not be decoded safely');}
  ensure(image.width===mask.width&&image.height===mask.height&&
    sha(image.data)===mask.masked_pixel_sha256,
    'Decoded screenshot pixels differ from the R55 approved mask result','Conflict');
  return{png:bytes,width:mask.width,height:mask.height};
}
function validateMaskedEvidence(app,mask,receipt,deck,ordinal){
  exact(receipt,['schema_version','plan_sha256','original_evidence_id',
    'original_png_sha256','redacted_png_sha256','redacted_pixels_sha256',
    'masked_pixels','total_pixels','unmasked_pixels',
    'source_pixels_outside_mask_unchanged','opaque_mask_fill_rgb',
    'metadata_chunks_removed','technical_state','independent_privacy_review',
    'all_personal_information_removed','native_capture_class',
    'observed_state_eligible','external_service_called','platform_authority',
    'source_evidence_id','derived_evidence_id','derived_evidence_created',
    'output_filename','receipt_filename','files_created','recovered',
    'publication_authority'],
    ['schema_version','plan_sha256','original_evidence_id',
      'redacted_png_sha256','redacted_pixels_sha256',
      'source_pixels_outside_mask_unchanged','metadata_chunks_removed',
      'technical_state','independent_privacy_review',
      'all_personal_information_removed','derived_evidence_id']);
  ensure(receipt.schema_version==='launchwright-owned-pixel-mask-receipt/1'&&
    receipt.plan_sha256===mask.plan_sha256&&
    receipt.original_evidence_id===mask.parent_evidence_id&&
    receipt.redacted_png_sha256===mask.masked_png_sha256&&
    receipt.redacted_pixels_sha256===mask.masked_pixel_sha256&&
    receipt.source_pixels_outside_mask_unchanged===true&&
    receipt.metadata_chunks_removed===true&&
    receipt.technical_state==='UNKNOWN'&&
    receipt.independent_privacy_review===false&&
    receipt.all_personal_information_removed===false,
    'R55 receipt must retain exact mask result and explicit privacy UNKNOWN',
    'Conflict');
  const evidence=app.get(receipt.derived_evidence_id,'evidence');
  const transform=evidence.data.provenance?.transformations;
  ensure(evidence.data.evidence_type==='capture'&&
    evidence.data.classification==='sanitized'&&
    evidence.data.provenance?.capture_class==='SANITIZED_DERIVATIVE'&&
    evidence.data.parent_evidence_id===mask.parent_evidence_id&&
    Array.isArray(transform)&&transform.length===1&&
    transform[0].kind==='REDACT'&&
    transform[0].semantic_effect==='changes-observed-state'&&
    transform[0].operation_ref===mask.plan_sha256&&
    evidence.data.receipt?.provider==='launchwright-pixel-mask'&&
    evidence.data.receipt?.authority==='imported'&&
    evidence.data.receipt?.operation_id===mask.plan_sha256&&
    evidence.data.technical==='UNKNOWN'&&
    evidence.data.host_acceptance==='NOT_ESTABLISHED'&&
    evidence.data.observed_state_eligible===false&&
    evidence.data.release_id===deck.release_id&&
    evidence.data.target_id===deck.target_id&&
    evidence.data.build===deck.build&&
    evidence.data.rights===mask.rights&&
    evidence.data.observations.some(o=>o.kind==='pixel-mask'&&
      o.key==='output_png_sha256'&&o.value===mask.masked_png_sha256),
    'Deck screenshot is not a current exact Native R55 sanitized derivative',
    'PermissionDenied');
  return{
    ordinal,
    original_evidence_id:mask.parent_evidence_id,
    derived_evidence_id:evidence.id,
    derived_evidence_version:evidence.version,
    derived_origin_digest:evidence.data.origin_digest,
    r55_mask_plan_sha256:mask.plan_sha256,
    original_png_sha256:mask.source_png_sha256,
    masked_png_sha256:mask.masked_png_sha256,
    masked_pixel_sha256:mask.masked_pixel_sha256,
    image_path_sha256:null,
    width:mask.width,height:mask.height,masked_pixels:mask.masked_pixels,
    rights:mask.rights,
    technical_state:'UNKNOWN',
    independent_privacy_review:false
  };
}
function collect(app,request){
  validateValue(request);
  exact(request,['deck','screenshots',
    'acknowledge_mask_scope_only','acknowledge_private_deck_only']);
  ensure(request.acknowledge_mask_scope_only===true&&
    request.acknowledge_private_deck_only===true,
    'Operator must affirm mask-only privacy and private editorial draft',
    'ConsentRequired');
  exact(request.deck,['candidate_id','artifact_id','acknowledge_draft_only','acknowledge_unverified']);
  const deckPlan=planDeckPdf(app,request.deck);
  const candidate=app.get(deckPlan.candidate_id,'candidate');
  const frozen=app.get(deckPlan.artifact_id,'artifact');
  const bytes=app.store.readBlob(deckPlan.markdown_sha256).bytes;
  ensure(sha(bytes)===deckPlan.markdown_sha256&&
    frozen.data.release_id===candidate.data.release_id,
    'Deck frozen Markdown no longer agrees with source candidate','Conflict');
  const release=app.get(candidate.data.release_id,'release');
  const source={release_id:release.id,target_id:frozen.data.target_id,
    build:release.data.build};
  ensure(Array.isArray(request.screenshots)&&
    request.screenshots.length===deckPlan.content_slides&&
    request.screenshots.length>=1&&request.screenshots.length<=7,
    'Exactly one R55 masked screenshot is required for each source content slide',
    'ResourceExhausted');
  const used=new Set(),images=[],citations=[];
  let total=0;
  for(let i=0;i<request.screenshots.length;i++){
    const item=request.screenshots[i];
    exact(item,['mask_input','mask_plan','mask_receipt','masked_png_path']);
    const mask=verifyPixelMask(app,item.mask_plan,item.mask_input);
    const citation=validateMaskedEvidence(app,mask,item.mask_receipt,source,i+1);
    ensure(!used.has(citation.derived_evidence_id),
      'A single masked derivative cannot masquerade as two distinct slide captures',
      'Conflict');
    used.add(citation.derived_evidence_id);
    const image=loadMaskedImage(item.masked_png_path,mask);
    total+=image.png.length;
    ensure(total<=24*1024*1024,
      'Masked deck screenshots exceed 24 MiB memory/input budget',
      'ResourceExhausted');
    const pathSha=sha(Buffer.from(item.masked_png_path));
    citation.image_path_sha256=pathSha;
    citations.push(citation);images.push(image);
  }
  return{deckPlan,release,frozen,content:parseDeckMarkdown(bytes),
    citations,images,total};
}
export function prepareMaskedDeck(app,request){
  const x=collect(app,request);
  const core={
    schema_version:MASKED_DECK_SCHEMA,
    deck_plan_sha256:x.deckPlan.plan_sha256,
    candidate_id:x.deckPlan.candidate_id,
    candidate_sha256:x.deckPlan.candidate_sha256,
    artifact_id:x.deckPlan.artifact_id,
    markdown_sha256:x.deckPlan.markdown_sha256,
    release_id:x.release.id,
    build:x.release.data.build,
    slide_count:x.deckPlan.total_pages,
    screenshot_count:x.citations.length,
    screenshots:x.citations,
    declared_mask_scope_only:true,
    human_visual_privacy_certified:false,
    independent_source_device_accepted:false,
    technical_state:'UNKNOWN',external_publication:false,
    platform_authority:false,customer_acceptance:false
  };
  return{...core,plan_sha256:digest('masked-deck',core)};
}
export function verifyMaskedDeck(app,plan,request){
  validateValue(plan);
  exact(plan,['schema_version','deck_plan_sha256','candidate_id','candidate_sha256',
    'artifact_id','markdown_sha256','release_id','build','slide_count','screenshot_count',
    'screenshots','declared_mask_scope_only','human_visual_privacy_certified',
    'independent_source_device_accepted','technical_state','external_publication',
    'platform_authority','customer_acceptance','plan_sha256']);
  const {plan_sha256,...core}=plan;
  ensure(isSha(plan_sha256)&&digest('masked-deck',core)===plan_sha256,
    'Masked deck private plan was changed','Conflict');
  const candidate=app.get(plan.candidate_id,'candidate');
  ensure(app.inspectCandidate(candidate).fresh===true,
    'Frozen deck source is stale; do not reuse a previous approved mask/deck plan',
    'StaleReference');
  const expected=prepareMaskedDeck(app,request);
  ensure(JSON.stringify(expected)===JSON.stringify(plan),
    'Deck candidate, R55 masks, rights or Native source revisions drifted',
    'StaleReference');
  return plan;
}
const privateOut=dir=>{
  ensure(typeof dir==='string'&&isAbsolute(dir)&&dir.length<=2048,
    'Choose pre-existing absolute private output folder','InvalidArgument');
  const stat=lstatSync(dir);
  ensure(stat.isDirectory()&&!stat.isSymbolicLink()&&
    (process.platform==='win32'||(stat.mode&0o077)===0),
    'Masked deck output directory must have owner-only 0700 rights',
    'PermissionDenied');
  return dir;
};
async function locked(root,fn){
  const file=join(root,'.masked-deck-export.lock');
  let fd;
  try{fd=openSync(file,'wx',0o600);}
  catch{throw new NativeError('Conflict','Concurrent or crashed masked deck export requires operator review');}
  try{return await fn();}
  finally{try{closeSync(fd);}finally{unlinkSync(file);}}
}
export async function exportMaskedDeck(app,plan,request,outDir,{
  confirm_plan_sha256,confirm_candidate_sha256,
  acknowledge_private_export=false
}={}){
  verifyMaskedDeck(app,plan,request);
  ensure(confirm_plan_sha256===plan.plan_sha256&&
    confirm_candidate_sha256===plan.candidate_sha256&&
    acknowledge_private_export===true,
    'Confirm the exact private deck and frozen candidate SHA before file writes',
    'ConsentRequired');
  const dir=privateOut(outDir);
  return locked(app.store.root,async()=>{
    const x=collect(app,request);
    const outputs=await renderDeckFormats(x.content,plan.markdown_sha256,x.images);
    ensure(outputs.pages===plan.slide_count,
      'PPTX/PDF pages differ from reviewed masked-deck plan','Conflict');
    const prefix='launchwright-masked-deck-'+plan.plan_sha256.slice(0,12);
    const files=[
      {name:prefix+'.pptx',bytes:outputs.pptx},
      {name:prefix+'.pdf',bytes:outputs.pdf}
    ];
    const receipt={
      schema_version:'launchwright-masked-deck-receipt/1',
      plan_sha256:plan.plan_sha256,
      deck_plan_sha256:plan.deck_plan_sha256,
      candidate_sha256:plan.candidate_sha256,
      frozen_markdown_sha256:plan.markdown_sha256,
      screenshot_lineage:plan.screenshots,
      pages:outputs.pages,
      documents:Object.fromEntries(files.map(f=>[f.name,{
        sha256:sha(f.bytes),bytes:f.bytes.length
      }])),
      editable_pptx:true,real_pdf:true,
      technical_state:'UNKNOWN',mask_scope_only:true,
      independently_verified_pixel_privacy:false,
      customer_source_accepted:false,
      published:false,platform_authority:false,
      external_network_access_performed:false
    };
    files.push({name:prefix+'.receipt.json',
      bytes:Buffer.from(JSON.stringify(receipt,null,2)+'\n')});
    for(const f of files){
      const path=join(dir,f.name);
      if(!existsSync(path))continue;
      const st=lstatSync(path);
      ensure(st.isFile()&&!st.isSymbolicLink()&&
        (process.platform==='win32'||(st.mode&0o077)===0)&&
        sha(readFileSync(path))===sha(f.bytes),
        'Existing private deck output was edited or differs from approved source; do not overwrite',
        'Conflict');
    }
    let created=0;
    for(const f of files){
      const path=join(dir,f.name);
      if(existsSync(path))continue;
      writeFileSync(path,f.bytes,{flag:'wx',mode:0o600});
      created++;
    }
    return{...receipt,files_created:created,recovered:created===0};
  });
}
