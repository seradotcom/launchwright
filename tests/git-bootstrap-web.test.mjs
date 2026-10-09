// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync as loadWeb } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createAppServer } from '../src/server.mjs';
import { setup } from './helpers.mjs';
import { LaunchwrightClient } from '../client/index.mjs';
import { observeGitChanges } from '../src/git-change-source.mjs';
import { createGitOnboardingController } from '../web/git-onboarding.mjs';

const TOKEN='synthetic-local-owner-token-for-r37';
const CONSUMER='synthetic-consumer-auth-r37';
const git=(root,...argv)=>execFileSync('git',['-C',root,...argv],{
  encoding:'utf8',env:{...process.env,GIT_TERMINAL_PROMPT:'0'}
}).trim();
async function fixture(t){
  const repository=mkdtempSync(join(tmpdir(),'launchwright-r37-git-'));
  t.after(()=>rmSync(repository,{recursive:true,force:true,maxRetries:5,retryDelay:50}));
  execFileSync('git',['init',repository],{stdio:'ignore'});
  git(repository,'config','user.name','Owned R37 Fixture');
  git(repository,'config','user.email','r37@example.invalid');
  writeFileSync(join(repository,'README.md'),'Initial release\n');
  git(repository,'add','.');git(repository,'commit','-m','First synthetic commit');
  const base=git(repository,'rev-parse','HEAD');
  writeFileSync(join(repository,'README.md'),'Updated release\n');
  writeFileSync(join(repository,'secret-path-file.txt'),'Private filename test\n');
  git(repository,'add','.');git(repository,'commit','-m','Second synthetic commit');
  const head=git(repository,'rev-parse','HEAD');
  const observation=observeGitChanges({
    repository_root:repository,source_alias:'r37_existing_project',
    base_sha:base,head_sha:head
  });
  const {app,root}=setup(t);
  const service=createAppServer(app,{port:0,token:TOKEN,bearerPrincipals:[
    {token:CONSUMER,principal:'consumer-37',scopes:['consume']}
  ]});
  const baseUrl=await service.listen();
  t.after(()=>service.close());
  const client=new LaunchwrightClient({baseUrl,token:TOKEN});
  const options={
    product_name:'R37 Existing project',release_name:'Existing commit draft',
    source_name:'Git source',target_name:'Local editorial target',
    notes_title:'Release notes for review',
    source_purpose:'R37 exact committed metadata for local release review',
    locale:'en-US',role:'reviewer',plan:'local',region:'MX',rights:'owned'
  };
  return{repository,root,app,service,baseUrl,client,observation,options,head};
}
const confirmed=plan=>({
  confirm_plan_sha256:plan.plan_sha256,confirm_head_sha:plan.head_sha,
  acknowledge_source_approval:true,acknowledge_rights:true,
  acknowledge_imported:true,acknowledge_editorial_draft:true
});
function reply(url,body,token=TOKEN,extraHeaders={}){
  return fetch(url,{method:'POST',headers:{
    Authorization:'Bearer '+token,'Content-Type':'application/json',...extraHeaders
  },body:JSON.stringify(body)});
}

test('R37 local owner-only HTTP plan is deterministic, no mutation or file paths',async t=>{
  const x=await fixture(t);
  const first=await x.client.planLocalGitBootstrap(x.observation,x.options);
  const second=await x.client.planLocalGitBootstrap(x.observation,x.options);
  assert.deepEqual(first,second);
  assert.equal(first.workspace_mutated,false);
  assert.equal(first.external_send_performed,false);
  assert.equal(first.observation_persisted,false);
  assert.equal(first.technical_state,'UNKNOWN');
  assert.equal(first.plan.head_sha,x.head);
  assert.equal(x.app.store.all().length,0);
  const serialized=JSON.stringify(first);
  assert.ok(!serialized.includes(x.repository));
  assert.ok(!serialized.includes('secret-path-file.txt'));
  assert.equal((await fetch(x.baseUrl+'/git-onboarding.mjs')).status,200);
});

