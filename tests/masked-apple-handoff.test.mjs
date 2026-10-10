// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import { readFileSync,writeFileSync,readdirSync,mkdirSync,
  chmodSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import JSZip from 'jszip';
import {makeOwnedMaskedAppleFixture} from './masked-apple-fixture.mjs';
import {planStorePackage} from '../src/store-package.mjs';
import {prepareAppleScreenshotUpload} from '../src/apple-screenshot-upload.mjs';
import {planMaskedApple,verifyMaskedApple,exportMaskedApple,
  prepareMaskedAppleUpload,sendMaskedAppleUpload}
  from '../src/masked-apple-handoff.mjs';

const hash=v=>createHash('sha256').update(v).digest('hex');
const cwd=fileURLToPath(new URL('../',import.meta.url));
const md5=v=>createHash('md5').update(v).digest('hex');
const APPLE_SET='owned_set_for_masked_synthetic',APPLE_LOCALE='owned_localization_masked';
const appleOptions={
  screenshot_set_id:APPLE_SET,localization_id:APPLE_LOCALE,
  screenshot_display_type:'APP_IPHONE_61',acknowledge_asset_only:true
};
class AppleAssetMock {
  constructor(){this.rows=[];this.calls=[];this.committed=[];}
  async getScreenshotSet(id){
    this.calls.push('getSet');
    return{data:{id,type:'appScreenshotSets',
      attributes:{screenshotDisplayType:'APP_IPHONE_61'},
      relationships:{appStoreVersionLocalization:{
        data:{id:APPLE_LOCALE,type:'appStoreVersionLocalizations'}
      }}
    }};
  }
  async getLocalization(id){
    this.calls.push('getLocalization');
    return{data:{id,type:'appStoreVersionLocalizations',
      attributes:{locale:'en-US'}}};
  }
  async listScreenshots(){
    this.calls.push('list');
    return{data:this.rows.map(row=>({
      type:'appScreenshots',id:row.id,
      attributes:{fileName:row.name,fileSize:row.size,
        sourceFileChecksum:row.md5,
        assetDeliveryState:{state:row.state,errors:[]}}
    })),links:{next:null}};
  }
  async createScreenshot(input){
    this.calls.push('reserve');
    const id='owned_masked_screenshot_'+(this.rows.length+1);
    const row={id,name:input.file_name,size:input.file_size,state:'AWAITING_UPLOAD',
      md5:null,parts:[]};
    this.rows.push(row);
    return{data:{id,type:'appScreenshots',
      attributes:{fileName:row.name,fileSize:row.size,
        assetDeliveryState:{state:row.state,errors:[]},
        uploadOperations:[{
          method:'PUT',url:'https://signed.blobstore.apple.com/owned-test?sig=fixture',
          offset:0,length:row.size,requestHeaders:[{
            name:'Content-Type',value:'image/png'
          }]
        }]
      }
    }};
  }
  async uploadPart(op,bytes){
    this.calls.push('put');
    assert.equal(op.length,bytes.length);
    this.rows.at(-1).parts.push(Buffer.from(bytes));
    return{part_uploaded:true};
  }
  async commitScreenshot(id,checksum){
    this.calls.push('commit');
    const row=this.rows.find(x=>x.id===id);
    assert.ok(row);
    const joined=Buffer.concat(row.parts);
    assert.equal(joined.length,row.size);
    assert.equal(md5(joined),checksum);
    row.md5=checksum;row.state='UPLOAD_COMPLETE';
    this.committed.push(hash(joined));
    return{data:{id,type:'appScreenshots',
      attributes:{assetDeliveryState:{state:'UPLOAD_COMPLETE',errors:[]}}}};
  }
}
test('R58 real owned R55->Native redacted pixels->R44 Apple 1179x2556->R51 App Store intent, no false privacy claim',async t=>{
  const f=await makeOwnedMaskedAppleFixture();
  t.after(()=>f.close());
  const plan=planMaskedApple(f.app,f.bundle);
  const store=planStorePackage(f.app,f.storeInput);
  await t.test('exact private plan has one direct R55 masked source and no workspace effects',()=>{
    assert.deepEqual(plan,planMaskedApple(f.app,f.bundle));
    assert.deepEqual(verifyMaskedApple(f.app,plan,f.bundle),plan);
    assert.equal(plan.screenshot_count,1);
    assert.equal(plan.store_plan_sha256,store.plan_sha256);
    assert.equal(plan.technical_state,'UNKNOWN');
    assert.equal(plan.all_personal_information_removed,false);
    assert.equal(plan.privacy_outside_masks_verified,false);
    assert.equal(plan.source_device_attested,false);
    assert.equal(plan.apple_upload_performed,false);
    assert.equal(plan.platform_authority,false);
    assert.ok(!JSON.stringify(plan).includes(f.root));
    assert.equal(plan.masked_sources[0].masked_pixels,27500);
    assert.deepEqual(readdirSync(f.outDir),[]);
  });
  let result;
  await t.test('real Apple ZIP preserves EVERY R55 redacted pixel and exact Native derivative version',async()=>{
    result=await exportMaskedApple(f.app,plan,f.bundle,f.outDir,f.confirm(plan));
    assert.equal(result.proof_created,true);
    assert.equal(result.store_files_created,2);
    assert.equal(result.app_published,false);
    assert.equal(result.apple_api_communicated,false);
    assert.equal(result.privacy_outside_masks_verified,false);
    assert.equal(result.platform_authority,false);
    const zipped=await JSZip.loadAsync(readFileSync(join(f.outDir,result.store_zip_filename)),{
      checkCRC32:true
    });
    const packed=await zipped.file('screenshots/01.png').async('nodebuffer');
    const masked=readFileSync(f.storeInput.screenshots[0].png.path);
    const original=PNG.sync.read(readFileSync(
      f.maskedSources[0].mask_input.source_png_path),{checkCRC:true});
    const normalized=PNG.sync.read(packed,{checkCRC:true});
    const maskPNG=PNG.sync.read(masked,{checkCRC:true});
    assert.equal(normalized.width,1179);
    assert.equal(normalized.height,2556);
    assert.equal(packed[25],2);
    assert.deepEqual(normalized.data,maskPNG.data);
    const expected=Buffer.from(original.data);
    let covered=0;
    for(const mask of f.maskedSources[0].mask_input.rectangles){
      for(let y=mask.y;y<mask.y+mask.height;y++){
        for(let x=mask.x;x<mask.x+mask.width;x++){
          const index=(y*normalized.width+x)*4;
          expected[index]=8;expected[index+1]=22;
          expected[index+2]=33;expected[index+3]=255;
          covered++;
        }
      }
    }
    assert.deepEqual(normalized.data,expected,
      'Full R55 vs R44 Apple pixel array must preserve all unmasked pixels and exact opaque masks');
    assert.equal(covered,plan.masked_sources[0].masked_pixels);
    const native=f.app.get(plan.masked_sources[0].derived_evidence_id,'evidence');
    assert.equal(native.data.technical,'UNKNOWN');
    assert.equal(native.data.observed_state_eligible,false);
    assert.equal(native.data.provenance.transformations[0].semantic_effect,'changes-observed-state');
    assert.equal(native.data.receipt.provider,'launchwright-pixel-mask');
  });
  let wrapped;
  await t.test('R51 actual Apple request planner is pinned to same R55 original and normalized screenshot',async()=>{
    wrapped=await prepareMaskedAppleUpload(f.app,plan,f.bundle,f.outDir,result,appleOptions);
    const original=await prepareAppleScreenshotUpload(f.app,store,f.storeInput,
      join(f.outDir,result.store_zip_filename),appleOptions);
    assert.equal(wrapped.apple_intent.intent_sha256,original.intent_sha256);
    assert.equal(wrapped.apple_intent.source_zip_sha256,result.store_zip_sha256);
    assert.equal(wrapped.apple_intent.images[0].source_evidence_id,
      plan.masked_sources[0].derived_evidence_id);
    assert.equal(wrapped.apple_intent.images[0].sha256,
      plan.masked_sources[0].store_png_normalized_sha256);
    assert.equal(wrapped.remote_actions_performed,false);
    assert.equal(wrapped.residual_pii_unknown,true);
    assert.equal(wrapped.platform_authority,false);
  });
  await t.test('R51 bounded Apple upload and recover-only cannot override R55 Native masked origin',async()=>{
    const provider=new AppleAssetMock();
    const approved={
      confirm_masked_plan_sha256:plan.plan_sha256,
      confirm_intent_sha256:wrapped.apple_intent.intent_sha256,
      confirm_candidate_sha256:wrapped.apple_intent.candidate_sha256,
      confirm_screenshot_set_id:APPLE_SET,
      acknowledge_first_remote_write:true
    };
    const first=await sendMaskedAppleUpload(f.app,plan,f.bundle,f.outDir,result,
      wrapped,provider,approved);
    assert.equal(first.state,'PROCESSING_PENDING');
    assert.equal(first.pixels_outside_operator_masks_proven_unchanged,true);
    assert.equal(first.pii_outside_masks_verified,false);
    assert.equal(first.app_published,false);
    assert.equal(provider.calls.filter(x=>x==='reserve').length,1);
    assert.equal(provider.calls.filter(x=>x==='put').length,1);
    assert.equal(provider.committed[0],wrapped.apple_intent.images[0].sha256);
    const recovered=await sendMaskedAppleUpload(f.app,plan,f.bundle,f.outDir,result,
      wrapped,provider,{...approved,recover_only:true,
        acknowledge_first_remote_write:false});
    assert.equal(recovered.state,'PROCESSING_PENDING');
    assert.equal(recovered.remote_mutation_performed,false);
    assert.equal(provider.calls.filter(x=>x==='reserve').length,1);
  });
  await t.test('unconsented or spoofed masked Apple intents never contact remote endpoint',async()=>{
    const remote=new AppleAssetMock();
    await assert.rejects(sendMaskedAppleUpload(f.app,plan,f.bundle,f.outDir,result,
      wrapped,remote,{
        confirm_masked_plan_sha256:'0'.repeat(64),
        confirm_intent_sha256:wrapped.apple_intent.intent_sha256,
        confirm_candidate_sha256:wrapped.apple_intent.candidate_sha256,
        confirm_screenshot_set_id:APPLE_SET,acknowledge_first_remote_write:true
      }),{code:'ConsentRequired'});
    await assert.rejects(sendMaskedAppleUpload(f.app,plan,f.bundle,f.outDir,result,
      {...wrapped,source_proof_sha256:'0'.repeat(64)},remote,{
        confirm_masked_plan_sha256:plan.plan_sha256,
        confirm_intent_sha256:wrapped.apple_intent.intent_sha256,
        confirm_candidate_sha256:wrapped.apple_intent.candidate_sha256,
        confirm_screenshot_set_id:APPLE_SET,acknowledge_first_remote_write:true
      }),{code:'StaleReference'});
    assert.deepEqual(remote.calls,[]);
  });
  await t.test('exact repeat export reuses all store files and the same independent mask receipt',async()=>{
    const repeat=await exportMaskedApple(f.app,plan,f.bundle,f.outDir,f.confirm(plan));
    assert.equal(repeat.recovered,true);
    assert.equal(repeat.proof_created,false);
    assert.equal(repeat.store_files_created,0);
    assert.equal(repeat.store_zip_sha256,result.store_zip_sha256);
  });
});
test('R58 mismatched mask evidence, changed pixel digest, wrong rights or revoked consent cannot produce Apple plan',async t=>{
  const f=await makeOwnedMaskedAppleFixture();
  t.after(()=>f.close());
  const source=f.maskedSources[0];
  assert.throws(()=>planMaskedApple(f.app,{
    ...f.bundle,acknowledge_mask_scope_only:false
  }),{code:'ConsentRequired'});
  assert.throws(()=>planMaskedApple(f.app,{
    ...f.bundle,acknowledge_private_apple_only:false
  }),{code:'ConsentRequired'});
  assert.throws(()=>planMaskedApple(f.app,{
    ...f.bundle,masked_sources:[{...source,mask_receipt:{
      ...source.mask_receipt,derived_evidence_id:'other_evidence'
    }}]
  }),{code:'Conflict'});
  assert.throws(()=>planMaskedApple(f.app,{
    ...f.bundle,store_input:{...f.storeInput,source_rights:'licensed'}
  }));
  const wrongScreens=structuredClone(f.storeInput.screenshots);
  wrongScreens[0].png.sha256='a'.repeat(64);
  assert.throws(()=>planMaskedApple(f.app,{
    ...f.bundle,store_input:{...f.storeInput,screenshots:wrongScreens}
  }),{code:'Conflict'});
  assert.deepEqual(readdirSync(f.outDir),[]);
});


