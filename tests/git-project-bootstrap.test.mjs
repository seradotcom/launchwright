// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setup } from './helpers.mjs';
import { execute } from '../src/application.mjs';
import { observeGitChanges } from '../src/git-change-source.mjs';
import { planGitProjectBootstrap, verifyGitProjectBootstrap, applyGitProjectBootstrap } from '../src/git-project-bootstrap.mjs';

const git=(root,...argv)=>execFileSync('git',['-C',root,...argv],{
  encoding:'utf8',env:{...process.env,GIT_TERMINAL_PROMPT:'0'}
}).trim();
function fixture(t){
  const gitRoot=mkdtempSync(join(tmpdir(),'launchwright-r35-project-'));
  t.after(()=>rmSync(gitRoot,{recursive:true,force:true,maxRetries:5,retryDelay:50}));
  execFileSync('git',['init',gitRoot],{stdio:'ignore'});
  git(gitRoot,'config','user.name','R35 Owned Fixture');
  git(gitRoot,'config','user.email','r35-fixture@example.invalid');
  writeFileSync(join(gitRoot,'README.md'),'Initial project snapshot\n');
  git(gitRoot,'add','.');git(gitRoot,'commit','-m','Initial synthetic project');
  const base=git(gitRoot,'rev-parse','HEAD');
  writeFileSync(join(gitRoot,'README.md'),'Updated project snapshot\n');
  writeFileSync(join(gitRoot,'secret-module-name.txt'),'Not a validated product feature\n');
  git(gitRoot,'add','.');git(gitRoot,'commit','-m','Second synthetic project snapshot');
  const head=git(gitRoot,'rev-parse','HEAD');
  const observation=observeGitChanges({
    repository_root:gitRoot,source_alias:'r35_project',
    base_sha:base,head_sha:head
  });
  const {app,root}=setup(t);
  const options={
    product_name:'R35 Project',release_name:'Release at exact commit',
    source_name:'Approved Git source',target_name:'English reviewer',
    notes_title:'R35 change inventory draft',
    source_purpose:'Operator permits reading owned Git commit metadata',
    locale:'en-US',role:'reviewer',plan:'local',region:'MX',rights:'owned'
  };
  const plan=planGitProjectBootstrap(observation,options);
  const approve={
    confirm_plan_sha256:plan.plan_sha256,confirm_head_sha:head,
    acknowledge_source_approval:true,acknowledge_rights:true,
    acknowledge_imported:true,acknowledge_editorial_draft:true
  };
  return{gitRoot,root,app,observation,plan,approve,options,head};
}

test('R35 dry-run plan is deterministic, path-redacted, does not create Native resources',t=>{
  const f=fixture(t);
  const p2=planGitProjectBootstrap(f.observation,f.options);
  assert.deepEqual(p2,f.plan);
  assert.equal(verifyGitProjectBootstrap(p2,f.observation),p2);
  assert.match(p2.plan_sha256,/^[a-f0-9]{64}$/);
  assert.equal(p2.head_sha,f.head);
  assert.equal(p2.changed_files,2);
  const serialized=JSON.stringify(p2);
  assert.ok(!serialized.includes(f.gitRoot),'Absolute repo path must not be serialized');
  assert.ok(!serialized.includes('secret-module-name.txt'),'Paths must be absent from operator plan');
  assert.equal(f.app.store.all().length,0);
  assert.equal(p2.project_graph_authority,false);
  assert.equal(p2.technical_state,'UNKNOWN');
});