test('R37 HTTP apply creates six scoped resources and exact repeat reconciles all six',async t=>{
  const x=await fixture(t);
  const plan=(await x.client.planLocalGitBootstrap(x.observation,x.options)).plan;
  const first=await x.client.applyLocalGitBootstrap(x.observation,plan,confirmed(plan));
  assert.deepEqual(Object.values(first.created),[true,true,true,true,true,true]);
  assert.equal(first.imported_evidence_state,'UNKNOWN');
  assert.equal(first.platform_authority,false);
  assert.equal(first.publication_authority,false);
  assert.equal(first.external_mutation_performed,false);
  const evidence=x.app.get(first.evidence_id,'evidence');
  assert.equal(evidence.data.admission,'imported-declaration');
  assert.equal(evidence.data.technical,'UNKNOWN');
  const notes=x.app.get(first.deliverable_id,'deliverable');
  assert.equal(notes.data.format,'markdown');
  assert.equal(notes.data.claim_ids.length,0);
  const second=await x.client.applyLocalGitBootstrap(x.observation,plan,confirmed(plan));
  assert.deepEqual(Object.values(second.created),[false,false,false,false,false,false]);
  assert.equal(second.evidence_id,first.evidence_id);
  assert.equal(x.app.store.all().length,6);
  assert.equal(existsSync(join(x.root,'.git-bootstrap-apply.lock')),false);
});

test('R37 both endpoints deny consumers, unauthenticated callers and cross-origin requests',async t=>{
  const x=await fixture(t);
  const body={observation:x.observation,config:x.options};
  assert.equal((await reply(x.baseUrl+'/api/v1/local-git-bootstrap/plan',body,'bad-token')).status,403);
  assert.equal((await reply(x.baseUrl+'/api/v1/local-git-bootstrap/plan',body,CONSUMER)).status,403);
  assert.equal((await reply(x.baseUrl+'/api/v1/local-git-bootstrap/plan',body,TOKEN,
    {Origin:'https://evil.example.invalid'})).status,403);
  const plan=(await x.client.planLocalGitBootstrap(x.observation,x.options)).plan;
  const applied={observation:x.observation,plan,confirmations:confirmed(plan)};
  assert.equal((await reply(x.baseUrl+'/api/v1/local-git-bootstrap/apply',applied,CONSUMER)).status,403);
  assert.equal((await reply(x.baseUrl+'/api/v1/local-git-bootstrap/apply',applied,'wrong')).status,403);
  assert.equal(x.app.store.all().length,0);
});

test('R37 rejects server paths, extra fields, altered plan and missing consent before any resource mutation',async t=>{
  const x=await fixture(t);
  assert.equal((await reply(x.baseUrl+'/api/v1/local-git-bootstrap/plan',{
    observation:x.observation,config:x.options,
    repository_root:x.repository
  })).status,400);
  assert.equal((await reply(x.baseUrl+'/api/v1/local-git-bootstrap/plan',{
    observation:{...x.observation,repository_root:x.repository},
    config:x.options
  })).status,400);
  const plan=(await x.client.planLocalGitBootstrap(x.observation,x.options)).plan;
  await assert.rejects(x.client.applyLocalGitBootstrap(x.observation,
    {...plan,product_name:'unexpected'},confirmed(plan)),{code:'Conflict'});
  await assert.rejects(x.client.applyLocalGitBootstrap(x.observation,plan,
    {...confirmed(plan),acknowledge_rights:false}),{code:'ConsentRequired'});
  await assert.rejects(x.client.applyLocalGitBootstrap(x.observation,plan,
    {...confirmed(plan),confirm_plan_sha256:'b'.repeat(64)}),{code:'ConsentRequired'});
  assert.equal(x.app.store.all().length,0);
});

test('R37 shared CLI/web import lock blocks concurrent or unknown previous outcomes',async t=>{
  const x=await fixture(t);
  const plan=(await x.client.planLocalGitBootstrap(x.observation,x.options)).plan;
  const file=join(x.root,'.git-bootstrap-apply.lock');
  writeFileSync(file,'An existing CLI operator owns this lock',{mode:0o600});
  await assert.rejects(
    x.client.applyLocalGitBootstrap(x.observation,plan,confirmed(plan)),
    {code:'Conflict'});
  assert.equal(readFileSync(file,'utf8'),'An existing CLI operator owns this lock');
  assert.equal(x.app.store.all().length,0);
});

test('R37 an HTTP lost reply after partial Native transactions recovers from exact same plan',async t=>{
  const x=await fixture(t);
  const plan=(await x.client.planLocalGitBootstrap(x.observation,x.options)).plan;
  const original=x.app.store.transaction.bind(x.app.store);
  let counter=0;
  x.app.store.transaction=(...args)=>{
    if(++counter===5)throw Error('R37 simulated lost upstream response');
    return original(...args);
  };
  await assert.rejects(x.client.applyLocalGitBootstrap(x.observation,plan,confirmed(plan)),
    {code:'BackendFailed'});
  assert.equal(x.app.store.all().length,4);
  assert.equal(existsSync(join(x.root,'.git-bootstrap-apply.lock')),false);
  x.app.store.transaction=original;
  const recovered=await x.client.applyLocalGitBootstrap(x.observation,plan,confirmed(plan));
  assert.deepEqual(recovered.created,{product:false,release:false,source:false,
    target:false,evidence:true,deliverable:true});
  assert.equal(x.app.store.all().length,6);
});

