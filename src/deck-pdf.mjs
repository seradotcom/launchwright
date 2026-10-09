// SPDX-License-Identifier: AGPL-3.0-only
// R42: exact frozen editorial Markdown to a bounded editable deck and PDF.
// All source/candidate validation uses the existing Native application.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { requireCondition as ensure, validateValue, NativeError } from '@semwright/native-sdk';
import { digest } from './base.mjs';
import { renderDeckFormats } from './deck-renderers.mjs';

export const DECK_PDF_SCHEMA='launchwright-deck-pdf-intent/1';
const MAX_BYTES=12288,MAX_SECTIONS=7,MAX_ITEMS=5,MAX_TEXT=108;
const sha=v=>createHash('sha256').update(v).digest('hex');
const titleLine=/^# ([^\r\n]+)$/u;
const sectionLine=/^## ([^\r\n]+)$/u;
const safeTitle=value=>typeof value==='string'&&value.length>0&&value.length<=70&&
  !/[\x00-\x1f\x7f]/u.test(value);
function safeLine(value,label){
  ensure(typeof value==='string'&&value.length>0&&value.length<=MAX_TEXT&&
    !/[\x00-\x1f\x7f]/u.test(value),
    label+' must be nonempty, <=108 characters and have no controls','InvalidArgument');
  ensure(!/[*_~\[\]\\\x60<>]/u.test(value),
    label+' contains Markdown markup unsupported by this exact renderer','InvalidArgument');
}
export function parseDeckMarkdown(bytes){
  ensure(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=MAX_BYTES,
    'Frozen Markdown must be within 12 KiB','ResourceExhausted');
  let content;
  try{content=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/\r\n/gu,'\n');}
  catch{throw new NativeError('InvalidArgument','Frozen Markdown must be valid UTF-8');}
  ensure(!content.includes('\r')&&!content.includes('\0'),
    'Markdown has unexpected control bytes','InvalidArgument');
  const lines=content.replace(/\n+$/u,'').split('\n');
  ensure(lines.length>=2&&titleLine.test(lines[0]),
    'Deck Markdown must begin with one # title','InvalidArgument');
  const title=lines[0].slice(2).trim();
  ensure(safeTitle(title),'Deck title must be <=70 characters','InvalidArgument');
  const sections=[],provenance=[];
  let active=null;
  function start(name){
    ensure(safeTitle(name),'Slide heading must be short plain text','InvalidArgument');
    ensure(sections.length<MAX_SECTIONS,'Maximum seven content slides','ResourceExhausted');
    active={title:name,items:[]};sections.push(active);
  }
  for(const raw of lines.slice(1)){
    const line=raw.trim();
    if(!line)continue;
    if(sectionLine.test(line)){start(line.slice(3).trim());continue;}
    if(line.startsWith('>')){
      ensure(!active,'Source provenance allowed only before slide content','InvalidArgument');
      const value=line.replace(/^> ?/u,'').trim();
      if(value){safeLine(value,'Source provenance');provenance.push(value);}
      ensure(provenance.length<=5,'Source provenance exceeds five lines','ResourceExhausted');
      continue;
    }
    ensure(!line.startsWith('#')&&!line.startsWith('|')&&
      line!=='---'&&line!=='***'&&
      !line.startsWith('\x60\x60\x60'),
      'Tables/code or higher nesting need a deliberate renderer','InvalidArgument');
    const bullet=/^(?:[-*] |\d+[.] )/u.test(line);
    const text=bullet?line.replace(/^(?:[-*] |\d+[.] )/u,'').trim():line;
    safeLine(text,'Slide text');
    if(!active)start('Editorial content');
    ensure(active.items.length<MAX_ITEMS,
      'Maximum five readable items per slide; split headings instead of clipping',
      'ResourceExhausted');
    active.items.push({kind:bullet?'bullet':'paragraph',text});
  }
  ensure(sections.length>0&&sections.every(s=>s.items.length>0),
    'Every content slide must contain exact approved copy','InvalidArgument');
  return{title,sections,provenance};
}
function source(app,candidateId,artifactId,unverified){
  const candidate=app.get(candidateId,'candidate'),artifact=app.get(artifactId,'artifact');
  const frozen=(candidate.data.manifest.artifacts??[]).find(a=>a.id===artifactId);
  ensure(candidate.data.manifest.artifact_ids.includes(artifactId)&&frozen&&
    frozen.sha256===artifact.data.sha256&&frozen.bytes===artifact.data.size_bytes&&
    frozen.mime?.split(';')[0].trim().toLowerCase()==='text/markdown',
    'Input must be a frozen Markdown artifact of this candidate','PermissionDenied');
  const state=app.inspectCandidate(candidate);
  ensure(state.fresh&&state.private_draft_allowed&&
    state.editorial_review.state==='APPROVED_EDITORIAL',
    'Fresh candidate and explicit editorial approval required','ConsentRequired');
  if(state.technical_state!=='PASS')ensure(unverified===true,
    'Technical UNKNOWN requires explicit acknowledgement','ConsentRequired');
  const bytes=app.store.readBlob(frozen.sha256).bytes;
  ensure(bytes.length===frozen.bytes&&sha(bytes)===frozen.sha256,
    'Frozen source bytes differ from immutable candidate','Conflict');
  return{candidate,artifact,bytes,content:parseDeckMarkdown(bytes),
    technical:state.technical_state==='PASS'?'PASS':'UNKNOWN'};
}
export function planDeckPdf(app,{candidate_id,artifact_id,
  acknowledge_draft_only=false,acknowledge_unverified=false}={}){
  ensure(acknowledge_draft_only===true,
    'Private editorial export is not publication; acknowledge this',
    'ConsentRequired');
  const data=source(app,candidate_id,artifact_id,acknowledge_unverified);
  const core={
    schema_version:DECK_PDF_SCHEMA,
    candidate_id,candidate_sha256:data.candidate.data.candidate_sha256,
    artifact_id,markdown_sha256:sha(data.bytes),markdown_bytes:data.bytes.length,
    layout_sha256:digest('deck-source-layout',data.content),
    title:data.content.title,content_slides:data.content.sections.length,
    total_pages:data.content.sections.length+2,
    technical_state:data.technical,private_draft_only:true,
    acknowledge_unverified:acknowledge_unverified===true,
    editable_format:'pptx',pdf_format:'pdf',publication_authority:false,
    platform_authority:false,semantic_verification_performed:false
  };
  return{...core,plan_sha256:digest('deck-pdf-plan',core)};
}
export function verifyDeckPdf(app,plan){
  validateValue(plan);
  ensure(plan&&typeof plan==='object'&&!Array.isArray(plan),
    'Deck export plan must be an object','InvalidArgument');
  const {plan_sha256,...core}=plan;
  ensure(typeof plan_sha256==='string'&&/^[a-f0-9]{64}$/u.test(plan_sha256)&&
    digest('deck-pdf-plan',core)===plan_sha256,
    'Saved deck export intent differs from its original SHA','Conflict');
  const expected=planDeckPdf(app,{candidate_id:core.candidate_id,
    artifact_id:core.artifact_id,acknowledge_draft_only:core.private_draft_only,
    acknowledge_unverified:core.acknowledge_unverified});
  ensure(JSON.stringify(expected)===JSON.stringify(plan),
    'Deck candidate, original copy or authorization drifted','StaleReference');
  return plan;
}
function privateDirectory(path){
  ensure(typeof path==='string'&&isAbsolute(path)&&path.length<2048,
    'A preexisting private absolute output directory is required','InvalidArgument');
  const s=lstatSync(path);
  ensure(s.isDirectory()&&!s.isSymbolicLink()&&
    (process.platform==='win32'||(s.mode&0o077)===0),
    'Deck output directory must be a real private 0700 directory','PermissionDenied');
  return path;
}
export async function exportDeckPdf(app,plan,outdir,{
  confirm_plan_sha256,confirm_candidate_sha256,acknowledge_private_export=false
}={}){
  verifyDeckPdf(app,plan);
  ensure(confirm_plan_sha256===plan.plan_sha256&&
    confirm_candidate_sha256===plan.candidate_sha256&&
    acknowledge_private_export===true,
    'Confirm exact plan and candidate SHA before private file writes',
    'ConsentRequired');
  const dir=privateDirectory(outdir),data=source(app,plan.candidate_id,
    plan.artifact_id,plan.acknowledge_unverified);
  const pair=await renderDeckFormats(data.content,sha(data.bytes));
  ensure(pair.pages===plan.total_pages,'Renderer returned a different page count','Conflict');
  const prefix='launchwright-deck-'+plan.plan_sha256.slice(0,12);
  const assets=[
    {name:prefix+'.pptx',bytes:pair.pptx},
    {name:prefix+'.pdf',bytes:pair.pdf}
  ];
  const receipt={
    schema_version:'launchwright-deck-pdf-receipt/1',
    plan_sha256:plan.plan_sha256,candidate_sha256:plan.candidate_sha256,
    frozen_markdown_sha256:plan.markdown_sha256,
    page_count:pair.pages,technical_state:plan.technical_state,
    editable_pptx:true,pdf_rendered:true,editorial_state:'DRAFT_REVIEW_REQUIRED',
    files:Object.fromEntries(assets.map(a=>[a.name,{sha256:sha(a.bytes),bytes:a.bytes.length}])),
    external_service_contacted:false,published:false,platform_authority:false,
    semantic_verification_performed:false
  };
  const all=[...assets,{name:prefix+'.receipt.json',bytes:Buffer.from(
    JSON.stringify(receipt,null,2)+'\n')}];
  // A partial interrupted export can recover, but edited output is never clobbered.
  for(const a of all){
    const file=join(dir,a.name);
    if(!existsSync(file))continue;
    const stat=lstatSync(file);
    ensure(stat.isFile()&&!stat.isSymbolicLink()&&
      (process.platform==='win32'||(stat.mode&0o077)===0)&&
      sha(readFileSync(file))===sha(a.bytes),
      'Existing deck/PDF/receipt differ from exact reviewed intent','Conflict');
  }
  let created=0;
  for(const a of all){
    const file=join(dir,a.name);
    if(existsSync(file))continue;
    writeFileSync(file,a.bytes,{flag:'wx',mode:0o600});
    created++;
  }
  return{...receipt,files_created:created,recovered:created===0};
}
