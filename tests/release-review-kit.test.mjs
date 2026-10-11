// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import { mkdtempSync,mkdirSync,chmodSync,readFileSync,writeFileSync,
  rmSync,symlinkSync,readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { execute } from '../src/application.mjs';
import { makeOwnedReviewKitFixture } from './release-review-kit-fixture.mjs';
import { planStaticDocs,exportStaticDocs } from '../src/static-docs.mjs';
import { planReleaseReviewKit,verifyReleaseReviewKit,
  exportReleaseReviewKit } from '../src/release-review-kit.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
async function fixture(t){
  const f=await makeOwnedReviewKitFixture();
  t.after(()=>{try{f.close();}catch{}});
  return f;
}
async function readZip(f,receipt){
  const archive=readFileSync(join(f.kitFolder,receipt.filename));
  const zip=await JSZip.loadAsync(archive,{checkCRC32:true});
  const names=Object.keys(zip.files).sort();
  const manifest=JSON.parse(await zip.file('manifest.json').async('string'));
  return{zip,archive,names,manifest};
}
test('R64 exact no-mutation plan joins a single approved candidate/build across two independent Native exporters',async t=>{
  const f=await fixture(t),before=readdirSync(f.kitFolder);
  const p=await planReleaseReviewKit(f.app,f.kitInput);
  assert.deepEqual(await planReleaseReviewKit(f.app,f.kitInput),p);
  assert.deepEqual(await verifyReleaseReviewKit(f.app,p,f.kitInput),p);
  assert.equal(p.release_id,f.release.id);
  assert.equal(p.release_build,f.release.data.build);
  assert.equal(p.candidate_id,f.candidate.id);
  assert.equal(p.candidate_sha256,f.candidate.data.candidate_sha256);
  assert.deepEqual(p.outputs,['offline-docs','editable-pptx','real-pdf']);
  assert.equal(p.technical_state,'UNKNOWN');
  assert.equal(p.published,false);
  assert.equal(p.platform_authority,false);
  assert.equal(p.customer_acceptance,false);
  assert.ok(!JSON.stringify(p).includes(f.root));
  assert.deepEqual(readdirSync(f.kitFolder),before);
});
test('R64 actual ZIP unpacks to navigable offline docs, editable PPTX and readable PDF with a complete SHA manifest',async t=>{
  const f=await fixture(t),{plan,receipt}=await f.exportKit();
  const {zip,archive,names,manifest}=await readZip(f,receipt);
  assert.equal(sha(archive),receipt.zip_sha256);
  assert.equal(receipt.files_created,2);
  assert.equal(receipt.files_count,9);
  assert.deepEqual(names,[
    'deck/release-deck.pdf','deck/release-deck.pptx',
    'docs/api.html','docs/index.html','docs/manifest.json',
    'docs/review.html','docs/start.html','index.html','manifest.json'
  ]);
  assert.equal(manifest.release_id,f.release.id);
  assert.equal(manifest.candidate_sha256,f.candidate.data.candidate_sha256);
  assert.equal(manifest.published,false);
  assert.equal(manifest.technical_state,'UNKNOWN');
  for(const item of manifest.files){
    const buffer=await zip.file(item.name).async('nodebuffer');
    assert.equal(sha(buffer),item.sha256);
    assert.equal(buffer.length,item.bytes);
  }
  const index=await zip.file('index.html').async('string');
  assert.ok(index.includes('docs/index.html'));
  assert.ok(index.includes('deck/release-deck.pptx'));
  assert.ok(index.includes('deck/release-deck.pdf'));
  assert.ok(index.includes("script-src &#39;none&#39;"));
  assert.ok(!/<script\b|<iframe\b|https?:\/\//iu.test(index));
  assert.ok(!index.includes(f.root));
  const docs=await zip.file('docs/start.html').async('string');
  assert.ok(docs.includes('./api.html'));
  const pptx=await zip.file('deck/release-deck.pptx').async('nodebuffer');
  const inner=await JSZip.loadAsync(pptx,{checkCRC32:true});
  assert.ok(inner.file('ppt/slides/slide2.xml'));
  const pdf=await zip.file('deck/release-deck.pdf').async('nodebuffer');
  assert.equal((await PDFDocument.load(pdf)).getPageCount(),4);
  assert.equal(f.app.list('channel_delivery').length,0);
});
test('R64 exact replay is byte-stable across elapsed seconds; interrupted receipt resumes without overwriting',async t=>{
  const f=await fixture(t),p=await planReleaseReviewKit(f.app,f.kitInput);
  const first=await exportReleaseReviewKit(f.app,p,f.kitInput,f.kitFolder,f.approve(p));
  await new Promise(done=>setTimeout(done,1150));
  const second=await exportReleaseReviewKit(f.app,p,f.kitInput,f.kitFolder,f.approve(p));
  assert.equal(second.zip_sha256,first.zip_sha256);
  assert.equal(second.files_created,0);
  assert.equal(second.recovered,true);
  const receipt=join(f.kitFolder,'launchwright-review-kit-'+p.plan_sha256.slice(0,12)+'.receipt.json');
  rmSync(receipt);
  const resumed=await exportReleaseReviewKit(f.app,p,f.kitInput,f.kitFolder,f.approve(p));
  assert.equal(resumed.files_created,1);
  assert.equal(resumed.zip_sha256,first.zip_sha256);
});
test('R64 refuses unrelated docs candidate, forged deck bytes/receipt or changed source without kit writes',async t=>{
  const f=await fixture(t);
  const oldDocs=await planStaticDocs(f.app,f.input);
  await exportStaticDocs(f.app,oldDocs,f.output,{
    confirm_plan_sha256:oldDocs.plan_sha256,
    confirm_candidate_sha256:oldDocs.candidate_sha256,
    acknowledge_private_export:true
  });
  await assert.rejects(planReleaseReviewKit(f.app,{
    ...f.kitInput,docs:{...f.kitInput.docs,plan:oldDocs}
  }),{code:'Conflict'});
  const kit=await planReleaseReviewKit(f.app,f.kitInput);
  const pptxFile='launchwright-deck-'+f.deckPlan.plan_sha256.slice(0,12)+'.pptx';
  const original=readFileSync(join(f.deckFolder,pptxFile));
  writeFileSync(join(f.deckFolder,pptxFile),Buffer.concat([original,Buffer.from('replaced')]));
  // A forged updated receipt alone cannot bypass canonical re-render check.
  const receiptFile='launchwright-deck-'+f.deckPlan.plan_sha256.slice(0,12)+'.receipt.json';
  const receipt=JSON.parse(readFileSync(join(f.deckFolder,receiptFile)));
  const forged=readFileSync(join(f.deckFolder,pptxFile));
  receipt.files[pptxFile]={sha256:sha(forged),bytes:forged.length};
  writeFileSync(join(f.deckFolder,receiptFile),JSON.stringify(receipt,null,2)+'\n');
  await assert.rejects(planReleaseReviewKit(f.app,f.kitInput),{code:'Conflict'});
  await assert.rejects(exportReleaseReviewKit(f.app,kit,f.kitInput,f.kitFolder,f.approve(kit)),{code:'Conflict'});
  assert.deepEqual(readdirSync(f.kitFolder),[]);
});
test('R64 corrupted saved plan, wrong confirmations, unsafe output and existing edited archive fail closed',async t=>{
  const f=await fixture(t),p=await planReleaseReviewKit(f.app,f.kitInput);
  await assert.rejects(verifyReleaseReviewKit(f.app,{...p,release_build:'foreign'},f.kitInput),{code:'Conflict'});
  await assert.rejects(exportReleaseReviewKit(f.app,p,f.kitInput,f.kitFolder,{
    ...f.approve(p),confirm_candidate_sha256:'e'.repeat(64)
  }),{code:'ConsentRequired'});
  await assert.rejects(exportReleaseReviewKit(f.app,p,f.kitInput,f.kitFolder,{
    ...f.approve(p),acknowledge_export:false
  }),{code:'ConsentRequired'});
  if(process.platform!=='win32'){
    const publicDir=join(f.root,'world-readable');mkdirSync(publicDir,{mode:0o755});
    chmodSync(publicDir,0o755);
    await assert.rejects(exportReleaseReviewKit(f.app,p,f.kitInput,publicDir,f.approve(p)),{code:'PermissionDenied'});
    const symlink=join(f.root,'output-symlink');symlinkSync(f.kitFolder,symlink);
    await assert.rejects(exportReleaseReviewKit(f.app,p,f.kitInput,symlink,f.approve(p)),{code:'PermissionDenied'});
  }
  const done=await exportReleaseReviewKit(f.app,p,f.kitInput,f.kitFolder,f.approve(p));
  const path=join(f.kitFolder,done.filename);
  writeFileSync(path,'editor-modified');
  await assert.rejects(exportReleaseReviewKit(f.app,p,f.kitInput,f.kitFolder,f.approve(p)),{code:'Conflict'});
  assert.equal(readFileSync(path,'utf8'),'editor-modified');
});
test('R64 unknown demo variant and operator rights denial are rejected before reading foreign content',async t=>{
  const f=await fixture(t);
  await assert.rejects(planReleaseReviewKit(f.app,{
    ...f.kitInput,acknowledge_rights:false
  }),{code:'ConsentRequired'});
  await assert.rejects(planReleaseReviewKit(f.app,{
    ...f.kitInput,acknowledge_private_only:false
  }),{code:'ConsentRequired'});
  await assert.rejects(planReleaseReviewKit(f.app,{
    ...f.kitInput,demo:{plan:{schema_version:'fake'},
      directory:f.output}
  }),{code:'InvalidArgument'});
  assert.deepEqual(readdirSync(f.kitFolder),[]);
});
test('R64 an edited Native source invalidates exact cross-output candidate before private packaging',async t=>{
  const f=await fixture(t),plan=await planReleaseReviewKit(f.app,f.kitInput);
  const source=f.app.get(f.source.id,'source');
  await execute(f.app,'entity.update',{id:source.id,expected:source.version,
    data:{...source.data,purpose:'Changed source approval meaning'}});
  await assert.rejects(planReleaseReviewKit(f.app,f.kitInput));
  await assert.rejects(exportReleaseReviewKit(f.app,plan,f.kitInput,f.kitFolder,f.approve(plan)));
  assert.deepEqual(readdirSync(f.kitFolder),[]);
});


test('R64 owner two-phase CLI creates immutable private plan and exactly replays exports without duplicate files',async t=>{
  const f=await fixture(t);
  const inputFile=join(f.root,'private-kit-selection.json'),
    planFile=join(f.root,'private-kit-intent.json');
  writeFileSync(inputFile,JSON.stringify(f.kitInput),{mode:0o600});
  const cwd=fileURLToPath(new URL('../',import.meta.url));
  const run=argv=>spawnSync(process.execPath,['scripts/release-review-kit.mjs',...argv],
    {cwd,encoding:'utf8',timeout:35000});
  const planCall=['plan','--state',f.root,'--input',inputFile,'--out',planFile];
  const planned=run(planCall);
  assert.equal(planned.status,0,planned.stdout+planned.stderr);
  const p=JSON.parse(readFileSync(planFile,'utf8'));
  assert.equal(JSON.parse(planned.stdout).workspace_mutated,false);
  assert.equal(p.candidate_sha256,f.candidate.data.candidate_sha256);
  assert.notEqual(run(planCall).status,0,'Private plan cannot be overwritten');
  const command=['export','--state',f.root,'--input',inputFile,
    '--plan',planFile,'--out-dir',f.kitFolder,
    '--confirm-plan',p.plan_sha256,
    '--confirm-candidate',p.candidate_sha256,'--acknowledge-private-export'];
  const first=run(command);
  assert.equal(first.status,0,first.stdout+first.stderr);
  assert.equal(JSON.parse(first.stdout).files_created,2);
  const repeated=run(command);
  assert.equal(repeated.status,0,repeated.stdout+repeated.stderr);
  assert.equal(JSON.parse(repeated.stdout).recovered,true);
  assert.equal(JSON.parse(repeated.stdout).files_created,0);
});
