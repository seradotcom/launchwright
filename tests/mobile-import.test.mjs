// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applicationContext, dispatchApplication } from '@semwright/native-sdk';
import { execute } from '../src/application.mjs';
import { makeRequest } from '../src/base.mjs';
import { ingestMobilePackage } from '../src/mobile-import-local.mjs';
import { inspectMobileAssetBytes, MOBILE_IMPORT_SCHEMA } from '../src/mobile-import.mjs';
import { IntegrationsNativeApplication } from '../src/native-integrations-app.mjs';
import { nativeDriverName } from '../src/native-profile-base.mjs';
import { setup, baseline } from './helpers.mjs';

const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zt6cAAAAASUVORK5CYII=','base64');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

function box(type,payload){
  const out=Buffer.alloc(8+payload.length);
  out.writeUInt32BE(out.length,0);out.write(type,4,4,'ascii');payload.copy(out,8);return out;
}
function syntheticMp4(width=1080,height=1920){
  const ftyp=box('ftyp',Buffer.from('isom\0\0\0\0isomiso2','binary'));
  const tkhd=Buffer.alloc(84);
  tkhd[0]=0;tkhd.writeUInt32BE(width*65536,76);tkhd.writeUInt32BE(height*65536,80);
  return Buffer.concat([ftyp,box('moov',box('trak',box('tkhd',tkhd)))]);
}
async function createMobileSource(b){
  return b.create('source',{
    product_id:b.product.id,name:'External mobile bundle',type:'mobile-import',
    locator:'mobile://operator-export/synthetic',build:b.release.data.build,coverage:'partial'
  });
}
function mobileInput(b,source,asset,overrides={}){
  return{
    schema_version:MOBILE_IMPORT_SCHEMA,release_id:b.release.id,target_id:b.target.id,source_id:source.id,
    name:'Synthetic mobile import',build:b.release.data.build,
    device:{kind:'physical',model:'Synthetic Phone'},
    os:{family:'android',version:'16'},locale:'en-US',
    origin:{kind:'external-device',producer:'fixture',reference:'owned-test-export'},
    captured_at:'2026-10-05T20:00:00.000Z',assets:[asset],...overrides
  };
}
function packageRoot(t){
  const root=mkdtempSync(join(tmpdir(),'launchwright-mobile-package-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  return root;
}
function screenshotRecord(bytes=PNG,rights='owned'){
  const d=inspectMobileAssetBytes(bytes,'image/png');
  return{name:'overview.png',kind:'screenshot',mime:'image/png',sha256:sha256(bytes),
    size_bytes:bytes.length,width:d.width,height:d.height,rights};
}
test('mobile byte validator extracts bounded PNG and MP4 dimensions',()=>{
  assert.deepEqual(inspectMobileAssetBytes(PNG,'image/png'),{width:1,height:1,format:'png'});
  const mp4=syntheticMp4();
  assert.deepEqual(inspectMobileAssetBytes(mp4,'video/mp4'),{width:1080,height:1920,format:'mp4'});
  assert.throws(()=>inspectMobileAssetBytes(Buffer.from('<svg/>'),'image/png'));
});

test('mobile package stages bounded media above the default text-artifact budget without widening that default',async t=>{
  const {app}=setup(t),b=await baseline(app),source=await createMobileSource(b),root=packageRoot(t);
  const bytes=Buffer.concat([syntheticMp4(720,1280),box('free',Buffer.alloc(1100000))]);
  const dimensions=inspectMobileAssetBytes(bytes,'video/mp4');
  const asset={name:'walkthrough.mp4',kind:'screen-recording',mime:'video/mp4',sha256:sha256(bytes),width:dimensions.width,height:dimensions.height,rights:'owned'};
  writeFileSync(join(root,asset.name),bytes);
  writeFileSync(join(root,'launchwright-mobile-import.json'),JSON.stringify({
    ...mobileInput(b,source,asset),assets:[{path:asset.name,...asset}]
  }));
  const imported=await ingestMobilePackage(app,root,{key:'mobile-import-large-bounded'});
  assert.equal(imported.artifacts[0].data.size_bytes,bytes.length);
  assert.equal(imported.artifacts[0].data.sha256,asset.sha256);
  assert.throws(()=>app.store.blob(Buffer.alloc(1024*1024+1),'application/octet-stream'),{code:'ResourceExhausted'});
});

test('RS-PRO-03 local mobile package keeps imported provenance and never claims native capture',async t=>{
  const {app}=setup(t),b=await baseline(app),source=await createMobileSource(b),root=packageRoot(t);
  const asset=screenshotRecord();
  writeFileSync(join(root,'overview.png'),PNG);
  writeFileSync(join(root,'launchwright-mobile-import.json'),JSON.stringify({
    ...mobileInput(b,source,asset),assets:[{path:'overview.png',name:asset.name,kind:asset.kind,mime:asset.mime,
      sha256:asset.sha256,width:asset.width,height:asset.height,rights:asset.rights}]
  },null,2));
  const imported=await ingestMobilePackage(app,root,{key:'mobile-import-owned'});
  assert.equal(imported.package.local_path_retained,false);
  assert.equal(imported.entity.data.classification,'imported');
  assert.equal(imported.entity.data.admission,'imported-unverified');
  assert.equal(imported.entity.data.technical,'UNKNOWN');
  assert.equal(imported.entity.data.native_capture,false);
  assert.equal(imported.entity.data.host_acceptance,'NOT_ESTABLISHED');
  assert.equal(imported.artifacts.length,1);
  assert.equal(imported.artifacts[0].data.sha256,asset.sha256);
  assert.equal(imported.artifacts[0].data.classification,'imported');
  assert.equal(imported.artifacts[0].data.technical,'UNKNOWN');
  assert.equal(imported.artifacts[0].data.mobile_evidence_id,imported.entity.id);
  const inspected=await execute(app,'mobile.inspect',{id:imported.entity.id});
  assert.equal(inspected.package_state,'READY_FOR_EDITORIAL_PACKAGE');
  assert.equal(inspected.artifacts.length,1);
  assert.equal(inspected.native_capture,false);
  assert.equal(inspected.store_review,'PENDING');
  const profile=await b.create('channel_profile',{product_id:b.product.id,name:'Synthetic mobile store draft',channel:'mobile-store-draft',profile_version:'1',destination_class:'external-draft',requirements:{format:'asset'},source:'operator-contract:mobile-store-draft',effective_at:'2026-10-05T00:00:00.000Z',idempotency:'recover-first'});
  const candidate=(await execute(app,'candidate.freeze',{release_id:b.release.id,name:'Mobile asset package',artifact_ids:[imported.artifacts[0].id],destination:'mobile-store-draft',channel_profile_ids:[profile.id],contract:{version:'v2',required_reviewers:1,require_claims_verified:false}})).entity;
  assert.deepEqual(candidate.data.manifest.rights.map(entry=>entry.id),[imported.entity.id]);
  const packaged=await execute(app,'channel.package',{candidate_id:candidate.id,profile_id:profile.id,participant:'synthetic-owned',locale:'en-US',allow_partial:false,omissions:[]});
  assert.equal(packaged.entity.data.state,'PACKAGE_READY');
  assert.equal(packaged.entity.data.external_state,'NOT_SENT');
  const preflight=await execute(app,'profile.preflight',{profile:'mobile-import',source_id:source.id,target_id:b.target.id});
  assert.equal(preflight.import_only,true);assert.equal(preflight.ready_for_native_execution,false);
});
test('mobile package rejects digest mismatch before admitting evidence',async t=>{
  const {app}=setup(t),b=await baseline(app),source=await createMobileSource(b),root=packageRoot(t);
  const asset=screenshotRecord();
  writeFileSync(join(root,'overview.png'),PNG);
  writeFileSync(join(root,'launchwright-mobile-import.json'),JSON.stringify({
    ...mobileInput(b,source,asset),assets:[{path:'overview.png',name:asset.name,kind:asset.kind,mime:asset.mime,
      sha256:'0'.repeat(64),width:asset.width,height:asset.height,rights:asset.rights}]
  }));
  await assert.rejects(ingestMobilePackage(app,root),{code:'Conflict'});
  assert.equal(app.store.all('evidence').filter(e=>e.data.evidence_type==='mobile_import').length,0);
});

test('mobile package rejects path traversal rather than reading outside its root',async t=>{
  const {app}=setup(t),b=await baseline(app),source=await createMobileSource(b),root=packageRoot(t);
  const asset=screenshotRecord();
  writeFileSync(join(root,'launchwright-mobile-import.json'),JSON.stringify({
    ...mobileInput(b,source,asset),assets:[{path:'../outside.png',name:asset.name,kind:asset.kind,mime:asset.mime,
      sha256:asset.sha256,width:asset.width,height:asset.height,rights:asset.rights}]
  }));
  await assert.rejects(ingestMobilePackage(app,root),{code:'InvalidArgument'});
  assert.equal(app.store.all('evidence').filter(e=>e.data.evidence_type==='mobile_import').length,0);
});
test('canonical integrations profile imports only pre-staged hashes and keeps unknown rights pending',async t=>{
  const seeded=setup(t),b=await baseline(seeded.app),source=await createMobileSource(b),asset=screenshotRecord(PNG,'unknown');
  const stored=seeded.app.store.blob(PNG,asset.mime);assert.equal(stored,asset.sha256);
  const input=mobileInput(b,source,asset);
  seeded.app.close();
  const native=new IntegrationsNativeApplication(seeded.root);
  try{
    const expected=native.store.version(),epoch=native.store.meta().epoch;
    const args=makeRequest('mobile.import',input,expected,epoch,'native-mobile-import');
    const imported=await dispatchApplication(native,'invoke',nativeDriverName('mobile.import'),
      {ref:'synthetic-reference-already-bound-by-host',...args},applicationContext(args.request.key,expected));
    assert.equal(imported.entity.data.rights_state,'UNKNOWN');
    assert.equal(imported.entity.data.native_capture,false);
    const inspected=await dispatchApplication(native,'invoke',nativeDriverName('mobile.inspect'),
      {ref:'synthetic-reference-already-bound-by-host',input:{id:imported.entity.id}},
      applicationContext('native-mobile-read',native.store.version()));
    assert.equal(inspected.package_state,'PENDING_RIGHTS');
    assert.equal(inspected.technical_state,'UNKNOWN');
  }finally{native.close();}
});

test('mobile import rejects missing build context instead of manufacturing UNKNOWN evidence',async t=>{
  const {app}=setup(t),b=await baseline(app),source=await createMobileSource(b),asset=screenshotRecord();
  app.store.blob(PNG,asset.mime);
  await assert.rejects(execute(app,'mobile.import',mobileInput(b,source,asset,{build:'wrong-build'})),{code:'Conflict'});
});
