// SPDX-License-Identifier: AGPL-3.0-only
// R51: real owned R44 PNG/Native SDK input + deterministic App Store Connect
// API test doubles. NO live store credentials, uploads or app submissions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync,mkdirSync,readFileSync,writeFileSync,
  chmodSync,symlinkSync,rmSync,readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeOwnedStoreFixture } from './store-fixture.mjs';
import { planStorePackage,exportStorePackage } from '../src/store-package.mjs';
import { prepareAppleScreenshotUpload,verifyAppleScreenshotUpload,
  sendAppleScreenshotUpload } from '../src/apple-screenshot-upload.mjs';
import { readAppleJwtFile,createAppleScreenshotTransport }
  from '../src/apple-screenshot-http.mjs';

const cwd=fileURLToPath(new URL('../',import.meta.url));
const SET='set_owned_123456',LOC='localization_owned_123456';
const sha=v=>createHash('sha256').update(v).digest('hex');
const md5=v=>createHash('md5').update(v).digest('hex');
async function fixture(t,{count=1}={}){
  const root=mkdtempSync(join(tmpdir(),'launchwright-r51-owned-'));
  const owned=await makeOwnedStoreFixture(root,{
    platform:'apple-iphone-dynamic-island-medium',screenshotCount:count
  });
  const out=join(root,'storezip');
  mkdirSync(out,{mode:0o700});
  if(process.platform!=='win32')chmodSync(out,0o700);
  t.after(()=>{
    try{owned.close();}catch{}
    rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});
  });
  const localPlan=planStorePackage(owned.app,owned.input);
  const packaged=await exportStorePackage(owned.app,localPlan,owned.input,out,{
    confirm_plan_sha256:localPlan.plan_sha256,
    confirm_candidate_sha256:localPlan.candidate_sha256,
    acknowledge_private_export:true
  });
  const zipPath=join(out,packaged.filename);
  const prepare=()=>prepareAppleScreenshotUpload(
    owned.app,localPlan,owned.input,zipPath,{
      screenshot_set_id:SET,localization_id:LOC,
      screenshot_display_type:'APP_IPHONE_61',acknowledge_asset_only:true
    });
  const confirmed=intent=>({
    confirm_intent_sha256:intent.intent_sha256,
    confirm_candidate_sha256:intent.candidate_sha256,
    confirm_screenshot_set_id:intent.screenshot_set_id,
    acknowledge_first_remote_write:true
  });
  return{...owned,root,out,localPlan,packaged,zipPath,prepare,confirmed};
}
class FakeApple{
  constructor(intent){
    this.intent=intent;this.created=[];this.calls=[];
    this.failReserveAfterCreate=false;this.failUploadAfterWrite=false;
    this.failCommitAfterWrite=false;this.incorrectLocale=false;
    this.incorrectSet=false;
  }
  async getScreenshotSet(id){
    this.calls.push('getSet');
    return{data:{type:'appScreenshotSets',id,
      attributes:{screenshotDisplayType:this.incorrectSet?'APP_IPHONE_67':'APP_IPHONE_61'},
      relationships:{appStoreVersionLocalization:{
        data:{type:'appStoreVersionLocalizations',id:LOC}
      }}
    }};
  }
  async getLocalization(id){
    this.calls.push('getLocalization');
    return{data:{type:'appStoreVersionLocalizations',id,
      attributes:{locale:this.incorrectLocale?'fr-FR':'en-US'}}};
  }
  async listScreenshots(){
    this.calls.push('list');
    return{data:this.created.map(item=>({
      id:item.id,type:'appScreenshots',
      attributes:{
        fileName:item.file_name,fileSize:item.file_size,
        sourceFileChecksum:item.md5??null,
        assetDeliveryState:{state:item.state,errors:[]}
      }
    })),links:{next:null}};
  }
  async createScreenshot(input){
    this.calls.push('reserve');
    const entity={
      id:'screenshot_owned_'+String(this.created.length+1).padStart(3,'0'),
      file_name:input.file_name,file_size:input.file_size,
      state:'AWAITING_UPLOAD',parts:[],md5:null
    };
    this.created.push(entity);
    if(this.failReserveAfterCreate)throw Error('Simulated reservation ACK loss');
    const half=Math.floor(input.file_size/2);
    return{data:{type:'appScreenshots',id:entity.id,
      attributes:{
        fileName:input.file_name,fileSize:input.file_size,
        assetDeliveryState:{state:'AWAITING_UPLOAD',errors:[]},
        uploadOperations:[
          {method:'PUT',url:'https://store-030.blobstore.apple.com/private?token=owned-fixture',
            offset:0,length:half,requestHeaders:[
              {name:'Content-Type',value:'image/png'}
            ]},
          {method:'PUT',url:'https://store-030.blobstore.apple.com/private?token=owned-fixture',
            offset:half,length:input.file_size-half,
            requestHeaders:[{name:'Content-Type',value:'image/png'}]}
        ]
      }
    }};
  }
  async uploadPart(op,body){
    this.calls.push('put');
    const current=this.created.at(-1);
    assert.equal(op.length,body.length);
    current.parts.push(Buffer.from(body));
    if(this.failUploadAfterWrite)throw Error('Simulated unknown upload ACK');
  }
  async commitScreenshot(id,checksum){
    this.calls.push('commitAsset');
    const image=this.created.find(x=>x.id===id);
    assert.ok(image);
    const binary=Buffer.concat(image.parts);
    assert.equal(binary.length,image.file_size);
    assert.equal(md5(binary),checksum);
    image.md5=checksum;
    image.state='UPLOAD_COMPLETE';
    if(this.failCommitAfterWrite)throw Error('Simulated PATCH ACK loss');
    return{data:{type:'appScreenshots',id,
      attributes:{assetDeliveryState:{state:'UPLOAD_COMPLETE',errors:[]}}}};
  }
}
test('R51 no-effect Apple plan pins R44 Native approval, exact PNG ZIP, locale and target screenshot set',async t=>{
  const f=await fixture(t),intent=await f.prepare();
  assert.deepEqual(intent,await f.prepare());
  assert.deepEqual(await verifyAppleScreenshotUpload(
    f.app,f.localPlan,f.input,f.zipPath,intent),intent);
  assert.equal(intent.platform,'app-store-connect');
  assert.equal(intent.candidate_sha256,f.localPlan.candidate_sha256);
  assert.equal(intent.store_plan_sha256,f.localPlan.plan_sha256);
  assert.equal(intent.screenshot_count,1);
  assert.equal(intent.images[0].bytes>100,true);
  assert.equal(intent.images[0].sha256,f.localPlan.screenshots[0].normalized_sha256);
  assert.equal(intent.source_zip_sha256,sha(readFileSync(f.zipPath)));
  assert.ok(!JSON.stringify(intent).includes(f.root));
  assert.equal(intent.independent_privacy_review,false);
  assert.equal(intent.app_published,false);
  assert.equal(intent.technical_state,'UNKNOWN');
});
test('R51 operator-approved asset reservation, signed-part upload and Apple PATCH commit never submit app',async t=>{
  const f=await fixture(t),intent=await f.prepare();
  const remote=new FakeApple(intent);
  const output=await sendAppleScreenshotUpload(f.app,f.localPlan,f.input,
    f.zipPath,intent,remote,f.confirmed(intent));
  assert.equal(output.state,'PROCESSING_PENDING');
  assert.equal(output.screenshots_reserved_and_uploaded,1);
  assert.equal(output.app_published,false);
  assert.equal(output.remote_app_review_submission_performed,false);
  assert.equal(output.asset_submission_to_processing_performed,true);
  assert.deepEqual(remote.calls.filter(c=>!['list','getSet','getLocalization'].includes(c)),
    ['reserve','put','put','commitAsset']);
  const received=remote.created[0];
  assert.equal(received.md5,intent.images[0].md5);
  assert.equal(received.file_name,intent.images[0].file_name);
  assert.equal(received.state,'UPLOAD_COMPLETE');
  assert.equal(Buffer.concat(received.parts).length,intent.images[0].bytes);
  const recovery=await sendAppleScreenshotUpload(f.app,f.localPlan,f.input,
    f.zipPath,intent,remote,{...f.confirmed(intent),recover_only:true});
  assert.equal(recovery.state,'PROCESSING_PENDING');
  assert.equal(recovery.remote_mutation_performed,false);
  assert.equal(recovery.upload_committed_screenshots,1);
  remote.created[0].state='COMPLETE';
  const final=await sendAppleScreenshotUpload(f.app,f.localPlan,f.input,
    f.zipPath,intent,remote,{...f.confirmed(intent),recover_only:true});
  assert.equal(final.state,'SCREENSHOTS_PROCESSED');
  assert.equal(final.app_published,false);
  assert.equal(remote.calls.filter(x=>x==='reserve').length,1);
});
test('R51 read-only recovery after unknown reservation ACK sees pending image but does not reserve twice',async t=>{
  const f=await fixture(t),intent=await f.prepare();
  const remote=new FakeApple(intent);remote.failReserveAfterCreate=true;
  await assert.rejects(sendAppleScreenshotUpload(f.app,f.localPlan,f.input,
    f.zipPath,intent,remote,f.confirmed(intent)),{code:'Unavailable'});
  assert.equal(remote.created.length,1);
  const old=remote.calls.length;
  const result=await sendAppleScreenshotUpload(f.app,f.localPlan,f.input,
    f.zipPath,intent,remote,{...f.confirmed(intent),recover_only:true});
  assert.equal(result.state,'UNKNOWN_RESERVED_ASSET_REQUIRES_OPERATOR_REVIEW');
  assert.equal(result.remote_mutation_performed,false);
  assert.equal(remote.calls.slice(old).includes('reserve'),false);
  assert.equal(remote.created.length,1);
});
test('R51 unknown signed part or PATCH acknowledgement never causes blind duplicate upload',async t=>{
  for(const fail of ['failUploadAfterWrite','failCommitAfterWrite']){
    const f=await fixture(t),intent=await f.prepare();
    const remote=new FakeApple(intent);
    remote[fail]=true;
    await assert.rejects(sendAppleScreenshotUpload(f.app,f.localPlan,f.input,
      f.zipPath,intent,remote,f.confirmed(intent)),{code:'Unavailable'});
    const before=remote.calls.filter(c=>c==='reserve').length;
    const restored=await sendAppleScreenshotUpload(f.app,f.localPlan,f.input,
      f.zipPath,intent,remote,{...f.confirmed(intent),recover_only:true});
    assert.equal(remote.calls.filter(c=>c==='reserve').length,before);
    assert.equal(restored.remote_mutation_performed,false);
    assert.ok(['UNKNOWN_RESERVED_ASSET_REQUIRES_OPERATOR_REVIEW','PROCESSING_PENDING'].includes(
      restored.state));
  }
});
test('R51 wrong intent, candidate, screenshot set and independently denied consent block all remote requests',async t=>{
  const f=await fixture(t),intent=await f.prepare();
  const remote=new FakeApple(intent);
  for(const changes of [
    {confirm_intent_sha256:'a'.repeat(64)},
    {confirm_candidate_sha256:'b'.repeat(64)},
    {confirm_screenshot_set_id:'another_set'},
  ]){
    await assert.rejects(sendAppleScreenshotUpload(f.app,f.localPlan,f.input,
      f.zipPath,intent,remote,{...f.confirmed(intent),...changes}),{code:'ConsentRequired'});
  }
  assert.deepEqual(remote.calls,[]);
  await assert.rejects(sendAppleScreenshotUpload(f.app,f.localPlan,f.input,
    f.zipPath,{...intent,locale:'de-DE'},remote,f.confirmed(intent)),{code:'Conflict'});
  assert.deepEqual(remote.calls,[]);
  await assert.rejects(sendAppleScreenshotUpload(f.app,f.localPlan,f.input,
    f.zipPath,intent,remote,{...f.confirmed(intent),acknowledge_first_remote_write:false}),
    {code:'ConsentRequired'});
  assert.ok(remote.calls.includes('getSet'),'Read-only preflight is permitted');
  assert.ok(!remote.calls.includes('reserve'));
});
test('R51 wrong remote locale/device, foreign screenshot, duplicate item or mismatched checksum fail closed',async t=>{
  const f=await fixture(t),intent=await f.prepare();
  for(const mutation of [
    r=>{r.incorrectLocale=true;},
    r=>{r.incorrectSet=true;},
    r=>{r.created.push({id:'foreign_screenshot',file_name:'another-image.png',
      file_size:123,state:'COMPLETE',md5:'a'.repeat(32)});},
    r=>{r.created.push({id:'own_collision',file_name:intent.images[0].file_name,
      file_size:intent.images[0].bytes,state:'COMPLETE',md5:'f'.repeat(32)});}
  ]){
    const remote=new FakeApple(intent);mutation(remote);
    await assert.rejects(sendAppleScreenshotUpload(f.app,f.localPlan,f.input,
      f.zipPath,intent,remote,f.confirmed(intent)),{code:'Conflict'});
    assert.ok(!remote.calls.includes('reserve'));
  }
});
test('R51 remote processing failure is never labeled accepted',async t=>{
  const f=await fixture(t),intent=await f.prepare();
  const remote=new FakeApple(intent);
  remote.created.push({id:'failed_capture',file_name:intent.images[0].file_name,
    file_size:intent.images[0].bytes,state:'FAILED',md5:intent.images[0].md5});
  await assert.rejects(sendAppleScreenshotUpload(f.app,f.localPlan,f.input,
    f.zipPath,intent,remote,{...f.confirmed(intent),recover_only:true}),
    {code:'Conflict'});
});
test('R51 R44 screenshot source mutation and unrelated Google Play plan cannot be substituted',async t=>{
  const f=await fixture(t),intent=await f.prepare();
  writeFileSync(f.zipPath,Buffer.from('edited private package'));
  await assert.rejects(verifyAppleScreenshotUpload(
    f.app,f.localPlan,f.input,f.zipPath,intent));
  const remote=new FakeApple(intent);
  await assert.rejects(sendAppleScreenshotUpload(
    f.app,f.localPlan,f.input,f.zipPath,intent,remote,f.confirmed(intent)));
  assert.deepEqual(remote.calls,[]);
});
test('R51 operator private Apple JWT file is local-only and rejects public/symlink/invalid token inputs',async t=>{
  const f=await fixture(t);
  const path=join(f.root,'apple.token');
  const secret=['a'.repeat(48),'b'.repeat(48),'c'.repeat(48)].join('.');
  writeFileSync(path,secret,{mode:0o600});
  assert.equal(readAppleJwtFile(path),secret);
  if(process.platform!=='win32'){
    chmodSync(path,0o644);
    assert.throws(()=>readAppleJwtFile(path),{code:'PermissionDenied'});
    chmodSync(path,0o600);
    const link=join(f.root,'link.token');
    symlinkSync(path,link);
    assert.throws(()=>readAppleJwtFile(link),{code:'PermissionDenied'});
  }
  writeFileSync(path,'not-a-valid-compact-jwt'.repeat(4));
  assert.throws(()=>readAppleJwtFile(path),{code:'InvalidArgument'});
});
test('R51 Apple HTTP transport uses ONLY fixed API GET/POST/PATCH and Apple blobstore PUT without bearer',async t=>{
  const f=await fixture(t),intent=await f.prepare();
  const tokenPath=join(f.root,'apple.token');
  const secret=['a'.repeat(48),'b'.repeat(48),'c'.repeat(48)].join('.');
  writeFileSync(tokenPath,secret,{mode:0o600});
  const calls=[];
  const mock=async(url,opts)=>{
    calls.push({url:String(url),method:opts.method,authorization:opts.headers?.Authorization,
      redirect:opts.redirect,body:opts.body});
    if(String(url).includes('/appScreenshotSets/')){
      return new Response(JSON.stringify({data:{type:'appScreenshotSets',id:SET}}),{
        status:200,headers:{'Content-Type':'application/json'}
      });
    }
    if(opts.method==='PUT')return new Response('',{status:200});
    return new Response(JSON.stringify({data:{type:'appScreenshots',id:'screen_id'}}),{
      status:200,headers:{'Content-Type':'application/json'}
    });
  };
  const provider=createAppleScreenshotTransport({token_file:tokenPath,fetchImpl:mock});
  await provider.getScreenshotSet(SET);
  await provider.getLocalization(LOC);
  await provider.listScreenshots(SET);
  await provider.createScreenshot({
    screenshot_set_id:SET,file_name:intent.images[0].file_name,file_size:intent.images[0].bytes
  });
  await provider.uploadPart({
    method:'PUT',url:'https://store-030.blobstore.apple.com/private?token=mock-only',
    requestHeaders:[{name:'Content-Type',value:'image/png'}]
  },Buffer.from('owned synthetic PNG part'));
  await provider.commitScreenshot('screenshot_owned_123','a'.repeat(32));
  assert.deepEqual(calls.map(x=>x.method),['GET','GET','GET','POST','PUT','PATCH']);
  assert.ok(calls.every(x=>x.redirect==='error'));
  assert.ok(calls.filter(x=>x.method!=='PUT').every(x=>
    x.url.startsWith('https://api.appstoreconnect.apple.com/v1/')&&
    x.authorization==='Bearer '+secret));
  assert.ok(calls.filter(x=>x.method==='PUT').every(x=>
    x.url.startsWith('https://store-030.blobstore.apple.com/')&&
    x.authorization===undefined),'Signed URLs must never receive Apple JWT');
  assert.ok(!calls.some(x=>x.url.includes('/appStoreVersions/')&&x.method!=='GET'));
});
test('R51 SSRF/signature URL spoofing and unsafe headers are denied before signed PUT',async t=>{
  const f=await fixture(t);
  const tokenPath=join(f.root,'apple.token');
  writeFileSync(tokenPath,['a'.repeat(48),'b'.repeat(48),'c'.repeat(48)].join('.'),
    {mode:0o600});
  let calls=0;
  const remote=createAppleScreenshotTransport({token_file:tokenPath,
    fetchImpl:async()=>{calls++;return new Response('',{status:200});}});
  for(const url of [
    'http://store-030.blobstore.apple.com/asset',
    'https://169.254.169.254/latest/meta-data/',
    'https://evil.apple.com/upload',
    'https://store-030.blobstore.apple.com.evil.example/',
    'https://user:pass@store-030.blobstore.apple.com/',
    'https://store-030.blobstore.apple.com/#fragment'
  ])await assert.rejects(remote.uploadPart({method:'PUT',url,
    requestHeaders:[]},Buffer.from('abc')),{code:'PolicyDenied'});
  await assert.rejects(remote.uploadPart({method:'POST',
    url:'https://store-030.blobstore.apple.com/asset',
    requestHeaders:[]},Buffer.from('abc')),{code:'PolicyDenied'});
  await assert.rejects(remote.uploadPart({method:'PUT',
    url:'https://store-030.blobstore.apple.com/asset',
    requestHeaders:[{name:'Authorization',value:'Bearer stolen'}]},
    Buffer.from('abc')),{code:'PolicyDenied'});
  assert.equal(calls,0,'No forged Apple signed URL reaches the network');
});


