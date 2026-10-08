// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { LaunchwrightApplication, execute } from '../src/application.mjs';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareGithubDraft, sendGithubDraft, GITHUB_DRAFT_SCHEMA } from '../src/github-release-draft.mjs';
import { setup, baseline } from './helpers.mjs';

const REPO='seradotcom/owned-release-fixture';
const TARGET_SHA='a'.repeat(40);
const create=async(app,kind,data)=>(await execute(app,'entity.create',{kind,data})).entity;
async function fixture(t,{approve=true,pack=true}={}){
  const {app}=setup(t),b=await baseline(app);
  const profile=await create(app,'channel_profile',{
    product_id:b.product.id,name:'Owned GitHub draft',
    channel:'github-release-draft',profile_version:'r31',
    destination_class:'external-draft',requirements:{format:'zip'},
    source:'github-release-draft:'+REPO,
    effective_at:'2026-10-08T00:00:00.000Z',
    idempotency:'recover-first'
  });
  const artifact=(await execute(app,'deliverable.render',{id:b.deliverable.id})).entity;
  const candidate=(await execute(app,'candidate.freeze',{
    release_id:b.release.id,name:'Owned source candidate',
    artifact_ids:[artifact.id],destination:'github-draft-fixture',
    channel_profile_ids:[profile.id],
    contract:{version:'v2',required_reviewers:1,require_claims_verified:false}
  })).entity;
  if(approve)await execute(app,'candidate.review',{
    id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,
    decision:'approve-editorial',comment:'Approve only this exact owned draft'
  });
  const delivery=pack?(await execute(app,'channel.package',{
    candidate_id:candidate.id,profile_id:profile.id,
    participant:'operator',locale:'en-US',allow_partial:false,omissions:[]
  })).entity:null;
  const planInput={
    delivery_id:delivery?.id,repository:REPO,tag:'v1.2.3',
    tag_commit_sha:TARGET_SHA,title:'Owned fixture v1.2.3',
    notes_artifact_id:artifact.id,acknowledge_draft_only:true,
    acknowledge_unverified:true
  };
  return{app,b,profile,artifact,candidate,delivery,planInput};
}
function approvedConfirm(intent,overrides={}){
  return{
    confirm_repository:intent.repository,confirm_tag:intent.tag,
    confirm_candidate_sha256:intent.candidate_sha256,...overrides
  };
}
class FakeGithub{
  constructor(){this.sha=TARGET_SHA;this.release=null;this.data=null;this.calls=[];this.failUploadOnce=false;this.badDownload=false;}
  async getTagCommit(repo,tag){this.calls.push('tag');return this.sha;}
  async getRelease(repo,tag){
    this.calls.push('read');
    return this.release?structuredClone(this.release):null;
  }
  async createDraft(repo,tag,title,body){
    this.calls.push('create');
    this.release={id:42,draft:true,tag_name:tag,body,title,assets:[]};
  }
  async uploadAsset(repo,tag,name,bytes){
    this.calls.push('upload');
    if(this.failUploadOnce){this.failUploadOnce=false;throw Error('Simulated lost upload response');}
    this.data=Buffer.from(bytes);
    this.release.assets.push({
      id:7,name,size:bytes.length,
      digest:'sha256:'+await import('node:crypto').then(m=>m.createHash('sha256').update(bytes).digest('hex'))
    });
  }
  async downloadAsset(repo,tag,name){
    this.calls.push('download');
    return this.badDownload?Buffer.alloc(this.data.length,0):Buffer.from(this.data);
  }
}

test('R31 plans are private byte-identity intents; no external client is called by preparation',async t=>{
  const x=await fixture(t);
  const plan=prepareGithubDraft(x.app,x.planInput);
  assert.equal(plan.schema_version,GITHUB_DRAFT_SCHEMA);
  assert.equal(plan.candidate_sha256,x.candidate.data.candidate_sha256);
  assert.equal(plan.delivery_id,x.delivery.id);
  assert.match(plan.intent_sha256,/^[0-9a-f]{64}$/);
  assert.match(plan.bundle_sha256,/^[0-9a-f]{64}$/);
  assert.ok(plan.bundle_bytes>100);
  assert.equal(prepareGithubDraft(x.app,x.planInput).intent_sha256,plan.intent_sha256);
  assert.equal(x.app.list('channel_delivery').length,1);
});

