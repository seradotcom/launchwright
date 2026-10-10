// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import { mkdtempSync,mkdirSync,chmodSync,readFileSync,writeFileSync,
  readdirSync,rmSync,symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { PNG } from 'pngjs';
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';
import { execute } from '../src/application.mjs';
import { makeOwnedInteractiveFixture } from './interactive-fixture.mjs';
import { preparePixelMask,applyPixelMask } from '../src/pixel-redaction.mjs';
import { prepareMaskedDeck,verifyMaskedDeck,exportMaskedDeck } from '../src/masked-deck.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sectionCopy=[
  '## Actual source data',
  '- This slide embeds a pixel-masked screenshot from a Native derivative.',
  '- All technical and privacy conclusions still require independent review.',
  '## Another exact screenshot',
  '- The reviewed candidate preserves unchanged copy and screenshot provenance.',
  '- No customer application is executed and nothing is published.'
].join('\n');
const privateDir=(root,label)=>{
  const dir=join(root,label);mkdirSync(dir,{mode:0o700});
  if(process.platform!=='win32')chmodSync(dir,0o700);
  return dir;
};
async function fixture(t,{count=2,content=sectionCopy}={}){
  const root=mkdtempSync(join(tmpdir(),'launchwright-r57-deck-'));
  const f=await makeOwnedInteractiveFixture(root,{framesCount:count,width:640,height:360});
  const maskDir=privateDir(root,'mask-output'),outDir=privateDir(root,'deck-output');
  t.after(()=>{f.close();rmSync(root,{recursive:true,force:true,maxRetries:4,retryDelay:50});});
  const draft=(await execute(f.app,'entity.update',{
    id:f.b.deliverable.id,expected:f.b.deliverable.version,
    data:{...f.b.deliverable.data,content}
  })).entity;
  const artifact=(await execute(f.app,'deliverable.render',{id:draft.id})).entity;
  const candidate=(await execute(f.app,'candidate.freeze',{
    release_id:f.b.release.id,name:'R57 reviewed masked deck source',
    artifact_ids:[artifact.id],destination:'owned-masked-deck-local',
    contract:{version:'r57',required_reviewers:1,require_claims_verified:false}
  })).entity;
  await execute(f.app,'candidate.review',{
    id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,
    decision:'approve-editorial',comment:'Owned R57 fixture copy editorial review'
  });
  const screenshots=[];
  for(let i=0;i<count;i++){
    const frame=f.frames[i],input={
      parent_evidence_id:f.plan.data.shots[i].capture_evidence_id,
      source_png_path:frame.png_path,
      source_png_sha256:frame.png_sha256,
      rights:'owned',
      rectangles:[
        {label:'customer-display',x:180,y:92,width:72,height:32},
        {label:'account-pane',x:280,y:218,width:54,height:25}
      ],
      acknowledge_source_rights:true,
      acknowledge_residual_privacy_unknown:true,
      acknowledge_masked_pixels:true
    };
    const plan=preparePixelMask(f.app,input);
    const receipt=await applyPixelMask(f.app,plan,input,maskDir,{
      confirm_plan_sha256:plan.plan_sha256,
      confirm_source_png_sha256:plan.source_png_sha256,
      acknowledge_private_file_write:true
    });
    screenshots.push({
      mask_input:input,mask_plan:plan,mask_receipt:receipt,
      masked_png_path:join(maskDir,receipt.output_filename)
    });
  }
  const request={
    deck:{candidate_id:candidate.id,artifact_id:artifact.id,
      acknowledge_draft_only:true,acknowledge_unverified:true},
    screenshots,acknowledge_mask_scope_only:true,
    acknowledge_private_deck_only:true
  };
  const approve=p=>({
    confirm_plan_sha256:p.plan_sha256,
    confirm_candidate_sha256:p.candidate_sha256,
    acknowledge_private_export:true
  });
  return {...f,root,maskDir,outDir,artifact,candidate,draft,
    request,approve};
}
function docs(root,plan){
  const stem='launchwright-masked-deck-'+plan.plan_sha256.slice(0,12);
  return{pptx:join(root,stem+'.pptx'),
    pdf:join(root,stem+'.pdf'),
    receipt:join(root,stem+'.receipt.json')};
}
test('R57 SHA-bound no-effects plan maps both exact R55 masks and Native derivatives to frozen deck without local file paths',async t=>{
  const f=await fixture(t),before=readdirSync(f.outDir);
  const plan=prepareMaskedDeck(f.app,f.request);
  assert.deepEqual(prepareMaskedDeck(f.app,f.request),plan);
  assert.deepEqual(verifyMaskedDeck(f.app,plan,f.request),plan);
  assert.equal(plan.slide_count,4);
  assert.equal(plan.screenshot_count,2);
  assert.equal(plan.technical_state,'UNKNOWN');
  assert.equal(plan.human_visual_privacy_certified,false);
  assert.equal(plan.platform_authority,false);
  assert.equal(plan.independent_source_device_accepted,false);
  assert.equal(plan.screenshots.length,2);
  assert.ok(!JSON.stringify(plan).includes(f.root));
  for(let i=0;i<2;i++){
    assert.equal(plan.screenshots[i].derived_evidence_id,
      f.request.screenshots[i].mask_receipt.derived_evidence_id);
    assert.equal(plan.screenshots[i].r55_mask_plan_sha256,
      f.request.screenshots[i].mask_plan.plan_sha256);
  }
  assert.deepEqual(readdirSync(f.outDir),before);
});