test('R51 an exact completed screenshot prefix is reused without re-reserving it',async t=>{
  const f=await fixture(t,{count:2}),intent=await f.prepare();
  const remote=new FakeApple(intent);
  remote.created.push({id:'screenshot_owned_001',
    file_name:intent.images[0].file_name,
    file_size:intent.images[0].bytes,
    state:'COMPLETE',md5:intent.images[0].md5});
  const result=await sendAppleScreenshotUpload(f.app,f.localPlan,f.input,
    f.zipPath,intent,remote,f.confirmed(intent));
  assert.equal(result.state,'PROCESSING_PENDING');
  assert.equal(remote.created.length,2);
  assert.deepEqual(remote.calls.filter(k=>k==='reserve'),['reserve']);
  assert.equal(remote.created[0].file_name,intent.images[0].file_name);
  assert.equal(remote.created[1].file_name,intent.images[1].file_name);
  assert.equal(result.app_published,false);
});

test('R51 overlapping or incomplete Apple signed byte ranges fail BEFORE any PUT/PATCH',async t=>{
  const f=await fixture(t),intent=await f.prepare();
  const remote=new FakeApple(intent);
  const original=remote.createScreenshot.bind(remote);
  remote.createScreenshot=async request=>{
    const response=await original(request);
    response.data.attributes.uploadOperations[1].offset=5;
    return response;
  };
  await assert.rejects(sendAppleScreenshotUpload(f.app,f.localPlan,f.input,
    f.zipPath,intent,remote,f.confirmed(intent)),{code:'Conflict'});
  assert.equal(remote.calls.filter(k=>k==='put'||k==='commitAsset').length,0);
  const recovered=await sendAppleScreenshotUpload(f.app,f.localPlan,f.input,
    f.zipPath,intent,remote,{...f.confirmed(intent),recover_only:true});
  assert.equal(recovered.state,'UNKNOWN_RESERVED_ASSET_REQUIRES_OPERATOR_REVIEW');
});