test('R31 sends only remote drafts with preexisting matching tag and recovers idempotently',async t=>{
  const x=await fixture(t),intent=prepareGithubDraft(x.app,x.planInput),remote=new FakeGithub();
  const first=await sendGithubDraft(x.app,intent,remote,approvedConfirm(intent));
  assert.deepEqual(remote.calls,['tag','read','create','read','upload','read','download','read','tag']);
  assert.equal(remote.release.draft,true);
  assert.match(remote.release.body,/launchwright-github-draft-sha256:/);
  assert.equal(first.proof.platform_authority,false);
  assert.equal(first.external_send_performed,true);
  assert.equal(first.proof.publicly_published,false);
  assert.equal(first.record.data.state,'DRAFT_CREATED');
  assert.equal(first.record.data.external_state,'DRAFT_CREATED');
  const repeat=await sendGithubDraft(x.app,intent,remote,{...approvedConfirm(intent),recover_only:true});
  assert.equal(repeat.external_send_performed,false);
  assert.equal(first.record.data.receipt_digest,repeat.record.data.receipt_digest);
  assert.equal(x.app.list('channel_delivery').length,2);
  assert.deepEqual(remote.calls.slice(-5),['tag','read','download','read','tag']);
  assert.equal(remote.calls.filter(x=>x==='create').length,1);
  assert.equal(remote.calls.filter(x=>x==='upload').length,1);
});

test('R31 fail-closed policy requires exact destination, tag, review and explicit acknowledgement',async t=>{
  const x=await fixture(t);
  assert.throws(()=>prepareGithubDraft(x.app,{...x.planInput,repository:'other/repo'}),{code:'PermissionDenied'});
  assert.throws(()=>prepareGithubDraft(x.app,{...x.planInput,acknowledge_unverified:false}),{code:'ConsentRequired'});
  assert.throws(()=>prepareGithubDraft(x.app,{...x.planInput,acknowledge_draft_only:false}),{code:'ConsentRequired'});
  for(const tag of ['../../main','refs/tags/v1','-upload','v1..2','v1.lock']) {
    assert.throws(()=>prepareGithubDraft(x.app,{...x.planInput,tag}),{code:'InvalidArgument'});
  }
  const pending=await fixture(t,{approve:false});
  assert.throws(()=>prepareGithubDraft(pending.app,pending.planInput),{code:'ConsentRequired'});
});

test('R31 tag change and operator confirmation mismatch block before remote mutation',async t=>{
  const x=await fixture(t),intent=prepareGithubDraft(x.app,x.planInput),remote=new FakeGithub();
  remote.sha='b'.repeat(40);
  await assert.rejects(sendGithubDraft(x.app,intent,remote,approvedConfirm(intent)),{code:'StaleReference'});
  assert.equal(remote.release,null);
  remote.sha=TARGET_SHA;
  await assert.rejects(sendGithubDraft(x.app,intent,remote,approvedConfirm(intent,{confirm_repository:'other/repo'})),{code:'ConsentRequired'});
  assert.equal(remote.calls.filter(x=>x==='create').length,0);
});

test('R31 tampering any saved intent or changing approved candidate inputs is rejected',async t=>{
  const x=await fixture(t),intent=prepareGithubDraft(x.app,x.planInput),remote=new FakeGithub();
  await assert.rejects(sendGithubDraft(x.app,{...intent,tag:'v4.0.0'},remote,approvedConfirm(intent)),{code:'Conflict'});
  await assert.rejects(sendGithubDraft(x.app,{...intent,bundle_sha256:'0'.repeat(64)},remote,approvedConfirm(intent)),{code:'Conflict'});
  await execute(x.app,'entity.update',{
    id:x.b.deliverable.id,expected:x.b.deliverable.version,
    data:{...x.b.deliverable.data,content:'Changed after candidate freeze'}
  });
  await assert.rejects(sendGithubDraft(x.app,intent,remote,approvedConfirm(intent)),{code:'StaleReference'});
  assert.equal(remote.calls.length,0);
});

