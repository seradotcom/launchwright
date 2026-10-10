// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync,writeFileSync,mkdirSync,chmodSync,rmSync,
  readdirSync,statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { PNG } from 'pngjs';
import { execute } from '../src/application.mjs';
import { makeOwnedMaskedStoreFixture } from './masked-store-fixture.mjs';
import { planStorePackage } from '../src/store-package.mjs';
import { prepareGooglePlayStaging } from '../src/google-play-staging.mjs';
import { planMaskedStore,verifyMaskedStore,
  exportMaskedStore } from '../src/masked-store-handoff.mjs';

const HASH=x=>createHash('sha256').update(x).digest('hex');
const worktree=fileURLToPath(new URL('../',import.meta.url));
function pdir(root,name){
  const dir=join(root,name);
  mkdirSync(dir,{mode:0o700});
  if(process.platform!=='win32')chmodSync(dir,0o700);
  return dir;
}
test('R56 real owned R55→Native derivative→R44 Google Play listing ZIP with no false privacy/Platform authority',async t=>{
  const f=await makeOwnedMaskedStoreFixture();
  t.after(()=>f.close());
  const saved=planMaskedStore(f.app,f.bundle);
  const storePlan=planStorePackage(f.app,f.storeInput);
  const approvals=f.confirm(saved);
  await t.test('private R56 plan has exact 2 screenshot chains, no paths and no workspace mutation',()=>{
    assert.equal(saved.screenshot_count,2);
    assert.equal(saved.store_plan_sha256,storePlan.plan_sha256);
    assert.equal(saved.candidate_sha256,f.candidate.data.candidate_sha256);
    assert.equal(saved.technical_state,'UNKNOWN');
    assert.equal(saved.privacy_outside_masks_verified,false);
    assert.equal(saved.all_personal_information_removed,false);
    assert.equal(saved.source_device_attestation,false);
    assert.equal(saved.store_account_accepted,false);
    assert.equal(saved.external_store_upload_performed,false);
    assert.equal(saved.platform_authority,false);
    assert.ok(!JSON.stringify(saved).includes(f.root));
    assert.ok(!JSON.stringify(saved).includes('screenshot-1.png'));
    assert.deepEqual(verifyMaskedStore(f.app,saved,f.bundle),saved);
    assert.equal(f.app.list('channel_delivery').length,0);
    assert.deepEqual(readdirSync(f.storeDir),[]);
    assert.deepEqual(saved.masked_sources.map(s=>s.masked_pixels),[25400,25400]);
  });
  let first;
  await t.test('exact R44 package source pixels match BOTH R55 SHA-bound masked Native derivatives',async()=>{
    first=await exportMaskedStore(f.app,saved,f.bundle,f.storeDir,approvals);
    assert.equal(first.store_files_created,2);
    assert.equal(first.proof_created,true);
    assert.equal(first.technical_state,'UNKNOWN');
    assert.equal(first.store_publication_performed,false);
    assert.equal(first.platform_authority,false);
    assert.equal(first.pixels_outside_masks_verified_unchanged,true);
    assert.equal(first.privacy_outside_masks_verified,false);
    assert.equal(first.remote_actions_performed,false);
    const archive=await JSZip.loadAsync(
      readFileSync(join(f.storeDir,first.store_zip_filename)),{checkCRC32:true});
    for(let index=0;index<2;index++){
      const file='screenshots/'+String(index+1).padStart(2,'0')+'.png';
      const normalized=await archive.file(file).async('nodebuffer');
      const masked=readFileSync(f.storeInput.screenshots[index].png.path);
      const fromStore=PNG.sync.read(normalized,{checkCRC:true});
      const fromR55=PNG.sync.read(masked,{checkCRC:true});
      assert.equal(fromStore.width,1080);
      assert.equal(fromStore.height,1920);
      assert.equal(normalized[25],2,'Google store screenshot cannot have alpha');
      assert.deepEqual(fromStore.data,fromR55.data,
        'Store packaging must preserve EVERY exact R55 masked pixel');
      const original=PNG.sync.read(readFileSync(
        f.maskedSources[index].mask_input.source_png_path),{checkCRC:true});
      const area=f.maskedSources[index].mask_input.rectangles;
      const expected=Buffer.from(original.data);
      let changed=0;
      for(const r of area)for(let y=r.y;y<r.y+r.height;y++){
        for(let x=r.x;x<r.x+r.width;x++){
          const i=(y*fromStore.width+x)*4;
          expected[i]=8;expected[i+1]=22;expected[i+2]=33;expected[i+3]=255;
          changed++;
        }
      }
      assert.deepEqual(fromStore.data,expected,
        'Every masked pixel must be opaque and EVERY unmasked pixel unchanged');
      assert.equal(changed,saved.masked_sources[index].masked_pixels);
      assert.equal(f.app.get(f.maskedSources[index].mask_receipt.derived_evidence_id,
        'evidence').data.observed_state_eligible,false);
    }
    const proof=JSON.parse(readFileSync(
      join(f.storeDir,first.proof_filename),'utf8'));
    assert.equal(proof.store_zip_sha256,HASH(readFileSync(
      join(f.storeDir,first.store_zip_filename))));
    assert.deepEqual(proof.masked_sources,saved.masked_sources);
    assert.equal(proof.privacy_outside_masks_verified,false);
    assert.equal(proof.store_api_upload_performed,false);
    assert.equal(f.app.list('channel_delivery').length,0);
  });
  await t.test('R56 ZIP is accepted by existing R52 Google Play Edit planner, still no remote send',async()=>{
    const upload=await prepareGooglePlayStaging(f.app,storePlan,
      f.storeInput,join(f.storeDir,first.store_zip_filename),{
        package_name:'com.owned.syntheticmask',edit_id:'owned_mask_edit_2026',
        acknowledge_uncommitted_only:true
      });
    assert.equal(upload.assets.length,4);
    assert.equal(upload.assets.filter(a=>a.type==='phoneScreenshots').length,2);
    assert.deepEqual(upload.assets.filter(a=>a.type==='phoneScreenshots')
      .map(a=>a.evidence_id),saved.masked_sources.map(a=>a.derived_evidence_id));
    assert.equal(upload.published,false);
    assert.equal(upload.commits_edit,false);
    assert.equal(upload.source_device_attestation,false);
    assert.equal(upload.independent_pixel_privacy_review,false);
    assert.equal(upload.platform_authority,false);
  });
  await t.test('exact recovered export and partial receipt loss never duplicate or overwrite',async()=>{
    const replay=await exportMaskedStore(f.app,saved,f.bundle,f.storeDir,approvals);
    assert.equal(replay.recovered,true);
    assert.equal(replay.proof_created,false);
    assert.equal(replay.store_files_created,0);
    assert.equal(replay.store_zip_sha256,first.store_zip_sha256);
    rmSync(join(f.storeDir,first.proof_filename));
    const partial=await exportMaskedStore(f.app,saved,f.bundle,f.storeDir,approvals);
    assert.equal(partial.proof_created,true);
    assert.equal(partial.store_files_created,0);
    assert.equal(partial.store_zip_sha256,first.store_zip_sha256);
  });
  await t.test('operator must confirm every source digest, store consent and UNKNOWN privacy',async()=>{
    for(const change of [
      {confirm_handoff_sha256:'0'.repeat(64)},
      {confirm_store_plan_sha256:'0'.repeat(64)},
      {confirm_candidate_sha256:'0'.repeat(64)},
      {acknowledge_private_export:false},
      {acknowledge_remaining_privacy_unknown:false}
    ]){
      await assert.rejects(exportMaskedStore(f.app,saved,f.bundle,f.storeDir,{
        ...approvals,...change
      }),{code:'ConsentRequired'});
    }
    for(const change of [
      {acknowledge_private_store_only:false},
      {acknowledge_mask_scope_only:false}
    ])assert.throws(()=>planMaskedStore(f.app,{...f.bundle,...change}),
      {code:'ConsentRequired'});
  });
  await t.test('mask order, forged native receipt, altered redacted pixel identity and wrong rights are rejected',()=>{
    const swapped={...f.bundle,masked_sources:[...f.maskedSources].reverse()};
    assert.throws(()=>planMaskedStore(f.app,swapped),{code:'Conflict'});
    const wrongReceipt={...f.maskedSources[0],mask_receipt:{
      ...f.maskedSources[0].mask_receipt,
      derived_evidence_id:f.maskedSources[1].mask_receipt.derived_evidence_id
    }};
    assert.throws(()=>planMaskedStore(f.app,{
      ...f.bundle,masked_sources:[wrongReceipt,f.maskedSources[1]]
    }),{code:'Conflict'});
    const wrongPixel={...f.bundle,
      store_input:{...f.storeInput,screenshots:f.storeInput.screenshots.map((s,i)=>
        i===0?{...s,png:{...s.png,sha256:'f'.repeat(64)}}:s)}
    };
    assert.throws(()=>planMaskedStore(f.app,wrongPixel),{code:'Conflict'});
    assert.throws(()=>planMaskedStore(f.app,{
      ...f.bundle,store_input:{...f.storeInput,source_rights:'licensed'}
    }));
    assert.throws(()=>verifyMaskedStore(f.app,{...saved,build:'unrelated'},f.bundle),
      {code:'Conflict'});
  });
  await t.test('tampered private R56 proof is rejected before creating any new R44 package files',async()=>{
    const out=pdir(f.root,'malicious-receipt');
    const path=join(out,first.proof_filename);
    writeFileSync(path,'{"schema_version":"other"}',{mode:0o600});
    await assert.rejects(exportMaskedStore(f.app,saved,f.bundle,out,approvals),
      {code:'Conflict'});
    assert.deepEqual(readdirSync(out),[first.proof_filename]);
  });
  await t.test('abandoned local R56 operator lock blocks any concurrent writers',async()=>{
    const out=pdir(f.root,'locked-output');
    const file=join(f.app.store.root,'.masked-store-apply.lock');
    writeFileSync(file,'other operator',{mode:0o600});
    try{
      await assert.rejects(exportMaskedStore(f.app,saved,f.bundle,out,approvals),
        {code:'Conflict'});
      assert.deepEqual(readdirSync(out),[]);
      assert.equal(readFileSync(file,'utf8'),'other operator');
    }finally{rmSync(file)}
  });
  await t.test('two-phase private R56 CLI creates a digest-bound plan and reuses exact store ZIP',async()=>{
    const out=pdir(f.root,'cli-private');
    const inputFile=join(f.root,'source-private-r56.json'),
      planFile=join(f.root,'plan-private-r56.json');
    writeFileSync(inputFile,JSON.stringify(f.bundle),{mode:0o600});
    const call=args=>spawnSync(process.execPath,['scripts/masked-store-handoff.mjs',...args],{
      cwd:worktree,encoding:'utf8',timeout:75000
    });
    const cmd=['plan','--state',f.app.store.root,'--input',inputFile,
      '--out',planFile];
    const p=call(cmd);
    assert.equal(p.status,0,p.stdout+p.stderr);
    const generated=JSON.parse(readFileSync(planFile,'utf8'));
    assert.equal(generated.plan_sha256,saved.plan_sha256);
    assert.equal(JSON.parse(p.stdout).workspace_mutated,false);
    if(process.platform!=='win32')
      assert.equal(statSync(planFile).mode&0o077,0);
    assert.notEqual(call(cmd).status,0);
    const send=['export','--state',f.app.store.root,'--input',inputFile,
      '--plan',planFile,'--out-dir',out,
      '--confirm-handoff',saved.plan_sha256,
      '--confirm-store',saved.store_plan_sha256,
      '--confirm-candidate',saved.candidate_sha256,
      '--acknowledge-private-export','--acknowledge-remaining-privacy-unknown'];
    const firstOutput=call(send);
    assert.equal(firstOutput.status,0,firstOutput.stdout+firstOutput.stderr);
    const fromCli=JSON.parse(firstOutput.stdout);
    assert.equal(fromCli.store_zip_sha256,first.store_zip_sha256);
    assert.equal(fromCli.proof_created,true);
    const repeated=call(send);
    assert.equal(repeated.status,0,repeated.stdout+repeated.stderr);
    assert.equal(JSON.parse(repeated.stdout).recovered,true);
  });
  await t.test('changing a real Native source version revokes prior R55/R44 handoff',async()=>{
    const source=await execute(f.app,'entity.update',{
      id:f.source.id,expected:f.source.version,
      data:{...f.source.data,purpose:'Different source approval after the original plan'}
    });
    assert.ok(source.entity);
    // R44 verifies Candidate freshness first: a newly modified source
    // revokes editorial readiness and therefore requires a new approval.
    assert.throws(()=>planMaskedStore(f.app,f.bundle),{code:'ConsentRequired'});
    assert.throws(()=>verifyMaskedStore(f.app,saved,f.bundle),{code:'ConsentRequired'});
  });
});
