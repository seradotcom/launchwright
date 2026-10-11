// SPDX-License-Identifier: AGPL-3.0-only
// R68 owned real Chromium UI through a real locally-initialized Git repository.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '../.ci-tools/node_modules/playwright/index.mjs';
import {LaunchwrightApplication} from '../src/application.mjs';
import {createAppServer} from '../src/server.mjs';
import {createR68Fixture,ownedGit} from './git-docs-web-fixture.mjs';

const state=mkdtempSync(join(tmpdir(),'launchwright-r68-browser-'));
const output=join(process.cwd(),'evidence','git-docs-web');
mkdirSync(output,{recursive:true});
const token='r68-owned-browser-not-a-customer-credential';
const hash=x=>createHash('sha256').update(x).digest('hex');
let app,fixture,service,browser,success=false;
const pageErrors=[],requestFailures=[],screens=[];
try{
  app=new LaunchwrightApplication(state,{initialize:true});
  fixture=await createR68Fixture(app);
  service=createAppServer(app,{port:0,token});
  const origin=await service.listen();
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:950},acceptDownloads:true});
  page.on('pageerror',error=>pageErrors.push(error.message));
  page.on('requestfailed',request=>requestFailures.push(request.url()));
  const originalIndex=hash(readFileSync(join(fixture.repository_root,'.git','index')));
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
  const codes=await page.locator('.docs-git-facts .docs-git-hash').allTextContents();
  const [planSha,candidateSha,baseSha,markdownSha]=codes;
  assert.match(planSha,/^[a-f0-9]{64}$/);
  assert.equal(candidateSha,fixture.candidate.data.candidate_sha256);
  assert.equal(baseSha,fixture.base);
  assert.equal(markdownSha,fixture.artifact.data.sha256);
  assert.equal(ownedGit(fixture.repository_root,'branch','--list'),'* main');
  const downloadEvent=page.waitForEvent('download');
  await page.locator('[data-action="docs-git-save"]').click();
  const downloaded=await downloadEvent;
  const saved=JSON.parse(readFileSync(await downloaded.path(),'utf8'));
  assert.equal(saved.plan_sha256,planSha);
  await page.locator('[data-action="docs-git-inspect"]').click();
  await page.getByText('NOT_APPLIED',{exact:true}).waitFor();
  await page.locator('[data-action="docs-git-apply"]').click();
  await page.locator('#f-confirm_plan_sha256').fill(planSha);
  await page.locator('#f-confirm_candidate_sha256').fill(candidateSha);
  await page.locator('#f-confirm_base_commit_sha').fill(baseSha);
  await page.locator('#f-acknowledge_local_git_write').check();
  await page.locator('#save-editor').click();
  await page.getByText('LOCAL_BRANCH_READY',{exact:true}).waitFor();
  const commit=ownedGit(fixture.repository_root,'rev-parse',saved.branch);
  assert.match(commit,/^[a-f0-9]{40}$/);
  assert.equal(ownedGit(fixture.repository_root,'rev-parse','HEAD'),baseSha);
  assert.equal(hash(readFileSync(join(fixture.repository_root,'.git','index'))),originalIndex);
  assert.equal(ownedGit(fixture.repository_root,'diff','--name-only',baseSha,commit),
    'docs/RELEASE_NOTES.md');
  const stored=await page.evaluate(()=>JSON.stringify(localStorage));
  assert.ok(!stored.includes(fixture.repository_root));
  assert.ok(!stored.includes(planSha));
  for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:940});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
    assert.ok(overflow<=1,'R68 UI overflows at '+width+'px: '+overflow);
    await page.screenshot({path:join(output,'docs-git-'+width+'.png'),fullPage:true});
    screens.push('docs-git-'+width+'.png');
  }
  await page.reload();
  await page.getByRole('heading',{name:'Docs to Git'}).waitFor();
  assert.equal(await page.locator('.docs-git-facts').count(),0);
  await page.locator('[data-action="docs-git-load"]').click();
  await page.locator('#f-repository_root').fill(fixture.repository_root);
  await page.locator('#f-plan').fill(JSON.stringify(saved));
  await page.locator('#save-editor').click();
  await page.getByText('LOCAL_BRANCH_READY',{exact:true}).waitFor();
  assert.equal(pageErrors.length,0,JSON.stringify(pageErrors));
  assert.equal(requestFailures.length,0,JSON.stringify(requestFailures));
  const evidence={
    schema_version:'launchwright-r68-owned-git-browser/1',
    candidate_sha256:candidateSha,artifact_sha256:markdownSha,
    r40_plan_sha256:planSha,base_git_sha:baseSha,local_branch_commit_sha:commit,
    checkout_preserved:true,main_index_preserved:true,
    native_sdk_custody:true,customer_code_executed:false,
    customer_acceptance:false,github_pr_created:false,
    external_branch_push:false,external_publication:false,
    platform_authority:false,
    viewport_widths:[1440,768,390,320],
    screenshots:screens,page_errors:pageErrors,request_failures:requestFailures
  };
  writeFileSync(join(output,'result.json'),JSON.stringify(evidence,null,2)+'\n');
  success=true;
}finally{
  await browser?.close();
  await service?.close();
  app?.close();
  fixture?.cleanup();
  rmSync(state,{recursive:true,force:true,maxRetries:5,retryDelay:50});
  if(!success)process.exitCode=1;
}
