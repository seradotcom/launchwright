// SPDX-License-Identifier: AGPL-3.0-only
// R70 official Chromium: owned Native/SQLite fixture with two distinct
// releases. Never executes product source, inherits claims or publishes.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '../.ci-tools/node_modules/playwright/index.mjs';
import {LaunchwrightApplication} from '../src/application.mjs';
import {createAppServer} from '../src/server.mjs';
import {makeCarryForwardFixture} from './carry-forward-fixture.mjs';

const root=mkdtempSync(join(tmpdir(),'launchwright-r70-browser-'));
const out=join(process.cwd(),'evidence','r70');
mkdirSync(out,{recursive:true});
const token='owned-r70-browser-only-local-credential';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
let app,fixture,service,browser,done=false;
const errors=[],failedRequests=[],screens=[];
try{
  app=new LaunchwrightApplication(root,{initialize:true});
  fixture=await makeCarryForwardFixture(app);
  const oldSnapshot=structuredClone(app.get(fixture.old.deliverable.id));
  const oldArtifacts=app.list('artifact',fixture.old.release.id).length;
  service=createAppServer(app,{port:0,token});
  const base=await service.listen();
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:950},
    acceptDownloads:true});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('requestfailed',req=>failedRequests.push(req.url()));
  await page.goto(base+'/#carry-forward');
  await page.locator('#token').fill(token);
  await page.getByRole('button',{name:'Open workspace'}).click();
  await page.getByRole('heading',{name:'Carry-forward drafts'}).waitFor();
  await page.selectOption('#release-select',fixture.release.id);
  await page.locator('#carry-source-candidate').selectOption(fixture.candidate.id);
  await page.locator('#carry-source-artifact').selectOption(fixture.artifact.id);
  await page.locator('#carry-target').selectOption(fixture.target.id);
  await page.locator('#carry-name').fill('Next release notes');
  await page.locator('#carry-name').press('Tab');
  await page.locator('#carry-rights').check();
  await page.locator('#carry-recheck').check();
  await page.locator('[data-action="carry-plan"]').click();
  await page.getByRole('heading',{
    name:'Prepared editorial handoff — no draft written yet'
  }).waitFor();
  const codes=await page.locator('.carry-forward-facts .carry-forward-hash').allTextContents();
  const [planSha,sourceSha,artifactSha,sourceBuild,destBuild]=codes;
  assert.match(planSha,/^[a-f0-9]{64}$/u);
  assert.equal(sourceSha,fixture.candidate.data.candidate_sha256);
  assert.equal(artifactSha,fixture.artifact.data.sha256);
  assert.equal(sourceBuild,fixture.old.release.data.build);
  assert.equal(destBuild,fixture.release.data.build);
  assert.equal(app.list('deliverable',fixture.release.id).length,0);
  assert.equal(app.list('relation',fixture.release.id).length,0);

  const transfer=page.waitForEvent('download');
  await page.locator('[data-action="carry-save"]').click();
  const file=await transfer;
  const plan=JSON.parse(readFileSync(await file.path(),'utf8'));
  assert.equal(plan.plan_sha256,planSha);
  assert.ok(!JSON.stringify(plan).includes(fixture.old.deliverable.data.content));
  await page.locator('[data-action="carry-inspect"]').click();
  await page.getByText('NOT_APPLIED',{exact:true}).waitFor();

  await page.locator('[data-action="carry-apply"]').click();
  await page.locator('#f-confirm_plan_sha256').fill(planSha);
  await page.locator('#f-confirm_source_candidate_sha256').fill(sourceSha);
  await page.locator('#f-confirm_destination_build').fill(destBuild);
  await page.locator('#f-acknowledge_create_draft').check();
  await page.locator('#save-editor').click();
  await page.getByText('DRAFT_READY',{exact:true}).waitFor();

  const results=app.list('deliverable',fixture.release.id);
  assert.equal(results.length,1);
  const doc=results[0];
  assert.deepEqual(doc.data.claim_ids,[]);
  assert.deepEqual(doc.data.source_ids,[]);
  assert.deepEqual(doc.data.copy_block_ids,[]);
  assert.ok(doc.data.content.includes('REVERIFY FOR THIS BUILD'));
  assert.ok(doc.data.content.endsWith(fixture.old.deliverable.data.content));
  assert.deepEqual(app.get(fixture.old.deliverable.id),oldSnapshot);
  assert.equal(app.list('artifact',fixture.old.release.id).length,oldArtifacts);
  assert.equal(app.list('artifact',fixture.release.id).length,0);
  const relation=app.list('relation',fixture.release.id);
  assert.equal(relation.length,1);
  assert.equal(relation[0].data.provenance,'declared');
  assert.equal(relation[0].data.completeness,'unknown');
  assert.equal(relation[0].data.from_id,fixture.old.deliverable.id);
  assert.equal(relation[0].data.to_id,doc.id);
  assert.equal(app.list('verification',fixture.release.id).length,0);
  assert.equal(app.list('review',fixture.release.id).length,0);
  const browserStorage=await page.evaluate(()=>JSON.stringify(localStorage));
  assert.ok(!browserStorage.includes(planSha));
  assert.ok(!browserStorage.includes(fixture.old.deliverable.data.content));
  for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:950});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
    assert.ok(overflow<=1,
      'Carry-forward UI overflows on '+width+'px: '+overflow);
    const filename='carry-forward-'+width+'.png';
    await page.screenshot({path:join(out,filename),fullPage:true});
    screens.push(filename);
  }
  await page.reload();
  await page.getByRole('heading',{name:'Carry-forward drafts'}).waitFor();
  assert.equal(await page.locator('.carry-forward-facts').count(),0,
    'Private source-bound plans are never retained in localStorage');
  await page.locator('[data-action="carry-restore"]').click();
  await page.locator('#f-plan').fill(JSON.stringify(plan));
  await page.locator('#save-editor').click();
  await page.getByText('DRAFT_READY',{exact:true}).waitFor();
  assert.equal(app.list('deliverable',fixture.release.id).length,1);
  assert.equal(app.list('relation',fixture.release.id).length,1);
  assert.deepEqual(errors,[]);
  assert.deepEqual(failedRequests,[]);
  writeFileSync(join(out,'result.json'),JSON.stringify({
    schema_version:'launchwright-r70-owned-carry-forward-browser/1',
    plan_sha256:planSha,source_candidate_sha256:sourceSha,
    historical_artifact_sha256:artifactSha,
    new_draft_sha256:sha(Buffer.from(doc.data.content,'utf8')),
    new_deliverable_id:doc.id,provenance_relation_id:relation[0].id,
    real_semwright_native_sdk:true,source_application_executed:false,
    original_artifacts_preserved:true,
    claims_inherited:false,evidence_inherited:false,
    reviews_inherited:false,customer_acceptance:false,
    publication_authority:false,platform_authority:false,
    widths:[1440,768,390,320],screens,errors,failedRequests
  },null,2)+'\n');
  done=true;
}finally{
  await browser?.close();await service?.close();app?.close();
  rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});
  if(!done)process.exitCode=1;
}
