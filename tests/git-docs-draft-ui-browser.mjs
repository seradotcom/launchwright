// SPDX-License-Identifier: AGPL-3.0-only
// R69 browser E2E with real Native candidate + real Git, injected GitHub
// transport: proves UI control flow but does NOT create an external GitHub PR.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '../.ci-tools/node_modules/playwright/index.mjs';
import {LaunchwrightApplication} from '../src/application.mjs';
import {createAppServer} from '../src/server.mjs';
import {createR68Fixture,ownedGit} from './git-docs-web-fixture.mjs';

const state=mkdtempSync(join(tmpdir(),'launchwright-r69-browser-'));
const output=join(process.cwd(),'evidence','git-docs-draft-browser');
mkdirSync(output,{recursive:true});
const token='r69-local-owned-browser-not-a-customer-token';
let app,fixture,service,browser,success=false;
const errors=[],screens=[];
const remote={
  base:null,head:null,pr:null,creates:0,
  async getBaseSha(){return this.base;},
  async getBranchSha(){return this.head;},
  async getOpenPR(){return this.pr?structuredClone(this.pr):null;},
  async createDraftPR(repo,payload){
    this.creates++;
    this.pr={number:69,draft:true,state:'open',
      title:payload.title,body:payload.body,
      html_url:'https://github.com/'+repo+'/pull/69',
      head:{ref:payload.head,sha:this.head,repo:{full_name:repo}},
      base:{ref:payload.base,sha:this.base,repo:{full_name:repo}}};
    return structuredClone(this.pr);
  }
};
try{
  app=new LaunchwrightApplication(state,{initialize:true});
  fixture=await createR68Fixture(app);
  remote.base=fixture.base;
  service=createAppServer(app,{port:0,token,githubDraftTransport:remote});
  const origin=await service.listen();
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:950},
    acceptDownloads:true});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/#docs-git');
  await page.locator('#token').fill(token);
  await page.getByRole('button',{name:'Open workspace'}).click();
  await page.getByRole('heading',{name:'Docs to Git'}).waitFor();
  await page.locator('[data-action="docs-git-plan"]').click();
  await page.locator('#f-repository_root').fill(fixture.repository_root);
  await page.locator('#f-github_repository').fill('owned-org/release-docs');
  await page.locator('#f-candidate_id').selectOption(fixture.candidate.id);
  await page.locator('#f-artifact_id').selectOption(fixture.artifact.id);
  await page.locator('#f-acknowledge_draft_only').check();
  await page.locator('#f-acknowledge_unverified').check();
  await page.locator('#save-editor').click();
  await page.getByRole('heading',{name:'Exact R40 plan — no branch written by preparation'}).waitFor();
  const r40Save=page.waitForEvent('download');
  await page.locator('[data-action="docs-git-save"]').click();
  const r40File=await r40Save;
  const r40=JSON.parse(readFileSync(await r40File.path(),'utf8'));
  await page.locator('[data-action="docs-git-apply"]').click();
  await page.locator('#f-confirm_plan_sha256').fill(r40.plan_sha256);
  await page.locator('#f-confirm_candidate_sha256').fill(r40.candidate_sha256);
  await page.locator('#f-confirm_base_commit_sha').fill(r40.base_commit_sha);
  await page.locator('#f-acknowledge_local_git_write').check();
  await page.locator('#save-editor').click();
  await page.getByText('LOCAL_BRANCH_READY',{exact:true}).waitFor();
  remote.head=ownedGit(fixture.repository_root,'rev-parse',r40.branch);
  assert.equal(ownedGit(fixture.repository_root,'rev-parse','HEAD'),fixture.base);
  // Simulates an independently authorized manual push only in CI provider.
  await page.locator('[data-action="docs-pr-plan"]').click();
  await page.locator('#f-title').fill('Review owned release docs — Draft');
  await page.locator('#f-editorial_note').fill('R69 browser-owned synthetic fixture');
  await page.locator('#f-acknowledge_draft_only').check();
  await page.locator('#save-editor').click();
  await page.getByRole('heading',{name:'Prepared Draft intent · NOT SENT'}).waitFor();
  const intentSave=page.waitForEvent('download');
  await page.locator('[data-action="docs-pr-save"]').click();
  const intentFile=await intentSave;
  const intent=JSON.parse(readFileSync(await intentFile.path(),'utf8'));
  assert.equal(intent.branch_plan_sha256,r40.plan_sha256);
  assert.equal(intent.local_branch_commit_sha,remote.head);
  assert.equal(remote.creates,0);
  await page.locator('[data-action="docs-pr-send"]').click();
  await page.locator('#f-confirm_repository').fill(intent.repository);
  await page.locator('#f-confirm_branch_plan_sha256').fill(intent.branch_plan_sha256);
  await page.locator('#f-confirm_local_commit_sha').fill(intent.local_branch_commit_sha);
  await page.locator('#f-acknowledge_remote_branch_pushed').check();
  await page.locator('#f-acknowledge_first_send').check();
  await page.locator('#save-editor').click();
  await page.getByRole('heading',{name:'Verified GitHub Draft receipt'}).waitFor();
  assert.equal(remote.creates,1);
  assert.ok(remote.pr.draft);
  assert.ok(remote.pr.body.includes(intent.intent_sha256));
  assert.ok((await page.locator('#main').innerText()).includes('not performed'));
  const storage=await page.evaluate(()=>JSON.stringify(localStorage));
  assert.ok(!storage.includes(fixture.repository_root));
  assert.ok(!storage.includes(intent.intent_sha256));
  for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:950});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
    assert.ok(overflow<=1,'R69 UI viewport overflow '+width+': '+overflow);
    await page.screenshot({path:join(output,'r69-draft-'+width+'.png'),fullPage:true});
    screens.push('r69-draft-'+width+'.png');
  }
  await page.reload();
  await page.getByRole('heading',{name:'Docs to Git'}).waitFor();
  await page.locator('[data-action="docs-git-load"]').click();
  await page.locator('#f-repository_root').fill(fixture.repository_root);
  await page.locator('#f-plan').fill(JSON.stringify(r40));
  await page.locator('#save-editor').click();
  await page.getByText('LOCAL_BRANCH_READY',{exact:true}).waitFor();
  await page.locator('[data-action="docs-pr-load"]').click();
  await page.locator('#f-intent').fill(JSON.stringify(intent));
  await page.locator('#save-editor').click();
  await page.getByRole('heading',{name:'Prepared Draft intent · NOT SENT'}).waitFor();
  await page.locator('[data-action="docs-pr-recover"]').click();
  await page.getByRole('heading',{name:'Verified GitHub Draft receipt'}).waitFor();
  assert.equal(remote.creates,1,'read-only recovery must never create another PR');
  assert.equal(errors.length,0,JSON.stringify(errors));
  writeFileSync(join(output,'result.json'),JSON.stringify({
    schema_version:'launchwright-r69-owned-browser-draft/1',
    r40_plan_sha256:r40.plan_sha256,r41_intent_sha256:intent.intent_sha256,
    local_branch_commit_sha:remote.head,external_push_simulated:true,
    external_github_pr_created:false,synthetic_provider_draft_created:true,
    remote_create_calls:remote.creates,full_read_only_recovery:true,
    github_draft_not_published:true,real_customer_acceptance:false,
    platform_publish_authority:false,
    widths:[1440,768,390,320],screens,errors
  },null,2)+'\n');
  success=true;
}finally{
  await browser?.close();await service?.close();app?.close();
  fixture?.cleanup();
  rmSync(state,{recursive:true,force:true,maxRetries:5,retryDelay:50});
  if(!success)process.exitCode=1;
}