test('R57 real PPTX and PDF each embed the 2 exact R55 opaque-mask images with source lineage and editable text',async t=>{
  const f=await fixture(t),plan=prepareMaskedDeck(f.app,f.request);
  const result=await exportMaskedDeck(f.app,plan,f.request,f.outDir,f.approve(plan));
  assert.equal(result.files_created,3);
  assert.equal(result.pages,4);
  assert.equal(result.technical_state,'UNKNOWN');
  assert.equal(result.mask_scope_only,true);
  assert.equal(result.independently_verified_pixel_privacy,false);
  assert.equal(result.published,false);
  assert.equal(result.platform_authority,false);
  const paths=docs(f.outDir,plan);
  const pptx=readFileSync(paths.pptx),pdf=readFileSync(paths.pdf);
  assert.equal(sha(pptx),result.documents['launchwright-masked-deck-'+
    plan.plan_sha256.slice(0,12)+'.pptx'].sha256);
  assert.equal(sha(pdf),result.documents['launchwright-masked-deck-'+
    plan.plan_sha256.slice(0,12)+'.pdf'].sha256);
  const archive=await JSZip.loadAsync(pptx,{checkCRC32:true});
  const slides=Object.keys(archive.files).filter(x=>/^ppt\/slides\/slide\d+\.xml$/u.test(x));
  assert.equal(slides.length,4);
  const joined=(await Promise.all(slides.map(x=>archive.file(x).async('string')))).join('');
  for(const text of ['Actual source data','Another exact screenshot',
    'All technical and privacy conclusions','OPERATOR-MASKED PIXELS'])
    assert.ok(joined.includes(text),'Missing exact editable text: '+text);
  const imageFiles=Object.keys(archive.files).filter(n=>/^ppt\/media\/.+\.png$/u.test(n));
  assert.equal(imageFiles.length,2,'One independent replaceable image per source slide');
  const pixels=[];
  for(const path of imageFiles){
    const png=PNG.sync.read(await archive.file(path).async('nodebuffer'),{checkCRC:true});
    pixels.push(sha(png.data));
  }
  assert.deepEqual(new Set(pixels),new Set(
    plan.screenshots.map(x=>x.masked_pixel_sha256)));
  const parsed=await PDFDocument.load(pdf);
  assert.equal(parsed.getPageCount(),4);
  for(const idx of [1,2]){
    const page=parsed.getPage(idx);
    const resource=page.node.Resources();
    const xobjects=resource.lookup(PDFName.of('XObject'),PDFDict);
    assert.ok(xobjects&&xobjects.keys().length>0,'PDF missing real page image XObject');
  }
  const receipt=JSON.parse(readFileSync(paths.receipt,'utf8'));
  assert.deepEqual(receipt.screenshot_lineage,plan.screenshots);
  assert.equal(receipt.screenshot_lineage[0].independent_privacy_review,false);
});

