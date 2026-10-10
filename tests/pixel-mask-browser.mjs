// SPDX-License-Identifier: AGPL-3.0-only
// R55 real Chromium E2E: operator masks owned synthetic pixels, Native SDK
// records SANITIZED_DERIVATIVE, the R43 offline viewer uses that exact PNG.
// This is NOT a general PII verifier or customer product acceptance.
import assert from 'node:assert/strict';
import { chromium } from '../.ci-tools/node_modules/playwright/index.mjs';
import { createHash } from 'node:crypto';
import {
  chmodSync,copyFileSync,mkdirSync,mkdtempSync,
  readFileSync,rmSync,writeFileSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import { PNG } from 'pngjs';
import { execute } from '../src/application.mjs';
import { makeOwnedInteractiveFixture } from './interactive-fixture.mjs';
import { preparePixelMask,applyPixelMask } from '../src/pixel-redaction.mjs';
import {planInteractiveDemo,exportInteractiveDemo} from '../src/interactive-demo.mjs';

const out=resolve('evidence/pixel-mask-browser');
mkdirSync(out,{recursive:true,mode:0o700});
if(process.platform!=='win32')chmodSync(out,0o700);
const root=mkdtempSync(join(tmpdir(),'launchwright-r55-chromium-'));
let f,browser,page,passed=false;
const failures=[],external=[];
const sha=data=>createHash('sha256').update(data).digest('hex');
try{
  f=await makeOwnedInteractiveFixture(root);
  const privateOut=join(root,'masked');
  mkdirSync(privateOut,{mode:0o700});
  if(process.platform!=='win32')chmodSync(privateOut,0o700);
  const redacted=[];
  for(let i=0;i<2;i++){
    const frame=f.frames[i];
    const input={
      parent_evidence_id:f.plan.data.shots[i].capture_evidence_id,
      source_png_path:frame.png_path,source_png_sha256:frame.png_sha256,
      rectangles:[
        {label:'synthetic-profile',x:190,y:90,width:70,height:42},
        {label:'synthetic-history',x:280,y:211,width:64,height:35}
      ],
      rights:'owned',
      acknowledge_source_rights:true,
      acknowledge_residual_privacy_unknown:true,
      acknowledge_masked_pixels:true
    };
    const plan=preparePixelMask(f.app,input);
    const result=await applyPixelMask(f.app,plan,input,privateOut,{
      confirm_plan_sha256:plan.plan_sha256,
      confirm_source_png_sha256:plan.source_png_sha256,
      acknowledge_private_file_write:true
    });
    const img=readFileSync(join(privateOut,result.output_filename));
    assert.equal(sha(img),result.redacted_png_sha256);
    const decoded=PNG.sync.read(img,{checkCRC:true});
    for(const pos of [[200,110],[300,230]]){
      const index=(pos[1]*decoded.width+pos[0])*4;
      assert.deepEqual([...decoded.data.subarray(index,index+4)],[8,22,33,255]);
    }
    const prior=f.app.get(result.derived_evidence_id,'evidence');
    assert.equal(prior.data.provenance.capture_class,'SANITIZED_DERIVATIVE');
    assert.equal(prior.data.observed_state_eligible,false);
    assert.equal(prior.data.technical,'UNKNOWN');
    const dest=join(out,'redacted-'+(i+1)+'.png');
    copyFileSync(join(privateOut,result.output_filename),dest);
    redacted.push({...result,png_path:dest});
  }
  const fields=['release_id','target_id','scenario_id','name','backend',
    'frame_rate','duration','shots','assets','tracks','variants','interactive_policy'];
  const values=Object.fromEntries(fields.map(k=>[k,f.plan.data[k]]));
  values.shots=values.shots.map((shot,i)=>({
    ...shot,interactive_evidence_id:redacted[i].derived_evidence_id,
    transform_refs:['r55-pixel-masked-synthetic-shots']
  }));
  const revision=(await execute(f.app,'media.revise',{
    id:f.plan.id,expected:f.plan.version,plan:values,
    reason:'Scoped tested operator-defined pixel masks'
  })).entity;
  const frames=f.frames.map((frame,i)=>({
    ...frame,png_path:redacted[i].png_path,
    png_sha256:redacted[i].redacted_png_sha256,
    source_evidence_id:redacted[i].derived_evidence_id
  }));
  const input={...f.input,media_plan_id:revision.id,frames};
  const planned=planInteractiveDemo(f.app,input);
  const demo=await exportInteractiveDemo(f.app,planned,input,privateOut,{
    confirm_plan_sha256:planned.plan_sha256,
    confirm_media_plan_digest:planned.media_plan_digest,
    acknowledge_private_export:true
  });
  assert.equal(demo.technical_state,'UNKNOWN');
  const zipBuffer=readFileSync(join(privateOut,demo.filename));
  const zip=await JSZip.loadAsync(zipBuffer,{checkCRC:true});
  const html=await zip.file('index.html').async('string');
  const manifest=JSON.parse(await zip.file('manifest.json').async('string'));
  assert.deepEqual(manifest.screenshots.map(s=>s.source_evidence_id),
    redacted.map(s=>s.derived_evidence_id));
  assert.equal(manifest.pixel_privacy_independently_verified,false);
  assert.equal(manifest.technical_state,'UNKNOWN');
  assert.ok(!/<script\b|https?:\/\//iu.test(html));
  writeFileSync(join(out,'index.html'),html,{mode:0o600,flag:'wx'});
  copyFileSync(join(privateOut,demo.filename),join(out,'owned-masked-demo.zip'));
  browser=await chromium.launch({headless:true});
  page=await browser.newPage({viewport:{width:1280,height:960}});
  page.on('pageerror',e=>failures.push(e.message));
  page.on('request',req=>{
    if(/^https?:/iu.test(req.url()))external.push(req.url());
  });
  await page.goto(pathToFileURL(join(out,'index.html')).href);
  await page.getByRole('heading',{name:'Private product walkthrough'}).waitFor();
  assert.equal(await page.locator('.frame:visible').count(),1);
  assert.equal(await page.locator('#step-1').isChecked(),true);
  await page.locator('label[for="step-2"]').click();
  assert.equal(await page.locator('#step-2').isChecked(),true);
  assert.equal(await page.locator('#frame-2').isVisible(),true);
  assert.equal(await page.locator('#frame-1').isVisible(),false);
  await page.locator('#step-1').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#step-2').isChecked(),true);
  for(const width of [320,390,768,1280]){
    await page.setViewportSize({width,height:900});
    const layout=await page.evaluate(()=>({
      window:innerWidth,document:document.documentElement.scrollWidth
    }));
    assert.ok(layout.document<=width+1,
      'R55 owned offline viewer overflows '+width+'px '+JSON.stringify(layout));
    await page.screenshot({
      path:join(out,'owned-masked-'+width+'.png'),fullPage:true
    });
  }
  assert.deepEqual(external,[]);
  assert.deepEqual(failures,[]);
  assert.equal(await page.locator('script').count(),0);
  assert.ok((await page.locator('body').innerText()).includes('TECHNICAL UNKNOWN'));
  const report={
    schema_version:'launchwright-r55-owned-chromium/1',
    passed:true,synthetic_fixture:true,source_authority:'OWNED_SYNTHETIC',
    native_sanitized_derivatives:2,
    source_pixel_mask_regions_verified:4,
    source_pixels_outside_masks_unchanged:true,
    original_source_pngs_retained_in_artifacts:false,
    output_pngs: redacted.map(x=>({
      sha256:x.redacted_png_sha256,masked_pixels:x.masked_pixels,
      source_evidence_id:x.source_evidence_id,
      derived_evidence_id:x.derived_evidence_id
    })),
    media_output_id:demo.media_output_id,
    media_technical_state:'UNKNOWN',
    offline_package_sha256:sha(zipBuffer),
    keyboard_navigation:true,
    supported_viewports:[320,390,768,1280],
    browser_page_errors:failures,
    network_requests:external,
    independent_pii_review:false,
    human_privacy_review_pending:true,
    actual_customer_source_tested:false,
    platform_authority:false,publication_authority:false
  };
  writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2)+'\n',{
    mode:0o600,flag:'wx'
  });
  passed=true;
  process.stdout.write('LAUNCHWRIGHT_R55_OWNED_MASKED_CHROMIUM_PASS '+
    report.offline_package_sha256+'\n');
}finally{
  if(!passed&&page){
    try{await page.screenshot({path:join(out,'failure.png'),fullPage:true});}
    catch{}
  }
  try{await browser?.close();}catch{}
  try{f?.close();}catch{}
  rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});
}