test('R58 private operator CLI prepares, exports and stage-plans the exact R55 to R51 Apple chain',async t=>{
  const f=await makeOwnedMaskedAppleFixture();
  t.after(()=>f.close());
  const raw=join(f.root,'private-r58-input.json');
  const intentFile=join(f.root,'private-r58-plan.json');
  const appleFile=join(f.root,'private-apple-stage-intent.json');
  writeFileSync(raw,JSON.stringify(f.bundle,null,2),{flag:'wx',mode:0o600});
  const run=args=>spawnSync(process.execPath,['scripts/masked-apple.mjs',...args],{
    cwd,encoding:'utf8',timeout:120000
  });
  const planCmd=['plan','--state',f.app.store.root,
    '--bundle',raw,'--out',intentFile];
  const planned=run(planCmd);
  assert.equal(planned.status,0,planned.stdout+planned.stderr);
  const plan=JSON.parse(readFileSync(intentFile,'utf8'));
  assert.equal(plan.technical_state,'UNKNOWN');
  assert.notEqual(run(planCmd).status,0,
    'A previously saved private mask plan must never be overwritten');
  const exportCmd=['export','--state',f.app.store.root,
    '--bundle',raw,'--plan',intentFile,'--out-dir',f.outDir,
    '--confirm-masked',plan.plan_sha256,
    '--confirm-store',plan.store_plan_sha256,
    '--confirm-candidate',plan.candidate_sha256,
    '--acknowledge-private-export','--acknowledge-remaining-privacy-unknown'];
  const sent=run(exportCmd);
  assert.equal(sent.status,0,sent.stdout+sent.stderr);
  assert.equal(JSON.parse(sent.stdout).apple_api_communicated,false);
  const replay=run(exportCmd);
  assert.equal(replay.status,0,replay.stdout+replay.stderr);
  assert.equal(JSON.parse(replay.stdout).recovered,true);
  const applePlanCmd=['apple-plan','--state',f.app.store.root,
    '--bundle',raw,'--plan',intentFile,'--out-dir',f.outDir,
    '--screenshot-set',APPLE_SET,'--localization',APPLE_LOCALE,
    '--out',appleFile,'--acknowledge-asset-only'];
  const apple=run(applePlanCmd);
  assert.equal(apple.status,0,apple.stdout+apple.stderr);
  const wrapped=JSON.parse(readFileSync(appleFile,'utf8'));
  assert.equal(wrapped.apple_intent.images[0].source_evidence_id,
    plan.masked_sources[0].derived_evidence_id);
  assert.notEqual(run(applePlanCmd).status,0);
  assert.equal(readdirSync(f.outDir).some(name=>name.includes('.jwt')),false);
});

test('R58 tampered or foreign masked Apple proof is rejected before any real store upload',async t=>{
  const f=await makeOwnedMaskedAppleFixture();
  t.after(()=>f.close());
  const plan=planMaskedApple(f.app,f.bundle);
  const result=await exportMaskedApple(f.app,plan,f.bundle,f.outDir,f.confirm(plan));
  for(const altered of [
    {...result,masked_sources:[]},
    {...result,store_zip_filename:'../another-store.zip'},
    {...result,source_png_pixels_exact:false},
    {...result,privacy_outside_masks_verified:true}
  ]){
    await assert.rejects(prepareMaskedAppleUpload(f.app,plan,f.bundle,f.outDir,
      altered,appleOptions),{code:'Conflict'});
  }
  const receiptPath=join(f.outDir,result.receipt_filename);
  writeFileSync(receiptPath,'{"schema_version":"spoofed"}');
  await assert.rejects(prepareMaskedAppleUpload(f.app,plan,f.bundle,f.outDir,
    result,appleOptions),{code:'Conflict'});
});