test('R35 apply joins Git -> approved source -> imported UNKNOWN evidence -> editable release notes via Native SDK',async t=>{
  const f=fixture(t);
  const applied=await applyGitProjectBootstrap(f.app,f.plan,f.observation,f.approve);
  assert.deepEqual(Object.values(applied.created),[true,true,true,true,true,true]);
  assert.equal(applied.external_mutation_performed,false);
  assert.equal(applied.project_graph_authority,false);
  const product=f.app.get(applied.product_id,'product');
  const release=f.app.get(applied.release_id,'release');
  const source=f.app.get(applied.source_id,'source');
  const target=f.app.get(applied.target_id,'target');
  const evidence=f.app.get(applied.evidence_id,'evidence');
  const notes=f.app.get(applied.deliverable_id,'deliverable');
  assert.equal(product.data.description.includes(f.plan.plan_sha256),true);
  assert.equal(release.data.build,f.head);
  assert.equal(release.data.status,'draft');
  assert.equal(source.data.approval,'approved');
  assert.equal(source.data.locator,'git-local:r35_project');
  assert.equal(target.data.editorial_locale,'en-US');
  assert.equal(evidence.data.origin_digest,f.observation.observation_sha256);
  assert.equal(evidence.data.technical,'UNKNOWN');
  assert.equal(evidence.data.admission,'imported-declaration');
  assert.equal(evidence.data.host_acceptance,'NOT_ESTABLISHED');
  assert.equal(notes.data.format,'markdown');
  assert.deepEqual(notes.data.source_ids,[source.id]);
  assert.deepEqual(notes.data.claim_ids,[]);
  assert.ok(!notes.data.content.includes('secret-module-name.txt'));
  const artifact=(await execute(f.app,'deliverable.render',{id:notes.id})).entity;
  assert.equal(artifact.data.draft,true);
  assert.equal(artifact.data.technical,'UNKNOWN');
  const candidate=(await execute(f.app,'candidate.freeze',{
    release_id:release.id,name:'Review only',artifact_ids:[artifact.id],
    destination:'r35-private-review',contract:{
      version:'r35',required_reviewers:1,require_claims_verified:false
    }
  })).entity;
  const inspected=await execute(f.app,'candidate.inspect',{id:candidate.id});
  assert.equal(inspected.readiness.published,'NOT_OBSERVED');
  assert.equal(inspected.external_publication_allowed,false);
});

test('R35 repeat apply reuses all six exact resources without generating duplicates',async t=>{
  const f=fixture(t);
  const initial=await applyGitProjectBootstrap(f.app,f.plan,f.observation,f.approve);
  const counts=f.app.store.all().length;
  const repeated=await applyGitProjectBootstrap(f.app,f.plan,f.observation,f.approve);
  assert.deepEqual(Object.values(repeated.created),[false,false,false,false,false,false]);
  for(const kind of ['product','release','source','target','evidence','deliverable'])
    assert.equal(repeated[kind+'_id'],initial[kind+'_id']);
  assert.equal(f.app.store.all().length,counts);
});

test('R35 rejects tampered plan, substituted Git observation or operator confirmations before effects',async t=>{
  const f=fixture(t);
  await assert.rejects(applyGitProjectBootstrap(f.app,{...f.plan,source_alias:'evil'},f.observation,f.approve),{code:'Conflict'});
  await assert.rejects(applyGitProjectBootstrap(f.app,f.plan,{...f.observation,changed_files:9},f.approve),{code:'InvalidArgument'});
  await assert.rejects(applyGitProjectBootstrap(f.app,f.plan,f.observation,{...f.approve,confirm_head_sha:'a'.repeat(40)}),{code:'ConsentRequired'});
  await assert.rejects(applyGitProjectBootstrap(f.app,f.plan,f.observation,{...f.approve,acknowledge_rights:false}),{code:'ConsentRequired'});
  await assert.rejects(applyGitProjectBootstrap(f.app,f.plan,f.observation,{...f.approve,acknowledge_source_approval:false}),{code:'ConsentRequired'});
  assert.equal(f.app.store.all().length,0);
});

test('R35 crashes after four canonical mutations then reconciles exact state without duplication',async t=>{
  const f=fixture(t);
  const original=f.app.store.transaction.bind(f.app.store);
  let counter=0;
  f.app.store.transaction=(...args)=>{
    if(++counter===5)throw Error('Synthetic lost response at imported evidence step');
    return original(...args);
  };
  await assert.rejects(applyGitProjectBootstrap(f.app,f.plan,f.observation,f.approve),
    /Synthetic lost response/u);
  assert.equal(f.app.store.all().length,4);
  f.app.store.transaction=original;
  const recovery=await applyGitProjectBootstrap(f.app,f.plan,f.observation,f.approve);
  assert.deepEqual(recovery.created,{product:false,release:false,source:false,
    target:false,evidence:true,deliverable:true});
  assert.equal(f.app.store.all().length,6);
});

