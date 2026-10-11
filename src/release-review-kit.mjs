// SPDX-License-Identifier: AGPL-3.0-only
// R64: an exact release-scoped private kit across separate existing renderers.
// No second backend, no newly inferred technical PASS or remote publication.
import { createHash } from 'node:crypto';
import { closeSync,existsSync,lstatSync,openSync,readFileSync,unlinkSync,writeFileSync } from 'node:fs';
import { isAbsolute,join } from 'node:path';
import JSZip from 'jszip';
import { requireCondition as ensure, validateValue, NativeError } from '@semwright/native-sdk';
import { digest } from './base.mjs';
import { verifyStaticDocsPlan } from './static-docs.mjs';
import { verifyDeckPdf,parseDeckMarkdown } from './deck-pdf.mjs';
import { renderDeckFormats } from './deck-renderers.mjs';
import { renderReviewKit } from './release-review-kit-view.mjs';

export const REVIEW_KIT_SCHEMA='launchwright-release-review-kit/1';
const sha=x=>createHash('sha256').update(x).digest('hex');
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/u.test(x);
const exact=(v,keys,required=keys)=>{
  ensure(v&&typeof v==='object'&&!Array.isArray(v)&&
    Object.keys(v).every(k=>keys.includes(k))&&required.every(k=>Object.hasOwn(v,k)),
    'Release kit contains unexpected or missing fields','InvalidArgument');
};
function privateFolder(path){
  ensure(typeof path==='string'&&isAbsolute(path)&&path.length<=2048,
    'Choose an existing absolute private folder','InvalidArgument');
  const st=lstatSync(path);
  ensure(st.isDirectory()&&!st.isSymbolicLink()&&
    (process.platform==='win32'||(st.mode&0o077)===0),
    'Source and output folders must be owner-only 0700 directories','PermissionDenied');
  return path;
}
function loadFile(dir,name,max=24*1024*1024){
  ensure(/^[a-z0-9][a-z0-9.-]{1,150}$/u.test(name)&&!name.includes('..'),
    'Only known safe export filenames are supported','InvalidArgument');
  const path=join(privateFolder(dir),name),st=lstatSync(path);
  ensure(st.isFile()&&!st.isSymbolicLink()&&st.size>0&&st.size<=max&&
    (process.platform==='win32'||(st.mode&0o077)===0),
    'Source is not a private 0600 file within its size limit','PermissionDenied');
  return readFileSync(path);
}
function readReceipt(dir,name){
  const bytes=loadFile(dir,name,64*1024);
  let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{}
  ensure(value&&typeof value==='object'&&!Array.isArray(value),
    'Export receipt must be valid JSON','InvalidArgument');
  return value;
}
async function contents(zipBytes,prefix,max=16){
  const archive=await JSZip.loadAsync(zipBytes,{checkCRC32:true});
  const names=Object.keys(archive.files).sort();
  ensure(names.length>=3&&names.length<=max,
    'External archive has an unexpected entry count','ResourceExhausted');
  let total=0;
  const entries=[];
  for(const name of names){
    ensure(!archive.files[name].dir&&
      /^(?:README\.txt|[a-z][a-z0-9-]{0,42}\.(?:html|json|txt))$/u.test(name),
      'Source archive contains nested/executable/ambiguous paths','PolicyDenied');
    const bytes=await archive.file(name).async('nodebuffer');
    total+=bytes.length;
    ensure(total<=25*1024*1024,
      'Expanded review source exceeds size budget','ResourceExhausted');
    if(name.endsWith('.html')){
      const html=bytes.toString('utf8');
      ensure(html.includes('Content-Security-Policy')&&
        html.includes("script-src &#39;none&#39;")&&
        html.includes("connect-src &#39;none&#39;")&&
        !/<script\b|<iframe\b|<object\b|https?:\/\//iu.test(html),
        'Bundled HTML must retain exact source CSP and no active network/code',
        'PolicyDenied');
    }
    entries.push({name:prefix+'/'+name,bytes});
  }
  ensure(entries.some(f=>f.name===prefix+'/index.html'),
    'Selected source archive has no offline index','Conflict');
  return entries;
}
async function docsSource(app,input){
  exact(input,['plan','directory']);
  const p=input.plan;
  await verifyStaticDocsPlan(app,p);
  const prefix='launchwright-docs-'+p.plan_sha256.slice(0,12);
  const receipt=readReceipt(input.directory,prefix+'.receipt.json');
  ensure(receipt.schema_version==='launchwright-static-docs-receipt/1'&&
    receipt.plan_sha256===p.plan_sha256&&receipt.candidate_sha256===p.candidate_sha256&&
    receipt.release_id===p.release_id&&receipt.release_build===p.release_build&&
    receipt.archive_sha256===p.output_zip_sha256&&
    receipt.archive_bytes===p.output_zip_bytes&&
    receipt.html_pages===p.page_count&&receipt.links_verified===true&&
    receipt.code_examples_inert===true&&receipt.private_only===true&&
    receipt.published===false&&receipt.platform_authority===false&&
    receipt.customer_acceptance===false&&receipt.technical_state==='UNKNOWN'&&
    receipt.source_rights_operator_declared===true&&
    receipt.source_rights_independently_verified===false,
    'Static docs receipt does not attest the exact private frozen source','Conflict');
  const zip=loadFile(input.directory,prefix+'.zip');
  ensure(sha(zip)===receipt.archive_sha256&&zip.length===receipt.archive_bytes,
    'Docs ZIP differs from immutable source receipt','Conflict');
  const files=await contents(zip,'docs');
  const entry=files.find(f=>f.name==='docs/manifest.json');
  ensure(!!entry,'Static docs manifest not present','Conflict');
  const m=JSON.parse(entry.bytes.toString('utf8'));
  ensure(m.candidate_sha256===p.candidate_sha256&&m.release_build===p.release_build&&
    m.links_verified===true&&m.code_samples_inert===true,
    'Docs archive belongs to another candidate or unverified link graph','Conflict');
  return{plan:p,files,zip_sha256:sha(zip),
    receipt_sha256:sha(Buffer.from(JSON.stringify(receipt,null,2)+'\n'))};
}
async function deckSource(app,input){
  exact(input,['plan','directory']);
  const p=input.plan;
  verifyDeckPdf(app,p);
  const prefix='launchwright-deck-'+p.plan_sha256.slice(0,12);
  const receipt=readReceipt(input.directory,prefix+'.receipt.json'),
    pptx=loadFile(input.directory,prefix+'.pptx'),
    pdf=loadFile(input.directory,prefix+'.pdf');
  ensure(receipt.schema_version==='launchwright-deck-pdf-receipt/1'&&
    receipt.plan_sha256===p.plan_sha256&&receipt.candidate_sha256===p.candidate_sha256&&
    receipt.frozen_markdown_sha256===p.markdown_sha256&&
    receipt.page_count===p.total_pages&&
    receipt.technical_state==='UNKNOWN'&&
    receipt.editable_pptx===true&&receipt.pdf_rendered===true&&
    receipt.editorial_state==='DRAFT_REVIEW_REQUIRED'&&
    receipt.published===false&&receipt.platform_authority===false&&
    receipt.external_service_contacted===false&&
    receipt.semantic_verification_performed===false,
    'Deck receipt does not match the exact reviewed private candidate','Conflict');
  ensure(Object.keys(receipt.files).length===2,
    'Deck export has unexpected files','Conflict');
  for(const [name,bytes] of [[prefix+'.pptx',pptx],[prefix+'.pdf',pdf]]){
    ensure(receipt.files[name]?.sha256===sha(bytes)&&
      receipt.files[name]?.bytes===bytes.length,
      'Editable deck/PDF bytes differ from source receipt','Conflict');
  }
  ensure(pptx.subarray(0,2).toString()==='PK'&&
    pdf.subarray(0,5).toString()==='%PDF-',
    'Deck/PDF are not the source renderer binary formats','Conflict');
  // Unlike the R45 docs plan, the R42 plan does not pin resulting PPTX
  // bytes. Re-render from its actual frozen Native source to reject forged
  // receipts that could otherwise smuggle edited OOXML/macro payloads.
  const original=app.store.readBlob(p.markdown_sha256).bytes;
  ensure(sha(original)===p.markdown_sha256&&original.length===p.markdown_bytes,
    'Native candidate source bytes drifted','Conflict');
  const rendered=await renderDeckFormats(parseDeckMarkdown(original),p.markdown_sha256);
  ensure(rendered.pptx.equals(pptx)&&rendered.pdf.equals(pdf),
    'Supplied deck/PDF bytes are not the canonical frozen source renderer output',
    'Conflict');
  return{plan:p,receipt_sha256:sha(Buffer.from(JSON.stringify(receipt,null,2)+'\n')),files:[
    {name:'deck/release-deck.pptx',bytes:pptx},
    {name:'deck/release-deck.pdf',bytes:pdf}
  ]};
}
async function demoSource(app,input,release){
  exact(input,['plan','directory']);
  const p=input.plan;
  validateValue(p);
  ensure(p?.schema_version==='launchwright-r61-masked-hotspot-plan/1',
    'Optional offline demo requires exact R61 masked CSS-only hotspots',
    'InvalidArgument');
  const {plan_sha256,...core}=p;
  ensure(hex(plan_sha256)&&digest('r61-offline-hotspots',core)===plan_sha256,
    'Offline hotspot intent was modified','Conflict');
  ensure(p.release_id===release.id&&p.private_only===true&&
    p.technical_state==='UNKNOWN'&&p.pixel_privacy_outside_masks_verified===false&&
    p.customer_capture_accepted===false&&p.external_publication===false&&
    p.platform_authority===false,
    'Optional demo cannot claim customer capture, privacy proof or publication',
    'PermissionDenied');
  const media=app.get(p.r59_media_output_id,'media_output');
  ensure(media.data.release_id===release.id&&
    media.data.artifact_sha256===p.r59_bundle_sha256&&
    media.data.technical_effective==='UNKNOWN'&&
    media.data.authority==='imported'&&
    JSON.stringify(media.version)===JSON.stringify(p.r59_media_output_version),
    'Demo source is not the exact currently registered Native Media output',
    'StaleReference');
  const mediaPlan=app.get(media.data.plan_id,'media_plan');
  ensure(mediaPlan.data.plan_digest===p.media_plan_digest&&
    app.read('media.inspect',{id:mediaPlan.id}).source_freshness==='CURRENT',
    'Demo Media source pins changed','StaleReference');
  const prefix='launchwright-hotspot-demo-'+p.plan_sha256.slice(0,12);
  const receipt=readReceipt(input.directory,prefix+'.receipt.json');
  const zip=loadFile(input.directory,prefix+'.zip');
  ensure(receipt.schema_version==='launchwright-r61-offline-hotspot-receipt/1'&&
    receipt.plan_sha256===plan_sha256&&
    receipt.r59_bundle_sha256===p.r59_bundle_sha256&&
    receipt.r59_media_output_id===p.r59_media_output_id&&
    receipt.hotspot_zip_sha256===sha(zip)&&receipt.technical_state==='UNKNOWN'&&
    receipt.private_only===true&&receipt.customer_capture_accepted===false&&
    receipt.pixel_privacy_outside_masks_verified===false&&
    receipt.external_publication===false&&receipt.platform_authority===false&&
    receipt.native_media_output_created===false&&
    receipt.source_application_actions_executed===false,
    'Optional demo receipt/ZIP differs from exact masked Native source','Conflict');
  return{plan:p,zip_sha256:sha(zip),
    receipt_sha256:sha(Buffer.from(JSON.stringify(receipt,null,2)+'\n')),
    files:await contents(zip,'demo',12)};
}
export async function planReleaseReviewKit(app,raw){
  validateValue(raw);
  exact(raw,['docs','deck','demo','acknowledge_rights','acknowledge_private_only'],
    ['docs','deck','acknowledge_rights','acknowledge_private_only']);
  ensure(raw.acknowledge_rights===true&&raw.acknowledge_private_only===true,
    'Owner must declare rights and private-only distribution','ConsentRequired');
  const docs=await docsSource(app,raw.docs),deck=await deckSource(app,raw.deck);
  ensure(docs.plan.candidate_id===deck.plan.candidate_id&&
    docs.plan.candidate_sha256===deck.plan.candidate_sha256&&
    docs.plan.technical_state==='UNKNOWN'&&deck.plan.technical_state==='UNKNOWN',
    'All kit content must come from ONE frozen editorial-approved candidate',
    'Conflict');
  const candidate=app.get(docs.plan.candidate_id,'candidate'),
    release=app.get(candidate.data.release_id,'release');
  ensure(docs.plan.release_id===release.id&&
    docs.plan.release_build===release.data.build,
    'Release kit cannot mix release builds','Conflict');
  const demo=raw.demo?await demoSource(app,raw.demo,release):null;
  const body={
    schema_version:REVIEW_KIT_SCHEMA,
    release_id:release.id,release_build:release.data.build,
    candidate_id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,
    docs_plan_sha256:docs.plan.plan_sha256,docs_zip_sha256:docs.zip_sha256,
    docs_receipt_sha256:docs.receipt_sha256,
    deck_plan_sha256:deck.plan.plan_sha256,
    deck_receipt_sha256:deck.receipt_sha256,
    pptx_sha256:sha(deck.files[0].bytes),
    pdf_sha256:sha(deck.files[1].bytes),
    demo_plan_sha256:demo?.plan.plan_sha256??null,
    demo_zip_sha256:demo?.zip_sha256??null,
    demo_receipt_sha256:demo?.receipt_sha256??null,
    outputs:['offline-docs','editable-pptx','real-pdf',...(demo?['masked-offline-demo']:[])],
    technical_state:'UNKNOWN',private_only:true,rights_operator_declared:true,
    pixel_privacy_independently_verified:false,
    claims_independently_verified:false,customer_acceptance:false,
    published:false,platform_authority:false,external_network:false
  };
  return{...body,plan_sha256:digest('release-review-kit',body)};
}
export async function verifyReleaseReviewKit(app,plan,raw){
  validateValue(plan);
  exact(plan,['schema_version','release_id','release_build','candidate_id',
    'candidate_sha256','docs_plan_sha256','docs_zip_sha256','docs_receipt_sha256',
    'deck_plan_sha256','deck_receipt_sha256','pptx_sha256','pdf_sha256',
    'demo_plan_sha256','demo_zip_sha256','demo_receipt_sha256',
    'outputs','technical_state','private_only','rights_operator_declared',
    'pixel_privacy_independently_verified','claims_independently_verified',
    'customer_acceptance','published','platform_authority','external_network','plan_sha256']);
  const {plan_sha256,...core}=plan;
  ensure(hex(plan_sha256)&&digest('release-review-kit',core)===plan_sha256,
    'Review kit plan is not the original digest-bound request','Conflict');
  const actual=await planReleaseReviewKit(app,raw);
  ensure(JSON.stringify(actual)===JSON.stringify(plan),
    'One source/Native revision or selected output was changed','StaleReference');
  return plan;
}
export async function exportReleaseReviewKit(app,plan,raw,destination,{
  confirm_plan_sha256,confirm_candidate_sha256,acknowledge_export=false
}={}){
  await verifyReleaseReviewKit(app,plan,raw);
  ensure(confirm_plan_sha256===plan.plan_sha256&&
    confirm_candidate_sha256===plan.candidate_sha256&&acknowledge_export===true,
    'Owner must independently confirm exact plan and frozen candidate SHA',
    'ConsentRequired');
  privateFolder(destination);
  const docs=await docsSource(app,raw.docs),deck=await deckSource(app,raw.deck);
  const demo=raw.demo?await demoSource(app,raw.demo,
    app.get(plan.release_id,'release')):null;
  const entries=[
    {name:'index.html',bytes:Buffer.from(renderReviewKit(plan),'utf8')},
    ...docs.files,...deck.files,...(demo?.files??[])
  ];
  const manifest={
    schema_version:'launchwright-release-review-kit-manifest/1',
    plan_sha256:plan.plan_sha256,release_id:plan.release_id,
    release_build:plan.release_build,candidate_id:plan.candidate_id,
    candidate_sha256:plan.candidate_sha256,
    technical_state:'UNKNOWN',rights_operator_declared:true,
    rights_independently_verified:false,customer_acceptance:false,
    published:false,platform_authority:false,
    files:entries.map(e=>({name:e.name,bytes:e.bytes.length,sha256:sha(e.bytes)}))
  };
  entries.push({name:'manifest.json',bytes:Buffer.from(JSON.stringify(manifest,null,2)+'\n')});
  const zip=new JSZip();
  const fixed=new Date('2000-01-01T00:00:00.000Z');
  for(const e of entries)zip.file(e.name,e.bytes,{
    date:fixed,unixPermissions:'0600',createFolders:false
  });
  const bytes=Buffer.from(await zip.generateAsync({
    type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6},
    platform:'UNIX'
  }));
  ensure(bytes.length<=34*1024*1024,'Private review kit exceeds 34 MiB','ResourceExhausted');
  const name='launchwright-review-kit-'+plan.plan_sha256.slice(0,12);
  const receipt={
    schema_version:'launchwright-release-review-kit-receipt/1',
    plan_sha256:plan.plan_sha256,candidate_sha256:plan.candidate_sha256,
    release_id:plan.release_id,release_build:plan.release_build,
    zip_sha256:sha(bytes),zip_bytes:bytes.length,files_count:entries.length,
    technical_state:'UNKNOWN',private_only:true,published:false,
    platform_authority:false,external_network:false,customer_acceptance:false
  };
  const output=[
    {name:name+'.zip',bytes},
    {name:name+'.receipt.json',bytes:Buffer.from(JSON.stringify(receipt,null,2)+'\n')}
  ];
  const lock=join(app.store.root,'.release-review-kit.lock');
  let fd;
  try{fd=openSync(lock,'wx',0o600);}
  catch{throw new NativeError('Conflict',
    'Review kit export already in progress or stale lock requires manual review');}
  try{
    for(const item of output){
      const path=join(destination,item.name);
      if(!existsSync(path))continue;
      const st=lstatSync(path);
      ensure(st.isFile()&&!st.isSymbolicLink()&&
        (process.platform==='win32'||(st.mode&0o077)===0)&&
        sha(readFileSync(path))===sha(item.bytes),
        'Existing kit has been edited; no clobber or partial overwrite','Conflict');
    }
    let created=0;
    for(const item of output){
      const path=join(destination,item.name);
      if(existsSync(path))continue;
      writeFileSync(path,item.bytes,{mode:0o600,flag:'wx'});created++;
    }
    return{...receipt,filename:output[0].name,
      files_created:created,recovered:created===0};
  }finally{
    try{closeSync(fd);}finally{unlinkSync(lock);}
  }
}
