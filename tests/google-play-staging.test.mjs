// SPDX-License-Identifier: AGPL-3.0-only
// R52 actual owned R44 Native/PNG package -> Google Play Edit HTTP protocol.
// No real store account, production edit, APK or publication is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,chmodSync,
  readdirSync,existsSync,statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeOwnedStoreFixture } from './store-fixture.mjs';
import { planStorePackage, exportStorePackage } from '../src/store-package.mjs';
import { prepareGooglePlayStaging, verifyGooglePlayStaging,
  inspectGooglePlayStaging, sendGooglePlayStaging,
  checkGooglePlayImages } from '../src/google-play-staging.mjs';
import { createGooglePlayTransport, GOOGLE_PLAY_OFFICIAL_ORIGIN }
  from '../src/google-play-http.mjs';

const SHA=bytes=>createHash('sha256').update(bytes).digest('hex');
const codeRoot=fileURLToPath(new URL('../',import.meta.url));
const TYPES=['phoneScreenshots','icon','featureGraphic'];
const PACKAGE='com.owned.exampleapp',EDIT='owned_edit_2026_01';
async function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'launchwright-r52-owned-'));
  const fx=await makeOwnedStoreFixture(root,{platform:'google-play-phone-portrait',
    screenshotCount:2});
  const dir=join(root,'private');mkdirSync(dir,{mode:0o700});
  if(process.platform!=='win32')chmodSync(dir,0o700);
  t.after(()=>{try{fx.close();}catch{}rmSync(root,{
    recursive:true,force:true,maxRetries:5,retryDelay:50});});
  const plan=planStorePackage(fx.app,fx.input);
  const exported=await exportStorePackage(fx.app,plan,fx.input,dir,{
    confirm_plan_sha256:plan.plan_sha256,
    confirm_candidate_sha256:plan.candidate_sha256,
    acknowledge_private_export:true
  });
  const zip=join(dir,exported.filename);
  const intent=await prepareGooglePlayStaging(fx.app,plan,fx.input,zip,{
    package_name:PACKAGE,edit_id:EDIT,acknowledge_uncommitted_only:true
  });
  const confirm={
    confirm_intent_sha256:intent.intent_sha256,
    confirm_store_plan_sha256:plan.plan_sha256,
    confirm_package_name:PACKAGE,confirm_edit_id:EDIT,
    acknowledge_first_upload:true
  };
  return{...fx,root,dir,plan,zip,intent,confirm};
}
class FakeGoogle {
  constructor(){
    this.expiry=String(Math.floor(Date.now()/1000)+3600);
    this.lists=Object.fromEntries(TYPES.map(v=>[v,[]]));
    this.calls=[];this.failAfterNextUpload=false;
  }
  async getEdit(packageName,editId){
    this.calls.push(['read-edit',packageName,editId]);
    return{id:editId,expiryTimeSeconds:this.expiry};
  }
  async listImages(packageName,editId,locale,type){
    this.calls.push(['read-images',type,locale]);
    assert.equal(packageName,PACKAGE);assert.equal(editId,EDIT);
    assert.equal(locale,'en-US');
    return structuredClone(this.lists[type]);
  }
  async uploadImage(packageName,editId,locale,type,body){
    this.calls.push(['upload',type,body.length]);
    assert.equal(packageName,PACKAGE);assert.equal(editId,EDIT);
    assert.equal(locale,'en-US');assert.ok(TYPES.includes(type));
    const image={id:'img_'+this.calls.filter(x=>x[0]==='upload').length,
      sha256:SHA(body)};
    this.lists[type].push(image);
    if(this.failAfterNextUpload){
      this.failAfterNextUpload=false;
      throw Error('Simulated lost HTTP acknowledgement AFTER remote upload');
    }
    return image;
  }
}
test('R52 R44 candidate -> immutable source manifest and existing Google Edit, no plan effects',async t=>{
  const f=await fixture(t);
  assert.equal(f.intent.schema_version,'launchwright-google-play-images-intent/1');
  assert.equal(f.intent.assets.length,4);
  assert.deepEqual(f.intent.assets.map(x=>x.type),[
    'phoneScreenshots','phoneScreenshots','icon','featureGraphic']);
  assert.equal(f.intent.source_zip_sha256,SHA(readFileSync(f.zip)));
  assert.equal(f.intent.platform_authority,false);
  assert.equal(f.intent.commits_edit,false);
  assert.equal(f.intent.creates_edit,false);
  assert.equal(f.intent.deletes_existing_images,false);
  assert.equal(f.intent.published,false);
  assert.equal(f.intent.technical_state,'UNKNOWN');
  assert.ok(!JSON.stringify(f.intent).includes(f.root));
  assert.ok(!JSON.stringify(f.intent).includes('store-icon.png'));
  assert.deepEqual(await verifyGooglePlayStaging(f.app,f.plan,f.input,f.zip,f.intent),f.intent);
  assert.equal(f.app.list('channel_delivery').length,0);
});
test('R52 sends exactly four verified PNG media uploads into an already existing, empty, UNCOMMITTED Edit',async t=>{
  const f=await fixture(t),remote=new FakeGoogle();
  const staged=await sendGooglePlayStaging(f.app,f.plan,f.input,f.zip,
    f.intent,remote,f.confirm);
  assert.equal(staged.state,'STAGED_IN_UNCOMMITTED_EDIT');
  assert.equal(staged.observed_images,4);
  assert.equal(staged.expected_images,4);
  assert.equal(staged.uploads_performed,4);
  assert.equal(staged.published,false);
  assert.equal(staged.edit_committed,false);
  assert.equal(staged.platform_authority,false);
  assert.equal(staged.human_store_review_pending,true);
  assert.deepEqual(remote.calls.filter(x=>x[0]==='upload').map(x=>x[1]),
    ['phoneScreenshots','phoneScreenshots','icon','featureGraphic']);
  const check=await inspectGooglePlayStaging(f.intent,remote);
  assert.equal(check.state,'STAGED_IN_UNCOMMITTED_EDIT');
  assert.equal(check.network_write_performed,false);
  assert.equal(check.can_stage_first_time,false);
  assert.equal(f.app.list('channel_delivery').length,0,
    'A temporary external edit is not a canonical publication receipt');
});
test('R52 recover-only never uploads, and re-sending any nonempty Edit fails closed',async t=>{
  const f=await fixture(t),remote=new FakeGoogle();
  const none=await sendGooglePlayStaging(f.app,f.plan,f.input,f.zip,
    f.intent,remote,{...f.confirm,recover_only:true,acknowledge_first_upload:false});
  assert.equal(none.state,'NO_IMAGES_IN_EDIT');
  assert.equal(none.uploads_performed,0);
  assert.equal(remote.calls.filter(x=>x[0]==='upload').length,0);
  await sendGooglePlayStaging(f.app,f.plan,f.input,f.zip,f.intent,remote,f.confirm);
  const before=remote.calls.filter(x=>x[0]==='upload').length;
  const result=await sendGooglePlayStaging(f.app,f.plan,f.input,f.zip,
    f.intent,remote,{...f.confirm,recover_only:true,acknowledge_first_upload:false});
  assert.equal(result.state,'STAGED_IN_UNCOMMITTED_EDIT');
  assert.equal(result.uploads_performed,0);
  await assert.rejects(sendGooglePlayStaging(f.app,f.plan,f.input,f.zip,
    f.intent,remote,f.confirm),{code:'Conflict'});
  assert.equal(remote.calls.filter(x=>x[0]==='upload').length,before);
});
test('R52 lost ACK after first image refuses automatic upload retries and shows exact partial recovery',async t=>{
  const f=await fixture(t),remote=new FakeGoogle();
  remote.failAfterNextUpload=true;
  let error=null;
  try{await sendGooglePlayStaging(f.app,f.plan,f.input,f.zip,
    f.intent,remote,f.confirm);}catch(e){error=e;}
  assert.ok(error);
  assert.equal(error.code,'Unavailable');
  assert.equal(error.outcomeKnown,false);
  assert.equal(remote.calls.filter(x=>x[0]==='upload').length,1);
  const observed=await sendGooglePlayStaging(f.app,f.plan,f.input,f.zip,
    f.intent,remote,{...f.confirm,recover_only:true,acknowledge_first_upload:false});
  assert.equal(observed.state,'PARTIAL_UNCOMMITTED_EDIT');
  assert.equal(observed.observed_images,1);
  assert.equal(observed.uploads_performed,0);
  await assert.rejects(sendGooglePlayStaging(f.app,f.plan,f.input,f.zip,
    f.intent,remote,f.confirm),{code:'Conflict'});
  assert.equal(remote.calls.filter(x=>x[0]==='upload').length,1);
});
test('R52 rejects foreign/duplicate images but does not invent a Google Play image-order guarantee',async t=>{
  const f=await fixture(t),remote=new FakeGoogle();
  remote.lists.phoneScreenshots=[{id:'foreign_png',sha256:'c'.repeat(64)}];
  await assert.rejects(sendGooglePlayStaging(f.app,f.plan,f.input,f.zip,
    f.intent,remote,f.confirm),{code:'Conflict'});
  assert.equal(remote.calls.filter(x=>x[0]==='upload').length,0);
  assert.throws(()=>checkGooglePlayImages(f.intent,'phoneScreenshots',[
    {id:'repeat',sha256:f.intent.assets[0].sha256},
    {id:'repeat',sha256:f.intent.assets[1].sha256}
  ]),{code:'ProtocolMismatch'});
  const unordered=checkGooglePlayImages(f.intent,'phoneScreenshots',[
    {id:'one',sha256:f.intent.assets[1].sha256},
    {id:'two',sha256:f.intent.assets[0].sha256}
  ]);
  assert.equal(unordered.observed,2);
  assert.equal(unordered.image_order_independently_verified,false);
  assert.throws(()=>checkGooglePlayImages(f.intent,'icon',[{id:'icon',sha256:'not-sha'}]),
    {code:'ProtocolMismatch'});
});
test('R52 altered immutable intent, forged Edit/APP identifiers and missing acknowledgements cause no network writes',async t=>{
  const f=await fixture(t),remote=new FakeGoogle();
  await assert.rejects(sendGooglePlayStaging(f.app,f.plan,f.input,f.zip,
    {...f.intent,locale:'fr-FR'},remote,f.confirm),{code:'Conflict'});
  await assert.rejects(sendGooglePlayStaging(f.app,f.plan,f.input,f.zip,
    f.intent,remote,{...f.confirm,confirm_edit_id:'other_edit'}),{code:'ConsentRequired'});
  await assert.rejects(sendGooglePlayStaging(f.app,f.plan,f.input,f.zip,
    f.intent,remote,{...f.confirm,acknowledge_first_upload:false}),{code:'ConsentRequired'});
  await assert.rejects(sendGooglePlayStaging(f.app,f.plan,f.input,f.zip,
    f.intent,remote,{...f.confirm,confirm_package_name:'com.fake.app'}),{code:'ConsentRequired'});
  assert.deepEqual(remote.calls.filter(x=>x[0]==='upload'),[]);
  await assert.rejects(prepareGooglePlayStaging(f.app,f.plan,f.input,f.zip,{
    package_name:'com.fake/app',edit_id:EDIT,acknowledge_uncommitted_only:true
  }),{code:'InvalidArgument'});
});
test('R52 expired/moved Google Play Edit blocks uploads and requires operator action',async t=>{
  const f=await fixture(t),remote=new FakeGoogle();
  remote.expiry=String(Math.floor(Date.now()/1000)-3);
  await assert.rejects(sendGooglePlayStaging(f.app,f.plan,f.input,f.zip,
    f.intent,remote,f.confirm),{code:'StaleReference'});
  remote.expiry=String(Math.floor(Date.now()/1000)+50);
  await assert.rejects(sendGooglePlayStaging(f.app,f.plan,f.input,f.zip,
    f.intent,remote,f.confirm),{code:'Conflict'});
  assert.equal(remote.calls.filter(x=>x[0]==='upload').length,0);
});
test('R52 exact private R44 ZIP or Native candidate drift is rejected before any remote side effects',async t=>{
  const f=await fixture(t),remote=new FakeGoogle();
  const original=readFileSync(f.zip);
  writeFileSync(f.zip,Buffer.from('replaced ZIP'));
  await assert.rejects(sendGooglePlayStaging(f.app,f.plan,f.input,f.zip,
    f.intent,remote,f.confirm));
  assert.deepEqual(remote.calls,[]);
  writeFileSync(f.zip,original);
  const src=f.input.screenshots[0].png.path;
  const png=readFileSync(src);png[png.length-1]^=1;writeFileSync(src,png);
  await assert.rejects(sendGooglePlayStaging(f.app,f.plan,f.input,f.zip,
    f.intent,remote,f.confirm));
  assert.deepEqual(remote.calls,[]);
});
test('R52 bounded HTTPS adapter uses only official Edit GET, images.list GET and uploadType=media POST with no commit',async t=>{
  const root=mkdtempSync(join(tmpdir(),'launchwright-r52-http-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const tokenFile=join(root,'token');
  const TOKEN='ya29.synthetic_token_for_owned_fixture_12345';
  writeFileSync(tokenFile,TOKEN+'\n',{mode:0o600});
  const calls=[],images=Object.fromEntries(TYPES.map(k=>[k,[]]));
  const server=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=Buffer.concat(chunks);
    calls.push({method:req.method,url:req.url,auth:req.headers.authorization,
      type:req.headers['content-type'],bytes:body.length});
    assert.equal(req.headers.authorization,'Bearer '+TOKEN);
    res.setHeader('Content-Type','application/json');
    const route=new URL(req.url,'http://127.0.0.1');
    if(req.method==='GET'&&route.pathname.endsWith('/edits/'+EDIT))
      return res.end(JSON.stringify({id:EDIT,expiryTimeSeconds:String(Math.floor(Date.now()/1000)+3600)}));
    for(const type of TYPES){
      if(route.pathname.endsWith('/listings/en-US/'+type)){
        if(req.method==='GET')return res.end(JSON.stringify({images:images[type]}));
        if(req.method==='POST'){
          assert.equal(route.searchParams.get('uploadType'),'media');
          assert.equal(req.headers['content-type'],'image/png');
          assert.equal(body.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
          const image={id:'remote_'+(images[type].length+1)+'_'+type,
            sha256:SHA(body)};
          images[type].push(image);return res.end(JSON.stringify({image}));
        }
      }
    }
    res.statusCode=404;return res.end('{}');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const target='http://127.0.0.1:'+server.address().port;
  const fakeFetch=(url,init)=>{
    assert.ok(url.startsWith(GOOGLE_PLAY_OFFICIAL_ORIGIN+'/'));
    assert.equal(init.redirect,'error');
    return fetch(target+new URL(url).pathname+new URL(url).search,init);
  };
  const transport=createGooglePlayTransport({accessTokenFile:tokenFile,fetchImpl:fakeFetch});
  const f=await fixture(t);
  const receipt=await sendGooglePlayStaging(f.app,f.plan,f.input,f.zip,
    f.intent,transport,f.confirm);
  assert.equal(receipt.state,'STAGED_IN_UNCOMMITTED_EDIT');
  assert.equal(receipt.uploads_performed,4);
  assert.equal(calls.filter(x=>x.method==='POST').length,4);
  assert.ok(calls.every(x=>x.method==='GET'||x.method==='POST'));
  assert.ok(!calls.some(x=>/commit|insert|delete|tracks|apks/iu.test(x.url)));
  assert.ok(calls.filter(x=>x.method==='POST').every(x=>
    x.url.startsWith('/upload/androidpublisher/v3/')));
  assert.ok(!JSON.stringify(receipt).includes(TOKEN));
  if(process.platform!=='win32'){
    chmodSync(tokenFile,0o644);
    assert.throws(()=>createGooglePlayTransport({accessTokenFile:tokenFile}),{
      code:'PermissionDenied'
    });
  }
});


test('R52 exclusive local upload lock rejects a second writer; read-only recovery is still permitted',async t=>{
  const f=await fixture(t),remote=new FakeGoogle();
  const lock=join(f.app.store.root,'.google-play-staging.lock');
  writeFileSync(lock,'another process owns this Edit',{mode:0o600});
  await assert.rejects(sendGooglePlayStaging(f.app,f.plan,f.input,f.zip,
    f.intent,remote,f.confirm),{code:'Conflict'});
  assert.equal(remote.calls.length,0);
  assert.equal(readFileSync(lock,'utf8'),'another process owns this Edit');
  const recovery=await sendGooglePlayStaging(f.app,f.plan,f.input,f.zip,
    f.intent,remote,{...f.confirm,recover_only:true,acknowledge_first_upload:false});
  assert.equal(recovery.state,'NO_IMAGES_IN_EDIT');
  assert.equal(recovery.uploads_performed,0);
  assert.equal(remote.calls.filter(x=>x[0]==='upload').length,0);
});

test('R52 private operator CLI creates one immutable source/edit intent; no bearer or API calls required',async t=>{
  const f=await fixture(t);
  const inputFile=join(f.dir,'store-input.json');
  const storePlanFile=join(f.dir,'store-plan.json');
  const saved=join(f.dir,'play-staging-intent.json');
  writeFileSync(inputFile,JSON.stringify(f.input),{mode:0o600});
  writeFileSync(storePlanFile,JSON.stringify(f.plan),{mode:0o600});
  const call=args=>spawnSync(process.execPath,['scripts/google-play-staging.mjs',...args],
    {cwd:codeRoot,encoding:'utf8',timeout:30000});
  const args=['plan','--state',f.app.store.root,
    '--source-input',inputFile,'--store-plan',storePlanFile,'--store-zip',f.zip,
    '--package-name',PACKAGE,'--edit-id',EDIT,'--out',saved,
    '--acknowledge-uncommitted'];
  const first=call(args);
  assert.equal(first.status,0,first.stdout+first.stderr);
  const result=JSON.parse(first.stdout);
  assert.equal(result.remote_mutations_performed,false);
  assert.equal(result.published,false);
  assert.equal(result.saved_private_intent,saved);
  const plan=JSON.parse(readFileSync(saved,'utf8'));
  assert.equal(plan.intent_sha256,f.intent.intent_sha256);
  if(process.platform!=='win32')assert.equal(statSync(saved).mode&0o077,0);
  const duplicate=call(args);
  assert.notEqual(duplicate.status,0,'A saved operator intent must never be overwritten');
  assert.ok(existsSync(saved));
  if(process.platform!=='win32'){
    chmodSync(inputFile,0o644);
    const exposedArgs=[...args];
    exposedArgs[exposedArgs.indexOf('--out')+1]=join(f.dir,'unsafe-plan.json');
    const exposed=call(exposedArgs);
    assert.match(exposed.stdout,/private regular JSON/u);
    assert.notEqual(exposed.status,0,'World-readable R44 source must fail before creating private intent');
    assert.ok(!existsSync(join(f.dir,'unsafe-plan.json')));
    chmodSync(inputFile,0o600);
  }
  const readOnly=call(['recover','--state',f.app.store.root,
    '--source-input',inputFile,'--store-plan',storePlanFile,'--store-zip',f.zip,
    '--intent',saved,'--token-file',join(f.dir,'nonexistent-token'),
    '--confirm-intent',plan.intent_sha256,
    '--confirm-store-plan',f.plan.plan_sha256,
    '--confirm-package',PACKAGE,'--confirm-edit',EDIT,
    '--out',join(f.dir,'unwritten-receipt.json')]);
  assert.notEqual(readOnly.status,0,'A missing operator token must not start a remote request');
  assert.ok(!existsSync(join(f.dir,'unwritten-receipt.json')));
});