test('R51 private CLI plans without Apple network and fails wrong confirmation before any remote writes',async t=>{
  const f=await fixture(t);
  const privateInput=join(f.root,'private-R44-input.json');
  const privatePlan=join(f.root,'private-R44-plan.json');
  const appleIntent=join(f.root,'private-apple-intent.json');
  const tokenFile=join(f.root,'private-apple-jwt.txt');
  writeFileSync(privateInput,JSON.stringify(f.input),{mode:0o600});
  writeFileSync(privatePlan,JSON.stringify(f.localPlan),{mode:0o600});
  writeFileSync(tokenFile,['a'.repeat(48),'b'.repeat(48),'c'.repeat(48)].join('.'),
    {mode:0o600});
  const call=argv=>spawnSync(process.execPath,['scripts/apple-screenshot-upload.mjs',...argv],
    {cwd,encoding:'utf8',timeout:30000});
  const basics=['--state',f.app.store.root,'--store-input',privateInput,
    '--store-plan',privatePlan,'--store-zip',f.zipPath];
  const args=['plan',...basics,'--screenshot-set-id',SET,
    '--localization-id',LOC,'--out',appleIntent,'--acknowledge-asset-only'];
  const planned=call(args);
  assert.equal(planned.status,0,planned.stdout+planned.stderr);
  const intent=JSON.parse(readFileSync(appleIntent,'utf8'));
  assert.equal(intent.candidate_sha256,f.localPlan.candidate_sha256);
  assert.equal(JSON.parse(planned.stdout).remote_mutations_performed,false);
  assert.ok(!JSON.stringify(intent).includes(f.root));
  assert.notEqual(call(args).status,0,'Private apple intent cannot be overwritten');
  const bad=call(['send',...basics,'--intent',appleIntent,'--token-file',tokenFile,
    '--confirm-intent','f'.repeat(64),
    '--confirm-candidate',intent.candidate_sha256,
    '--confirm-set',SET,'--acknowledge-first-send']);
  assert.notEqual(bad.status,0);
  assert.equal(JSON.parse(bad.stdout).error.code,'ConsentRequired');
  assert.equal(JSON.parse(bad.stdout).error.outcome_known,true);
  assert.ok(!bad.stdout.includes(readFileSync(tokenFile,'utf8')));
});


