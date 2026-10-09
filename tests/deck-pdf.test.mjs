// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync,mkdirSync,readFileSync,writeFileSync,
  existsSync,rmSync,chmodSync,symlinkSync,statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { execute } from '../src/application.mjs';
import { parseDeckMarkdown,planDeckPdf,verifyDeckPdf,exportDeckPdf } from '../src/deck-pdf.mjs';
import { renderDeckFormats } from '../src/deck-renderers.mjs';
import { setup,baseline } from './helpers.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const worktree=fileURLToPath(new URL('../',import.meta.url));
const CONTENT=[
  '## Scope for reviewers',
  '- Candidate content is frozen and remains editorial until approved.',
  '- One approved source paragraph is projected to two editable formats.',
  '## Source evidence',
  '- Technical state is UNKNOWN until independent runtime checks exist.',
  '- Release notes are not automatically published in external systems.'
].join('\n');
async function fixture(t,{review=true,content=CONTENT}={}){
  const {app,root}=setup(t),b=await baseline(app);
  const output=mkdtempSync(join(tmpdir(),'launchwright-r42-private-'));
  if(process.platform!=='win32')chmodSync(output,0o700);
  t.after(()=>rmSync(output,{recursive:true,force:true,maxRetries:5,retryDelay:50}));
  const d=await execute(app,'entity.update',{id:b.deliverable.id,
    expected:b.deliverable.version,data:{...b.deliverable.data,content}});
  const artifact=(await execute(app,'deliverable.render',{id:d.entity.id})).entity;
  const candidate=(await execute(app,'candidate.freeze',{
    release_id:b.release.id,name:'Editorial source to deck',
    artifact_ids:[artifact.id],destination:'private-deck-review',
    contract:{version:'r42',required_reviewers:1,require_claims_verified:false}
  })).entity;
  if(review)await execute(app,'candidate.review',{
    id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,
    decision:'approve-editorial',comment:'Accept this exact synthetic reviewer draft'
  });
  const options={candidate_id:candidate.id,artifact_id:artifact.id,
    acknowledge_draft_only:true,acknowledge_unverified:true};
  const confirm=p=>({confirm_plan_sha256:p.plan_sha256,
    confirm_candidate_sha256:p.candidate_sha256,acknowledge_private_export:true});
  return{app,root,b,deliverable:d.entity,artifact,candidate,output,options,confirm};
}
test('R42 creates real PPTX with editable text and real matching PDF pages from frozen approved source',async t=>{
  const f=await fixture(t);
  const plan=planDeckPdf(f.app,f.options);
  assert.equal(plan.content_slides,2);
  assert.equal(plan.total_pages,4);
  assert.equal(plan.technical_state,'UNKNOWN');
  assert.equal(plan.publication_authority,false);
  assert.equal(verifyDeckPdf(f.app,plan),plan);
  const receipt=await exportDeckPdf(f.app,plan,f.output,f.confirm(plan));
  assert.equal(receipt.files_created,3);
  assert.equal(receipt.page_count,4);
  assert.equal(receipt.published,false);
  assert.equal(receipt.external_service_contacted,false);
  const names=Object.keys(receipt.files);
  assert.equal(names.length,2);
  const pptxName=names.find(x=>x.endsWith('.pptx'));
  const pdfName=names.find(x=>x.endsWith('.pdf'));
  const bytes=readFileSync(join(f.output,pptxName));
  const pdf=readFileSync(join(f.output,pdfName));
  assert.equal(hash(bytes),receipt.files[pptxName].sha256);
  assert.equal(hash(pdf),receipt.files[pdfName].sha256);
  const pptx=await JSZip.loadAsync(bytes,{checkCRC32:true});
  const slides=Object.keys(pptx.files).filter(x=>/^ppt\/slides\/slide\d+\.xml$/u.test(x));
  assert.equal(slides.length,4);
  const xml=(await Promise.all(slides.map(x=>pptx.file(x).async('string')))).join('\n');
  for(const token of ['Release notes','Scope for reviewers','Source evidence',
    'Technical state is UNKNOWN','Candidate content is frozen',
    'NOT PUBLISHED','Source and review'])
    assert.ok(xml.includes(token),'Editable PowerPoint omitted approved content: '+token);
  const pdfDoc=await PDFDocument.load(pdf);
  assert.equal(pdfDoc.getPageCount(),4);
  assert.equal(pdfDoc.getTitle(),'Launchwright frozen editorial deck');
  assert.equal(pdfDoc.getPage(0).getWidth(),960);
  assert.equal(pdfDoc.getPage(0).getHeight(),540);
  assert.equal(receipt.editable_pptx,true);
  assert.equal(receipt.editorial_state,'DRAFT_REVIEW_REQUIRED');
});
test('R42 repeated render is binary deterministic for exact-source idempotent replay',async t=>{
  const f=await fixture(t),artifact=f.app.store.readBlob(f.artifact.data.sha256).bytes;
  const model=parseDeckMarkdown(artifact);
  const a=await renderDeckFormats(model,hash(artifact));
  await new Promise(resolve=>setTimeout(resolve,1250));
  const b=await renderDeckFormats(model,hash(artifact));
  assert.equal(hash(a.pptx),hash(b.pptx),'PPTX must not embed uncontrolled timestamps or random bytes');
  assert.equal(hash(a.pdf),hash(b.pdf),'PDF must not embed uncontrolled timestamps or random bytes');
});
test('R42 exact repeated export reuses all reviewed bytes; partial result resumes without clobber',async t=>{
  const f=await fixture(t),plan=planDeckPdf(f.app,f.options);
  const first=await exportDeckPdf(f.app,plan,f.output,f.confirm(plan));
  const again=await exportDeckPdf(f.app,plan,f.output,f.confirm(plan));
  assert.equal(again.recovered,true);
  assert.equal(again.files_created,0);
  assert.deepEqual(first.files,again.files);
  const pdfName=Object.keys(first.files).find(n=>n.endsWith('.pdf'));
  const manifest='launchwright-deck-'+plan.plan_sha256.slice(0,12)+'.receipt.json';
  rmSync(join(f.output,pdfName));rmSync(join(f.output,manifest));
  const partial=await exportDeckPdf(f.app,plan,f.output,f.confirm(plan));
  assert.equal(partial.files_created,2);
  assert.deepEqual(partial.files,first.files);
});
test('R42 mismatched existing files and symlink destination fail before any overwrite',async t=>{
  const f=await fixture(t),plan=planDeckPdf(f.app,f.options);
  const first=await exportDeckPdf(f.app,plan,f.output,f.confirm(plan));
  const pdfName=Object.keys(first.files).find(x=>x.endsWith('.pdf'));
  const path=join(f.output,pdfName);
  writeFileSync(path,Buffer.from('edited human-owned PDF'));
  await assert.rejects(exportDeckPdf(f.app,plan,f.output,f.confirm(plan)),{code:'Conflict'});
  assert.equal(readFileSync(path,'utf8'),'edited human-owned PDF');
  if(process.platform!=='win32'){
    const next=mkdtempSync(join(tmpdir(),'launchwright-r42-public-'));
    t.after(()=>rmSync(next,{recursive:true,force:true}));
    chmodSync(next,0o755);
    await assert.rejects(exportDeckPdf(f.app,plan,next,f.confirm(plan)),{code:'PermissionDenied'});
    const symlink=join(f.root,'symlink-export');
    symlinkSync(f.output,symlink);
    await assert.rejects(exportDeckPdf(f.app,plan,symlink,f.confirm(plan)),{code:'PermissionDenied'});
  }
});
test('R42 technical UNKNOWN requires acknowledgement; editorial approval is independent',async t=>{
  const notReviewed=await fixture(t,{review:false});
  assert.throws(()=>planDeckPdf(notReviewed.app,notReviewed.options),{code:'ConsentRequired'});
  const reviewed=await fixture(t);
  assert.throws(()=>planDeckPdf(reviewed.app,{
    ...reviewed.options,acknowledge_unverified:false}),{code:'ConsentRequired'});
  assert.throws(()=>planDeckPdf(reviewed.app,{
    ...reviewed.options,acknowledge_draft_only:false}),{code:'ConsentRequired'});
  assert.equal(reviewed.app.list('artifact').length,1,'Denied deck approval cannot mutate frozen source');
});
test('R42 input-plan tampering and explicit confirmation mismatches are denied before private writes',async t=>{
  const f=await fixture(t),plan=planDeckPdf(f.app,f.options);
  assert.throws(()=>verifyDeckPdf(f.app,{...plan,page_count:100}),{code:'Conflict'});
  await assert.rejects(exportDeckPdf(f.app,plan,f.output,{
    ...f.confirm(plan),confirm_candidate_sha256:'a'.repeat(64)
  }),{code:'ConsentRequired'});
  await assert.rejects(exportDeckPdf(f.app,plan,f.output,{
    ...f.confirm(plan),acknowledge_private_export:false
  }),{code:'ConsentRequired'});
  assert.equal(Object.keys(await import('node:fs').then(m=>m.readdirSync(f.output))).length,0);
});
test('R42 rejects ambiguous Markdown/tables/code, excessive bullets and unsupported format rather than truncating',()=>{
  const parse=value=>parseDeckMarkdown(Buffer.from(value));
  for(const value of [
    'not a heading\n\nHello',
    '# Short\n## Empty',
    '# Short\n## One\n| table | row |',
    '# Short\n## One\n---\n',
    '# Short\n## One\n- [x] task',
    '# Short\n## One\n- '+('A'.repeat(109)),
    '# Short\n'+Array.from({length:8},(_,i)=>'## Section '+i+'\n- content').join('\n'),
    '# Short\n## One\n'+Array.from({length:6},()=>'- repeat').join('\n'),
  ])assert.throws(()=>parse(value),'Unsafe Markdown was not rejected: '+value.slice(0,30));
});

