// SPDX-License-Identifier: AGPL-3.0-only
// Real application UI E2E, NOT product capture or canonical Driver Host acceptance.
import { chromium } from '../.ci-tools/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { observeGitChanges } from '../src/git-change-source.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LaunchwrightApplication } from '../src/application.mjs';
import { createAppServer } from '../src/server.mjs';

const root=mkdtempSync(join(tmpdir(),'launchwright-browser-')),out='evidence/browser';
mkdirSync(out,{recursive:true});
const app=new LaunchwrightApplication(root,{initialize:true});
const service=createAppServer(app,{port:0,token:'synthetic-browser-token'});
const url=await service.listen();
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[],network=[],consoleMessages=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>consoleMessages.push({type:m.type(),text:m.text()}));
page.on('requestfailed',r=>network.push({kind:'failed',method:r.method(),url:r.url(),error:r.failure()?.errorText??null}));
page.on('response',r=>{if(r.url().includes('/api/'))network.push({kind:'response',method:r.request().method(),url:r.url(),status:r.status()});});
let ok=false,onboardingAccepted=false;
const dialog=page.locator('#editor');
async function fill(label,value){await dialog.getByLabel(label,{exact:true}).fill(value);}
async function save(text='Save'){await dialog.getByRole('button',{name:text,exact:true}).click();await dialog.waitFor({state:'hidden'});}
try{
 await page.goto(url);
 await page.getByLabel('Local session token').fill(service.token);
 await page.getByRole('button',{name:'Open workspace',exact:true}).click();
 await page.getByRole('button',{name:'Create product',exact:true}).click();
 await fill('Product name','DeltaDesk');await fill('Description','Owned UI test fixture');await save();
 await page.getByRole('button',{name:'Create release',exact:true}).first().click();
 await fill('Release name','1.0 launch');await fill('Build identity label','browser-build-A');await save();
 await page.getByRole('link',{name:'Targets & sources',exact:false}).click();
 await page.getByRole('button',{name:'Add target',exact:true}).first().click();await fill('Target name','English basic viewer');await save();
 await page.getByRole('link',{name:'Deliverables',exact:false}).click();
 await page.getByRole('button',{name:'Add deliverable',exact:true}).click();
 await fill('Document name','Release notes');await fill('Content','Synthetic release notes. No claim of product execution.');await save();
 await page.getByRole('button',{name:'Render text',exact:true}).click();
 await page.getByRole('button',{name:'Preview',exact:true}).click();
 await page.locator('.preview').waitFor();
 assert.ok((await page.locator('.preview').textContent()).includes('Synthetic release notes'));
 await page.getByRole('link',{name:'Review room',exact:false}).click();
 await page.getByRole('button',{name:'Freeze candidate',exact:true}).first().click();await save('Freeze exact candidate');
 await page.getByRole('button',{name:'Inspect gates',exact:true}).click();
 await page.getByRole('button',{name:'Record editorial decision',exact:true}).click();
 await dialog.getByLabel('Decision',{exact:true}).selectOption('approve-editorial');
 await fill('Reason or requested change','UI test decision on exact candidate');await save('Record decision');
 await page.getByRole('button',{name:'Record private draft',exact:true}).click();
 await dialog.getByRole('checkbox').check();await save('Record private draft');
 await page.getByRole('link',{name:'Delivery',exact:false}).click();await page.getByText('NOT SENT',{exact:true}).waitFor();
 await page.getByRole('link',{name:'Overview',exact:false}).click();
 await page.screenshot({path:out+'/overview-light.png',fullPage:true});
 await page.getByRole('button',{name:'◐',exact:true}).click();await page.screenshot({path:out+'/overview-dark.png',fullPage:true});
 for(const width of[320,390,768]){
   await page.setViewportSize({width,height:900});
   await page.screenshot({path:`${out}/overview-${width}.png`,fullPage:true});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Horizontal viewport overflow at ${width}`);
 }
 await page.reload();await page.locator('#view-content h1').waitFor();
 assert.equal(await page.locator('#view-content h1').textContent(),'1.0 launch');

 // R37: operator-owned existing-project onboarding in REAL Chromium, not a
 // static module check and not external customer/project capture. Git commands
 // here create only an owned disposable fixture; imported Git metadata cannot
 // execute source scripts or confer Semwright Project Graph authority.
 const gitRoot=join(root,'owned-git-import-fixture');
 mkdirSync(gitRoot,{recursive:true});
 const git=(...argv)=>execFileSync('git',['-C',gitRoot,...argv],
   {encoding:'utf8',env:{...process.env,GIT_TERMINAL_PROMPT:'0'}}).trim();
 execFileSync('git',['init',gitRoot],{stdio:'ignore'});
 git('config','user.name','Owned Browser Fixture');
 git('config','user.email','ui-r37@example.invalid');
 writeFileSync(join(gitRoot,'README.md'),'Owned synthetic initial content');
 git('add','.');git('commit','-m','Owned initial snapshot');
 const base=git('rev-parse','HEAD');
 writeFileSync(join(gitRoot,'README.md'),'Owned synthetic changed content');
 writeFileSync(join(gitRoot,'private-source-filename.txt'),'Not a product feature');
 git('add','.');git('commit','-m','Owned second snapshot');
 const head=git('rev-parse','HEAD');
 const observed=observeGitChanges({repository_root:gitRoot,source_alias:'owned_browser_git',
   base_sha:base,head_sha:head});
 await page.getByRole('link',{name:'Import Git project',exact:false}).click();
 await page.locator('#git-observation-file').setInputFiles({
   name:'private-owned-observation.json',mimeType:'application/json',
   buffer:Buffer.from(JSON.stringify(observed))
 });
 await page.getByText('Source alias',{exact:true}).waitFor();
 assert.ok(!(await page.locator('#view-content').innerText()).includes('private-source-filename.txt'));
 await page.getByRole('button',{name:'Configure local plan'}).click();
 await fill('Product name','Imported Git project');
 await fill('Release name','Imported head commit review');
 await dialog.getByLabel('Operator-declared source rights',{exact:true}).selectOption('owned');
 await save('Prepare private plan');
 const planSha=(await page.locator('.onboard-summary code').first().innerText()).trim();
 assert.match(planSha,/^[0-9a-f]{64}$/u);
 assert.ok(!(await page.locator('#view-content').innerText()).includes('private-source-filename.txt'));
 await page.screenshot({path:out+'/git-onboarding-plan.png',fullPage:true});
 await page.getByRole('button',{name:'Confirm and create workspace'}).click();
 await fill('Re-enter the full 64-character plan SHA-256',planSha);
 await fill('Re-enter the full 40-character Git head commit SHA',head);
 for(const checkbox of await dialog.getByRole('checkbox').all())await checkbox.check();
 await save('Create or recover local workspace');
 await page.getByRole('heading',{name:'Workspace created or recovered'}).waitFor();
 const imported=app.list('release').find(x=>x.data.name==='Imported head commit review');
 assert.ok(imported,'UI created the new release via the existing Native SDK dispatcher');
 assert.equal(imported.data.build,head);
 const evidence=app.list('evidence',imported.id);
 assert.equal(evidence.length,1);
 assert.equal(evidence[0].data.admission,'imported-declaration');
 assert.equal(evidence[0].data.technical,'UNKNOWN');
 assert.equal(app.list('deliverable',imported.id).length,1);
 assert.ok(!(await page.locator('#view-content').innerText()).includes('private-source-filename.txt'));
 await page.screenshot({path:out+'/git-onboarding-created.png',fullPage:true});
 for(const width of [320,390,768]){
   await page.setViewportSize({width,height:900});
   const overflow=await page.evaluate(()=>({
     viewport:innerWidth,document:document.documentElement.scrollWidth,
     offenders:[...document.querySelectorAll('body *')].filter(el=>
       el.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(el=>({
         tag:el.tagName,className:el.className?.baseVal??el.className,
         right:Math.ceil(el.getBoundingClientRect().right),
         text:(el.textContent??'').slice(0,50)
       }))
   }));
   assert.ok(overflow.document<=width+1,
     'R37 Git import view overflows viewport '+width+': '+JSON.stringify(overflow));
   await page.screenshot({path:out+'/git-onboarding-'+width+'.png',fullPage:true});
 }
 await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:'Open release workspace'}).click();
 await page.getByRole('heading',{name:'Imported head commit review'}).waitFor();
 const keys=await page.evaluate(()=>Object.keys(localStorage));
 assert.ok(!keys.some(k=>k.includes('git-')||k.includes('observation')),
   'Source metadata must not be persisted in browser localStorage');
 onboardingAccepted=true;
 assert.equal(errors.length,0,JSON.stringify(errors));
 ok=true;
}finally{
 writeFileSync(out+'/result.json',JSON.stringify({
   schema_version:'launchwright-browser-e2e/1',
   source_sha:process.env.GITHUB_SHA??null,
   passed:ok,
   page_errors:errors,
   network,
   console:consoleMessages,
   scope:'real-app-ui-only',
   local_owner_git_onboarding_ui_accepted:onboardingAccepted,
   customer_project_acceptance:false,
   platform_publish_authority:false,
   native_host_acceptance:false,
   product_capture:false
 },null,2)+'\n');
 if(!ok)await page.screenshot({path:out+'/failure.png',fullPage:true});
 await browser.close();await service.close();app.close();
 rmSync(root,{recursive:true,force:true,maxRetries:8,retryDelay:50});
}