test('R35 fails closed on conflicting preexisting name, edited source or a duplicate product',async t=>{
  const f=fixture(t);
  const outsider=(await execute(f.app,'entity.create',{kind:'product',
    data:{name:f.options.product_name,description:'Another unrelated project'}})).entity;
  await assert.rejects(applyGitProjectBootstrap(f.app,f.plan,f.observation,f.approve),{code:'Conflict'});
  assert.equal(f.app.store.all().length,1);
  await execute(f.app,'entity.retire',{id:outsider.id,expected:outsider.version,reason:'Synthetic cleanup'});
  // Retired tombstones do not count as active owned projects.
  const created=await applyGitProjectBootstrap(f.app,f.plan,f.observation,f.approve);
  const source=f.app.get(created.source_id,'source');
  await execute(f.app,'entity.update',{id:source.id,expected:source.version,
    data:{...source.data,purpose:'Edited purpose by operator'}});
  await assert.rejects(applyGitProjectBootstrap(f.app,f.plan,f.observation,f.approve),{code:'Conflict'});
  assert.equal(f.app.list('source').length,1);
});

test('R35 operator CLI privately writes one plan and resumes apply with the same exact IDs',async t=>{
  const f=fixture(t);
  const obsFile=join(f.gitRoot,'private-source.json');
  const planFile=join(f.gitRoot,'private-bootstrap-plan.json');
  writeFileSync(obsFile,JSON.stringify(f.observation),{mode:0o600});
  const cwd=fileURLToPath(new URL('../',import.meta.url));
  const call=(args)=>spawnSync(process.execPath,['scripts/git-project-bootstrap.mjs',...args],
    {cwd,encoding:'utf8'});
  const args=['plan','--in',obsFile,'--out',planFile,
    '--product',f.options.product_name,'--release',f.options.release_name,
    '--source-name',f.options.source_name,'--target',f.options.target_name,
    '--notes-title',f.options.notes_title,'--purpose',f.options.source_purpose,
    '--locale',f.options.locale,'--role',f.options.role,
    '--plan-label',f.options.plan,'--region',f.options.region,
    '--rights',f.options.rights];
  const planned=call(args);
  assert.equal(planned.status,0,planned.stdout+planned.stderr);
  assert.equal(JSON.parse(planned.stdout).workspace_mutated,false);
  assert.equal(f.app.store.all().length,0);
  const saved=JSON.parse(readFileSync(planFile,'utf8'));
  assert.equal(saved.plan_sha256,f.plan.plan_sha256);
  if(process.platform!=='win32')assert.equal(statSync(planFile).mode&0o077,0);
  assert.notEqual(call(args).status,0,'Private operator plan must never be overwritten');
  const applyArgs=['apply','--state',f.root,'--in',obsFile,
    '--plan-file',planFile,'--confirm-plan',f.plan.plan_sha256,
    '--confirm-head',f.head,'--approve-source','--declare-rights',
    '--acknowledge-imported','--acknowledge-editorial-draft'];
  const first=call(applyArgs);
  assert.equal(first.status,0,first.stdout+first.stderr);
  const a=JSON.parse(first.stdout);
  assert.equal(a.imported_evidence_state,'UNKNOWN');
  const again=call(applyArgs);
  assert.equal(again.status,0,again.stdout+again.stderr);
  const b=JSON.parse(again.stdout);
  assert.equal(a.deliverable_id,b.deliverable_id);
  assert.equal(b.reused.evidence,true);
  assert.equal(f.app.store.all().length,6);
  assert.equal(existsSync(join(f.root,'.git-bootstrap-apply.lock')),false);
});

test('R35 stale operator CLI lock forbids racing second import without workspace mutation',t=>{
  const f=fixture(t);
  const obsFile=join(f.gitRoot,'private-obs.json');
  const planFile=join(f.gitRoot,'private-plan.json');
  writeFileSync(obsFile,JSON.stringify(f.observation),{mode:0o600});
  writeFileSync(planFile,JSON.stringify(f.plan),{mode:0o600});
  const lock=join(f.root,'.git-bootstrap-apply.lock');
  writeFileSync(lock,'other operator importing',{mode:0o600});
  const run=spawnSync(process.execPath,['scripts/git-project-bootstrap.mjs','apply',
    '--state',f.root,'--in',obsFile,'--plan-file',planFile,
    '--confirm-plan',f.plan.plan_sha256,'--confirm-head',f.head,
    '--approve-source','--declare-rights','--acknowledge-imported',
    '--acknowledge-editorial-draft'
  ],{cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8'});
  assert.notEqual(run.status,0);
  assert.equal(f.app.store.all().length,0);
  assert.equal(readFileSync(lock,'utf8'),'other operator importing');
});