test('R31 refuses unrelated or already published GitHub release using the same tag',async t=>{
  const x=await fixture(t),intent=prepareGithubDraft(x.app,x.planInput),remote=new FakeGithub();
  remote.release={id:42,draft:true,tag_name:intent.tag,body:'Unrelated release',assets:[]};
  await assert.rejects(sendGithubDraft(x.app,intent,remote,approvedConfirm(intent)),{code:'Conflict'});
  remote.release.draft=false;
  await assert.rejects(sendGithubDraft(x.app,intent,remote,approvedConfirm(intent)),{code:'Conflict'});
  assert.equal(remote.calls.filter(x=>x==='upload').length,0);
});

test('R31 recover-only never creates a draft nor uploads a missing asset',async t=>{
  const x=await fixture(t),intent=prepareGithubDraft(x.app,x.planInput),remote=new FakeGithub();
  await assert.rejects(sendGithubDraft(x.app,intent,remote,{...approvedConfirm(intent),recover_only:true}),{code:'NotFound'});
  assert.equal(remote.calls.filter(x=>x==='create').length,0);
  await remote.createDraft(intent.repository,intent.tag,intent.title,'<!-- launchwright-github-draft-sha256:'+intent.intent_sha256+' -->');
  await assert.rejects(sendGithubDraft(x.app,intent,remote,{...approvedConfirm(intent),recover_only:true}),{code:'NotFound'});
  assert.equal(remote.calls.filter(x=>x==='upload').length,0);
});

test('R31 partial failures use exact remote draft recovery; never create duplicates',async t=>{
  const x=await fixture(t),intent=prepareGithubDraft(x.app,x.planInput),remote=new FakeGithub();
  remote.failUploadOnce=true;
  await assert.rejects(sendGithubDraft(x.app,intent,remote,approvedConfirm(intent)),/Simulated lost upload response/u);
  assert.equal(remote.release.draft,true);
  assert.equal(x.app.list('channel_delivery').length,1);
  const recovery=await sendGithubDraft(x.app,intent,remote,approvedConfirm(intent));
  assert.equal(recovery.record.data.state,'DRAFT_CREATED');
  assert.equal(remote.calls.filter(x=>x==='create').length,1);
});

test('R31 rejects remote-size/digest mismatch without attaching a delivery receipt',async t=>{
  const x=await fixture(t),intent=prepareGithubDraft(x.app,x.planInput),remote=new FakeGithub();
  await sendGithubDraft(x.app,intent,remote,approvedConfirm(intent));
  const different=await fixture(t);
  const another=prepareGithubDraft(different.app,different.planInput);
  const tampered=new FakeGithub();
  await tampered.createDraft(another.repository,another.tag,another.title,
    '<!-- launchwright-github-draft-sha256:'+another.intent_sha256+' -->');
  tampered.release.assets.push({id:8,name:'launchwright-'+another.delivery_id+'.zip',size:another.bundle_bytes,digest:'sha256:'+'0'.repeat(64)});
  await assert.rejects(sendGithubDraft(different.app,another,tampered,approvedConfirm(another)),{code:'Conflict'});
  assert.equal(different.app.list('channel_delivery').length,1);
});

test('R31 downloaded bytes are verified, even when remote asset advertises a matching digest',async t=>{
  const x=await fixture(t),intent=prepareGithubDraft(x.app,x.planInput),remote=new FakeGithub();
  remote.badDownload=true;
  await assert.rejects(sendGithubDraft(x.app,intent,remote,approvedConfirm(intent)),{code:'Conflict'});
  assert.equal(x.app.list('channel_delivery').length,1);
  remote.badDownload=false;
  const fixed=await sendGithubDraft(x.app,intent,remote,approvedConfirm(intent));
  assert.equal(fixed.record.data.external_state,'DRAFT_CREATED');
});

test('R31 local outcome is not a publish receipt or externally activated release',async t=>{
  const x=await fixture(t),intent=prepareGithubDraft(x.app,x.planInput),remote=new FakeGithub();
  await sendGithubDraft(x.app,intent,remote,approvedConfirm(intent));
  const status=await execute(x.app,'channel.status',{release_id:x.b.release.id});
  const matching=status.latest.find(d=>d.data.external_state==='DRAFT_CREATED');
  assert.equal(matching.data.external_state,'DRAFT_CREATED');
  assert.equal(status.external_send_performed,false);
  assert.equal(status.operator_reported_github_drafts,1);
  assert.notEqual(x.app.capabilities.canonical_publish_receipts,true);
});