test('R37 in-memory browser onboarding controller keeps private observation out of rendered markup',async t=>{
  const x=await fixture(t),browser=createGitOnboardingController(x.client);
  assert.equal(browser.loaded(),false);
  assert.match(browser.render(),/git-observation-file/u);
  assert.throws(()=>browser.uploadObservation('{malformed'),/JSON/u);
  browser.uploadObservation(JSON.stringify(x.observation),'owned<private>.json');
  const pre=browser.render();
  assert.ok(!pre.includes('secret-path-file.txt'));
  assert.ok(pre.includes('owned&lt;private&gt;.json'));
  assert.ok(!pre.includes(x.repository));
  assert.equal(browser.summary().has_observation,true);
  const planResponse=await browser.prepare(x.options);
  assert.equal(browser.summary().has_plan,true);
  assert.equal(browser.summary().publication_authority,false);
  assert.ok(browser.downloadPlan().includes(planResponse.plan.plan_sha256));
  const result=await browser.apply(confirmed(planResponse.plan));
  assert.equal(browser.summary().imported_evidence_state,'UNKNOWN');
  assert.equal(result.platform_authority,false);
  assert.ok(browser.render().includes('Workspace created or recovered'));
  browser.clear();
  assert.equal(browser.summary().has_observation,false);
  assert.equal(browser.summary().has_result,false);
  assert.equal(x.app.list('product').length,1,'Clearing browser memory does not delete local workspace');
});

test('R37 restoring a saved plan is reverified against the selected observation; tampering fails',async t=>{
  const x=await fixture(t),first=createGitOnboardingController(x.client);
  first.uploadObservation(JSON.stringify(x.observation),'private.json');
  const plan=(await first.prepare(x.options)).plan;
  const saved=first.downloadPlan();
  const resumed=createGitOnboardingController(x.client);
  await assert.rejects(resumed.loadSavedPlan(saved),/observation first/u);
  resumed.uploadObservation(JSON.stringify(x.observation),'private.json');
  await resumed.loadSavedPlan(saved);
  assert.equal(resumed.summary().plan_sha256,plan.plan_sha256);
  await assert.rejects(resumed.loadSavedPlan(JSON.stringify({...plan,tag:'other'})),
    /does not match/u);
  assert.equal(x.app.store.all().length,0);
});

test('R37 browser upload bounds, empty JSON and malicious HTML are rejected or escaped',async t=>{
  const x=await fixture(t),ui=createGitOnboardingController(x.client);
  assert.throws(()=>ui.uploadObservation('x'.repeat(240*1024+1)),/too large/u);
  assert.throws(()=>ui.uploadObservation('[]'),/JSON object/u);
  ui.uploadObservation(JSON.stringify({...x.observation,source_alias:'<img src=x onerror=alert(1)>'}),'evil<svg>.json');
  const rendered=ui.render();
  assert.ok(!rendered.includes('<img src=x'));
  assert.ok(rendered.includes('&lt;img'));
  assert.ok(rendered.includes('evil&lt;svg&gt;.json'));
  // Even when UI shows an escaped untrusted alias, the server checks the
  // canonical R32 observation digest and refuses the mutation.
  await assert.rejects(ui.prepare(x.options),{code:'InvalidArgument'});
});

test('R37 UI routes expose only an opt-in browser file input, no server Git executable path',()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const source=loadWeb(join(root,'web/app.mjs'),'utf8');
  const module=loadWeb(join(root,'web/git-onboarding.mjs'),'utf8');
  assert.ok(source.includes("['onboard'"));
  assert.ok(source.includes("view==='onboard'"));
  for(const action of ['onboard-configure','onboard-apply','onboard-download-plan','onboard-open-release'])
    assert.ok(source.includes(action));
  assert.ok(module.includes('file_names_disclosed')===false);
  assert.ok(!module.includes('localStorage.setItem'));
  assert.ok(!module.includes('localStorage.getItem'));
  assert.ok(!module.includes('repository_root'));
});