test('R57 deterministic PowerPoint/real PDF byte recovery after >1 second; no original or masked PNG edits',async t=>{
  const f=await fixture(t),plan=prepareMaskedDeck(f.app,f.request);
  const sourceBefore=f.request.screenshots.map(s=>sha(readFileSync(s.masked_png_path)));
  const first=await exportMaskedDeck(f.app,plan,f.request,f.outDir,f.approve(plan));
  await new Promise(done=>setTimeout(done,1300));
  const second=await exportMaskedDeck(f.app,plan,f.request,f.outDir,f.approve(plan));
  assert.equal(second.files_created,0);
  assert.equal(second.recovered,true);
  assert.deepEqual(second.documents,first.documents);
  const paths=docs(f.outDir,plan);
  rmSync(paths.pdf);rmSync(paths.receipt);
  const recovered=await exportMaskedDeck(f.app,plan,f.request,f.outDir,f.approve(plan));
  assert.equal(recovered.files_created,2);
  assert.deepEqual(recovered.documents,first.documents);
  assert.deepEqual(f.request.screenshots.map(s=>sha(readFileSync(s.masked_png_path))),sourceBefore);
});

test('R57 altered/private output, symlink and operator lock deny without deleting human edits',async t=>{
  const f=await fixture(t),plan=prepareMaskedDeck(f.app,f.request);
  await exportMaskedDeck(f.app,plan,f.request,f.outDir,f.approve(plan));
  const paths=docs(f.outDir,plan);
  writeFileSync(paths.pptx,'Edited by operator');
  await assert.rejects(exportMaskedDeck(f.app,plan,f.request,f.outDir,f.approve(plan)),
    {code:'Conflict'});
  assert.equal(readFileSync(paths.pptx,'utf8'),'Edited by operator');
  if(process.platform!=='win32'){
    const publicDir=join(f.root,'public-output');mkdirSync(publicDir,{mode:0o755});chmodSync(publicDir,0o755);
    await assert.rejects(exportMaskedDeck(f.app,plan,f.request,publicDir,f.approve(plan)),
      {code:'PermissionDenied'});
    const symlink=join(f.root,'linked');symlinkSync(f.outDir,symlink);
    await assert.rejects(exportMaskedDeck(f.app,plan,f.request,symlink,f.approve(plan)),
      {code:'PermissionDenied'});
  }
  const lock=join(f.app.store.root,'.masked-deck-export.lock');
  writeFileSync(lock,'Another writer',{mode:0o600});
  await assert.rejects(exportMaskedDeck(f.app,plan,f.request,f.outDir,f.approve(plan)),
    {code:'Conflict'});
  assert.equal(readFileSync(lock,'utf8'),'Another writer');
});

test('R57 denies changed masks, changed Native source revision and all omitted approvals before private writes',async t=>{
  const f=await fixture(t),plan=prepareMaskedDeck(f.app,f.request);
  assert.throws(()=>verifyMaskedDeck(f.app,{...plan,screenshot_count:7},f.request),{code:'Conflict'});
  for(const mutation of [
    {acknowledge_mask_scope_only:false},
    {acknowledge_private_deck_only:false}
  ])assert.throws(()=>prepareMaskedDeck(f.app,{...f.request,...mutation}),{code:'ConsentRequired'});
  await assert.rejects(exportMaskedDeck(f.app,plan,f.request,f.outDir,{
    ...f.approve(plan),confirm_candidate_sha256:'a'.repeat(64)
  }),{code:'ConsentRequired'});
  assert.throws(()=>prepareMaskedDeck(f.app,{
    ...f.request,screenshots:f.request.screenshots.map((x,i)=>i===0?
      {...x,mask_receipt:{...x.mask_receipt,redacted_png_sha256:'b'.repeat(64)}}:x)
  }),{code:'Conflict'});
  assert.deepEqual(readdirSync(f.outDir),[]);
  await execute(f.app,'entity.update',{id:f.source.id,expected:f.source.version,
    data:{...f.source.data,purpose:'A different reviewed source revision'}
  });
  assert.throws(()=>verifyMaskedDeck(f.app,plan,f.request),{code:'StaleReference'});
});

