// SPDX-License-Identifier: AGPL-3.0-only
// Real application UI E2E, NOT product capture or canonical Driver Host acceptance.
import { chromium } from '../.ci-tools/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
let ok=false;
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
 await fill('Release name','1.0 launch');await fill('Immutable build identity','browser-build-A');await save();
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
   native_host_acceptance:false,
   product_capture:false
 },null,2)+'\n');
 if(!ok)await page.screenshot({path:out+'/failure.png',fullPage:true});
 await browser.close();await service.close();app.close();
 rmSync(root,{recursive:true,force:true,maxRetries:8,retryDelay:50});
}
