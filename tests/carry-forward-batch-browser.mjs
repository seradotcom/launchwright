// SPDX-License-Identifier: AGPL-3.0-only
// R71: owned Native/SQLite real Chromium E2E; no customer application runs.
// Exactly two historical source documents become NEW review drafts, not
// re-verifications, artifacts, automatic publication or old approvals.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '../.ci-tools/node_modules/playwright/index.mjs';
import {LaunchwrightApplication} from '../src/application.mjs';
import {createAppServer} from '../src/server.mjs';
import {makeBatchFixture} from './carry-forward-batch-fixture.mjs';

const state=mkdtempSync(join(tmpdir(),'launchwright-r71-browser-'));
const output=join(process.cwd(),'evidence','carry-forward-batch');
mkdirSync(output,{recursive:true});
const token='r71-owned-only-browser-session-token';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
let app,fixture,service,browser,done=false;
const errors=[],requests=[],screens=[];
try{
  app=new LaunchwrightApplication(state,{initialize:true});
  fixture=await makeBatchFixture(app);
  const oldDocs=structuredClone(app.list('deliverable',fixture.old.release.id));
  const oldArtifacts=app.list('artifact',fixture.old.release.id).length;
  service=createAppServer(app,{port:0,token});
  const origin=await service.listen();
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:960},
    acceptDownloads:true});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('requestfailed',req=>requests.push(req.url()));
  await page.goto(origin+'/#carry-forward');
  await page.locator('#token').fill(token);
  await page.getByRole('button',{name:'Open workspace'}).click();
  await page.getByRole('heading',{name:'Carry-forward drafts'}).waitFor();
  await page.selectOption('#release-select',fixture.release.id);
  await page.selectOption('#batch-candidate',fixture.candidate.id);
  await page.locator('[data-batch-toggle="'+fixture.artifact.id+'"]').check();
  await page.locator('[data-batch-toggle="'+fixture.secondArt.id+'"]').check();
  const chosen=await page.locator('.carry-batch-row input[type="checkbox"]:checked').count();
  assert.equal(chosen,2);
  assert.equal(await page.locator('[data-batch-toggle="'+fixture.thirdArt.id+'"]').count(),1,
    'Unselected historical docs are visible but not automatically included');
  const targetOne=page.locator('[data-batch-target="'+fixture.artifact.id+'"]');
  const targetTwo=page.locator('[data-batch-target="'+fixture.secondArt.id+'"]');
  assert.equal(await targetOne.inputValue(),fixture.target.id);
  assert.equal(await targetTwo.inputValue(),fixture.target.id);
  await page.locator('#batch-rights').check();
  await page.locator('#batch-review').check();
  await page.locator('[data-action="batch-plan"]').click();
  await page.getByRole('heading',{
    name:'Prepared multi-document plan — no workspace writes yet'
  }).waitFor();
  const codes=await page.locator('.carry-forward-facts .carry-batch-hash').allTextContents();
  const [planSha,candidateSha,newBuild,count]=codes;
  assert.match(planSha,/^[a-f0-9]{64}$/u);
  assert.equal(candidateSha,fixture.candidate.data.candidate_sha256);
  assert.equal(newBuild,fixture.release.data.build);
  assert.equal(count,'2');
  assert.equal(app.list('deliverable',fixture.release.id).length,0);
  assert.equal(app.list('relation',fixture.release.id).length,0);

  const download=page.waitForEvent('download');
  await page.locator('[data-action="batch-save"]').click();
  const downloaded=await download;
  const plan=JSON.parse(readFileSync(await downloaded.path(),'utf8'));
  assert.equal(plan.plan_sha256,planSha);
  assert.equal(plan.document_count,2);
  assert.equal(plan.plans.length,2);
  assert.ok(!JSON.stringify(plan).includes(fixture.second.data.content));
  assert.ok(!JSON.stringify(plan).includes(fixture.old.deliverable.data.content));
  await page.locator('[data-action="batch-inspect"]').click();
  await page.getByText('NOT_APPLIED',{exact:false}).first().waitFor();

  await page.locator('[data-action="batch-apply"]').click();
  await page.locator('#f-confirm_plan_sha256').fill(planSha);
  await page.locator('#f-confirm_source_candidate_sha256').fill(candidateSha);
  await page.locator('#f-confirm_destination_build').fill(newBuild);
  await page.locator('#f-acknowledge_create_all_drafts').check();
  await page.locator('#save-editor').click();
  await page.getByText('BATCH_READY',{exact:false}).first().waitFor();

  const rows=app.list('deliverable',fixture.release.id);
  const relations=app.list('relation',fixture.release.id);
  assert.equal(rows.length,2);
  assert.equal(relations.length,2);
  assert.deepEqual(app.list('deliverable',fixture.old.release.id),oldDocs);
  assert.equal(app.list('artifact',fixture.old.release.id).length,oldArtifacts);
  assert.equal(app.list('artifact',fixture.release.id).length,0);
  assert.equal(app.list('candidate',fixture.release.id).length,0);
  assert.equal(app.list('review',fixture.release.id).length,0);
  assert.equal(app.list('verification',fixture.release.id).length,0);
  assert.equal(app.list('evidence',fixture.release.id).length,0);
  for(const row of rows){
    assert.match(row.data.content,/REVERIFY FOR THIS BUILD BEFORE USE/);
    assert.deepEqual(row.data.claim_ids,[]);
    assert.deepEqual(row.data.copy_block_ids,[]);
    assert.deepEqual(row.data.source_ids,[]);
  }
  for(const relation of relations){
    assert.equal(relation.data.completeness,'unknown');
    assert.equal(relation.data.provenance,'declared');
    assert.equal(relation.data.graph_observation_id,null);
  }
  const persisted=await page.evaluate(()=>JSON.stringify(localStorage));
  assert.ok(!persisted.includes(planSha));
  for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:960});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
    assert.ok(overflow<=1,
      'R71 operator batch overflows at '+width+'px: '+overflow);
    const file='batch-'+width+'.png';
    await page.screenshot({path:join(output,file),fullPage:true});
    screens.push(file);
  }

  await page.reload();
  await page.getByRole('heading',{name:'Carry-forward drafts'}).waitFor();
  assert.equal(await page.locator('.carry-batch-plan').count(),0);
  await page.locator('[data-action="batch-load"]').click();
  await page.locator('#f-plan').fill(JSON.stringify(plan));
  await page.locator('#save-editor').click();
  await page.getByText('BATCH_READY',{exact:false}).first().waitFor();
  assert.equal(app.list('deliverable',fixture.release.id).length,2);
  assert.equal(app.list('relation',fixture.release.id).length,2);
  assert.deepEqual(errors,[]);
  assert.deepEqual(requests,[]);
  writeFileSync(join(output,'result.json'),JSON.stringify({
    schema_version:'launchwright-r71-owned-batch-browser/1',
    exact_batch_plan_sha256:planSha,source_candidate_sha256:candidateSha,
    document_count:rows.length,provenance_relation_count:relations.length,
    new_content_sha256:rows.map(row=>sha(Buffer.from(row.data.content,'utf8'))),
    original_source_revisions_preserved:true,
    native_sdk_state:true,source_customer_application_executed:false,
    inherited_claims:false,inherited_artifacts:false,
    inherited_reviews:false,technical_state:'UNKNOWN',
    platform_authority:false,customer_acceptance:false,published:false,
    widths:[1440,768,390,320],screens,errors,failed_requests:requests
  },null,2)+'\n');
  done=true;
}finally{
  await browser?.close();await service?.close();app?.close();
  rmSync(state,{recursive:true,force:true,maxRetries:5,retryDelay:50});
  if(!done)process.exitCode=1;
}