test('R42 non-WinAnsi text is rejected explicitly rather than rendering replacement glyphs',async()=>{
  const content=parseDeckMarkdown(Buffer.from('# Title\n## One\n- An emoji 😀 needs an embedded licensed font'));
  await assert.rejects(renderDeckFormats(content,'a'.repeat(64)),
    /cannot encode|WinAnsi|outside|character|glyph|Invalid/u);
});


test('R42 operator CLI two-phase private plan, explicit apply and exact lost-response recovery',async t=>{
  const f=await fixture(t);
  const saved=join(f.root,'private-deck-plan.json');
  const cli=args=>spawnSync(process.execPath,['scripts/deck-pdf.mjs',...args],
    {cwd:worktree,encoding:'utf8',timeout:15000});
  const planArgs=['plan','--state',f.root,'--candidate',f.candidate.id,
    '--artifact',f.artifact.id,'--out',saved,
    '--acknowledge-draft','--acknowledge-unverified'];
  const prepared=cli(planArgs);
  assert.equal(prepared.status,0,prepared.stdout+prepared.stderr);
  const plan=JSON.parse(readFileSync(saved,'utf8'));
  if(process.platform!=='win32')assert.equal(statSync(saved).mode&0o077,0);
  assert.equal(JSON.parse(prepared.stdout).workspace_mutated,false);
  assert.notEqual(cli(planArgs).status,0,'Private plans cannot be overwritten');
  const actual=['export','--state',f.root,'--plan',saved,'--out-dir',f.output,
    '--confirm-plan',plan.plan_sha256,
    '--confirm-candidate',plan.candidate_sha256,'--acknowledge-private-export'];
  const first=cli(actual);
  assert.equal(first.status,0,first.stdout+first.stderr);
  const receipt=JSON.parse(first.stdout);
  assert.equal(receipt.page_count,plan.total_pages);
  assert.equal(receipt.files_created,3);
  const replay=cli(actual);
  assert.equal(replay.status,0,replay.stdout+replay.stderr);
  assert.equal(JSON.parse(replay.stdout).recovered,true);
  assert.equal(JSON.parse(replay.stdout).files_created,0);
});
test('R42 stale input candidate and unsupported layout fail before generating any private exports',async t=>{
  const f=await fixture(t);
  const plan=planDeckPdf(f.app,f.options);
  await execute(f.app,'entity.update',{id:f.deliverable.id,expected:f.deliverable.version,
    data:{...f.deliverable.data,content:'## Replaced source\n- A newer and unrelated revision'}});
  await assert.rejects(exportDeckPdf(f.app,plan,f.output,f.confirm(plan)));
  assert.equal((await import('node:fs')).readdirSync(f.output).length,0);

  const oversized=await fixture(t,{
    content:'# Not copied from editor\n'+
      '## One\n'+Array.from({length:5},()=>'- '+('Very verbose, readable text '.repeat(3))).join('\n')
  });
  assert.throws(()=>planDeckPdf(oversized.app,oversized.options));
});