test('R57 wrong screenshot order/reuse/target cannot impersonate a source-linked deck',async t=>{
  const f=await fixture(t);
  const reversed={...f.request,screenshots:[...f.request.screenshots].reverse()};
  // Reversing changes the plan and cannot validate the saved one.
  const actual=prepareMaskedDeck(f.app,f.request);
  assert.throws(()=>verifyMaskedDeck(f.app,actual,reversed),{code:'StaleReference'});
  const reused={...f.request,screenshots:[
    f.request.screenshots[0],f.request.screenshots[0]
  ]};
  assert.throws(()=>prepareMaskedDeck(f.app,reused),{code:'Conflict'});
  const without={...f.request,screenshots:[f.request.screenshots[0]]};
  assert.throws(()=>prepareMaskedDeck(f.app,without),{code:'ResourceExhausted'});
});

test('R57 false R55 provenance or renamed externally provided masked image aborts',async t=>{
  const f=await fixture(t);
  const input={...f.request,screenshots:f.request.screenshots.map((s,i)=>i===0?{
    ...s,masked_png_path:f.request.screenshots[1].masked_png_path
  }:s)};
  assert.throws(()=>prepareMaskedDeck(f.app,input),{code:'Conflict'});
  const changed={...f.request,screenshots:f.request.screenshots.map((s,i)=>i===0?{
    ...s,mask_receipt:{...s.mask_receipt,independent_privacy_review:true}
  }:s)};
  assert.throws(()=>prepareMaskedDeck(f.app,changed),{code:'Conflict'});
});

test('R57 text-only R42 deck still stays unaffected by optional screen renderer extension',async t=>{
  const f=await fixture(t);
  const {renderDeckFormats}=await import('../src/deck-renderers.mjs');
  const {parseDeckMarkdown}=await import('../src/deck-pdf.mjs');
  const markdown=f.app.store.readBlob(f.artifact.data.sha256).bytes;
  const source=parseDeckMarkdown(markdown);
  const original=await renderDeckFormats(source,sha(markdown));
  const next=await renderDeckFormats(source,sha(markdown),[]);
  assert.equal(sha(original.pdf),sha(next.pdf));
  assert.equal(sha(original.pptx),sha(next.pptx));
});


test('R57 operator CLI privately plans and confirms exact source; second send safely recovers',async t=>{
  const f=await fixture(t),inputFile=join(f.root,'input.json'),saved=join(f.root,'intent.json');
  writeFileSync(inputFile,JSON.stringify(f.request),{mode:0o600});
  const cwd=fileURLToPath(new URL('../',import.meta.url));
  const call=parts=>spawnSync(process.execPath,['scripts/masked-deck.mjs',...parts],{
    cwd,encoding:'utf8',timeout:20000});
  const planned=call(['plan','--state',f.app.store.root,'--input',inputFile,'--out',saved]);
  assert.equal(planned.status,0,planned.stdout+planned.stderr);
  assert.equal(JSON.parse(planned.stdout).workspace_mutated,false);
  const plan=JSON.parse(readFileSync(saved,'utf8'));
  assert.equal(plan.plan_sha256,prepareMaskedDeck(f.app,f.request).plan_sha256);
  assert.notEqual(call(['plan','--state',f.app.store.root,'--input',inputFile,'--out',saved]).status,0,
    'Private operator plan must not be overwritten');
  const exact=['export','--state',f.app.store.root,'--input',inputFile,
    '--plan',saved,'--out-dir',f.outDir,'--confirm-plan',plan.plan_sha256,
    '--confirm-candidate',plan.candidate_sha256,'--approve-export'];
  const first=call(exact);
  assert.equal(first.status,0,first.stdout+first.stderr);
  assert.equal(JSON.parse(first.stdout).files_created,3);
  const recovered=call(exact);
  assert.equal(recovered.status,0,recovered.stdout+recovered.stderr);
  assert.equal(JSON.parse(recovered.stdout).recovered,true);
  assert.equal(JSON.parse(recovered.stdout).files_created,0);
});