test('R51 accepts only the official structured Apple AppMediaAssetState, never an invented string state',async t=>{
  const f=await fixture(t),intent=await f.prepare();
  for(const malformed of [
    'COMPLETE',{state:'COMPLETE',errors:[{code:'INVALID_IMAGE'}]},
    {state:'COMPLETE'}, {state:'SUCCEEDED',errors:[]}
  ]){
    const remote=new FakeApple(intent);
    remote.created.push({id:'screenshot_owned_previous',
      file_name:intent.images[0].file_name,file_size:intent.images[0].bytes,
      state:'COMPLETE',md5:intent.images[0].md5});
    const get=remote.listScreenshots.bind(remote);
    remote.listScreenshots=async()=>{
      const result=await get();
      result.data[0].attributes.assetDeliveryState=malformed;
      return result;
    };
    await assert.rejects(sendAppleScreenshotUpload(f.app,f.localPlan,f.input,
      f.zipPath,intent,remote,{...f.confirmed(intent),recover_only:true}),
      {code:'Conflict'});
    assert.ok(!remote.calls.includes('reserve'),'Bad Apple media state must never create a second reservation');
  }
});

test('R51 full screenshot protocol works over the actual bounded HTTP adapter with an in-memory Apple API fixture',async t=>{
  const f=await fixture(t),intent=await f.prepare();
  const origin='https://api.appstoreconnect.apple.com';
  const jwt=['a'.repeat(48),'b'.repeat(48),'c'.repeat(48)].join('.');
  const tokenPath=join(f.root,'api-jwt.txt');
  writeFileSync(tokenPath,jwt,{mode:0o600});
  const server=new FakeApple(intent);
  const exchanges=[];
  const fetchImpl=async(url,options)=>{
    const href=String(url);
    exchanges.push({url:href,method:options.method,
      bearer:options.headers?.Authorization??null});
    let output;
    const data=()=>new Response(JSON.stringify(output),{
      status:200,headers:{'Content-Type':'application/json'}
    });
    if(href===origin+'/v1/appScreenshotSets/'+SET+'?include=appStoreVersionLocalization'){
      output=await server.getScreenshotSet(SET);return data();
    }
    if(href===origin+'/v1/appStoreVersionLocalizations/'+LOC){
      output=await server.getLocalization(LOC);return data();
    }
    if(href===origin+'/v1/appScreenshotSets/'+SET+'/appScreenshots?limit=50'){
      output=await server.listScreenshots();return data();
    }
    if(href===origin+'/v1/appScreenshots'&&options.method==='POST'){
      const json=JSON.parse(options.body);
      output=await server.createScreenshot({
        screenshot_set_id:json.data.relationships.appScreenshotSet.data.id,
        file_name:json.data.attributes.fileName,
        file_size:json.data.attributes.fileSize
      });return data();
    }
    if(href.startsWith('https://store-030.blobstore.apple.com/')&&
      options.method==='PUT'){
      await server.uploadPart({length:options.body.length},Buffer.from(options.body));
      return new Response('',{status:200});
    }
    if(href.startsWith(origin+'/v1/appScreenshots/')&&
      options.method==='PATCH'){
      const name=href.split('/').at(-1);
      output=await server.commitScreenshot(name,JSON.parse(options.body).data.attributes.sourceFileChecksum);
      return data();
    }
    throw Error('Unapproved simulated Apple REST request: '+href);
  };
  const remote=createAppleScreenshotTransport({token_file:tokenPath,fetchImpl});
  const result=await sendAppleScreenshotUpload(f.app,f.localPlan,f.input,f.zipPath,
    intent,remote,f.confirmed(intent));
  assert.equal(result.state,'PROCESSING_PENDING');
  assert.equal(result.app_published,false);
  assert.equal(server.created.length,1);
  assert.ok(exchanges.some(x=>x.url===origin+'/v1/appScreenshotSets/'+SET+
    '?include=appStoreVersionLocalization'));
  assert.equal(exchanges.filter(x=>x.method==='POST').length,1);
  assert.equal(exchanges.filter(x=>x.method==='PUT').length,2);
  assert.equal(exchanges.filter(x=>x.method==='PATCH').length,1);
  assert.ok(exchanges.every(x=>['GET','POST','PATCH','PUT'].includes(x.method)));
  assert.ok(exchanges.every(x=>x.method==='PUT'?
    x.bearer===null&&x.url.startsWith('https://store-030.blobstore.apple.com/') :
    x.bearer==='Bearer '+jwt&&x.url.startsWith(origin+'/v1/')));
  assert.equal(exchanges.some(x=>x.url.includes('/reviewSubmissions')||
    x.url.includes('/appStoreVersions/')&&x.method!=='GET'),false);
});