test('R31 CLI plan saves a private intent and cannot contact GitHub during preparation',async t=>{
  const x=await fixture(t);
  const file=join(x.app.store.root,'operator-plan.json');
  const args=['src/main.mjs','github-draft-plan',
    '--state',x.app.store.root,'--delivery',x.delivery.id,'--repo',REPO,
    '--tag','v1.2.3','--commit',TARGET_SHA,'--title','Owned fixture v1.2.3',
    '--notes-artifact',x.artifact.id,'--out',file,
    '--acknowledge-draft-only','--acknowledge-unverified'];
  const processResult=spawnSync(process.execPath,args,{
    cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8'
  });
  assert.equal(processResult.status,0,processResult.stderr||processResult.stdout);
  assert.equal(existsSync(file),true);
  if(process.platform!=='win32')assert.equal(statSync(file).mode&0o077,0);
  const payload=JSON.parse(readFileSync(file,'utf8'));
  assert.equal(payload.schema_version,GITHUB_DRAFT_SCHEMA);
  assert.equal(payload.candidate_sha256,x.candidate.data.candidate_sha256);
  assert.equal(JSON.parse(processResult.stdout).remote_action_performed,false);
  // Exclusive creation refuses overwriting the already approved operator intent.
  const repeated=spawnSync(process.execPath,args,{
    cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8'
  });
  assert.notEqual(repeated.status,0);
  assert.equal(JSON.parse(readFileSync(file,'utf8')).intent_sha256,payload.intent_sha256);
});

test('R31 CLI rejects unauthenticated intent files and missing operator confirmations before contacting GitHub',async t=>{
  const x=await fixture(t);
  const intent=prepareGithubDraft(x.app,x.planInput);
  const file=join(x.app.store.root,'operator-plan-private.json');
  const fs=await import('node:fs');
  fs.writeFileSync(file,JSON.stringify(intent),{mode:0o600});
  const run=(args)=>spawnSync(process.execPath,[
    'src/main.mjs','github-draft-send','--state',x.app.store.root,
    '--intent',file,...args
  ],{cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8'});
  const invalid=run(['--confirm-repo','wrong/repo',
    '--confirm-tag','v1.2.3','--confirm-candidate',intent.candidate_sha256]);
  assert.notEqual(invalid.status,0);
  const failure=JSON.parse(invalid.stdout);
  assert.equal(failure.error.code,'ConsentRequired');
  if(process.platform!=='win32'){
    fs.chmodSync(file,0o644);
    const publicFile=run(['--confirm-repo',REPO,'--confirm-tag','v1.2.3',
      '--confirm-candidate',intent.candidate_sha256]);
    assert.notEqual(publicFile.status,0);
    assert.match(JSON.parse(publicFile.stdout).error.message,/private regular file/u);
  }
});


test('R31 aborts if GitHub tag or release identity changes during upload',async t=>{
  const x=await fixture(t),intent=prepareGithubDraft(x.app,x.planInput);
  const movedTag=new FakeGithub();
  let requests=0;
  movedTag.getTagCommit=async()=>++requests===1?TARGET_SHA:'b'.repeat(40);
  await assert.rejects(sendGithubDraft(x.app,intent,movedTag,approvedConfirm(intent)),{code:'StaleReference'});
  assert.equal(x.app.list('channel_delivery').length,1);
  const replacedRelease=new FakeGithub();
  const original=replacedRelease.getRelease.bind(replacedRelease);
  let reads=0;
  replacedRelease.getRelease=async(...args)=>{
    const value=await original(...args);
    if(value && ++reads>=3)value.id=666;
    return value;
  };
  await assert.rejects(sendGithubDraft(x.app,intent,replacedRelease,approvedConfirm(intent)),{code:'Conflict'});
  assert.equal(x.app.list('channel_delivery').length,1);
});

test('R31 a title cannot be interpreted as a GitHub option prefix',async t=>{
  const x=await fixture(t);
  assert.throws(()=>prepareGithubDraft(x.app,{...x.planInput,title:'--publish-now'}),{code:'InvalidArgument'});
});
