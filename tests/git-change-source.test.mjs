// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { observeGitChanges, verifyGitObservation, importGitObservation, GIT_OBSERVATION_SCHEMA } from '../src/git-change-source.mjs';
import { execute } from '../src/application.mjs';
import { setup } from './helpers.mjs';

const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],{
  encoding:'utf8',env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1'}
}).trim();
function fixture(t){
  const repo=mkdtempSync(join(tmpdir(),'launchwright-r32-git-'));
  t.after(()=>rmSync(repo,{recursive:true,force:true,maxRetries:5,retryDelay:40}));
  execFileSync('git',['init',repo],{stdio:'ignore'});
  git(repo,'config','user.name','Owned R32 Fixture');
  git(repo,'config','user.email','r32-fixture@example.invalid');
  writeFileSync(join(repo,'README.md'),'Project fixture: release A\n');
  writeFileSync(join(repo,'removed.txt'),'remove in next version\n');
  git(repo,'add','.');
  git(repo,'commit','-m','R32 synthetic initial commit');
  const base=git(repo,'rev-parse','HEAD');
  writeFileSync(join(repo,'README.md'),'Project fixture: release B\n');
  unlinkSync(join(repo,'removed.txt'));
  mkdirSync(join(repo,'docs'));
  writeFileSync(join(repo,'docs','CHANGELOG.md'),'# Synthetic release\n');
  git(repo,'add','-A');
  git(repo,'commit','-m','R32 synthetic second commit');
  const head=git(repo,'rev-parse','HEAD');
  return{repo,base,head};
}
async function localContext(app,alias,head){
  const product=(await execute(app,'entity.create',{kind:'product',data:{name:'Git Release Source'}})).entity;
  const release=(await execute(app,'entity.create',{kind:'release',data:{product_id:product.id,name:'Commit snapshot',build:head}})).entity;
  const source=(await execute(app,'entity.create',{kind:'source',data:{
    product_id:product.id,name:'Approved Git metadata',type:'cli',
    locator:'git-local:'+alias,build:head,coverage:'declared',
    purpose:'Release metadata and changelog inventory',approval:'approved'
  }})).entity;
  const target=(await execute(app,'entity.create',{kind:'target',data:{
    release_id:release.id,name:'Owned target',ui_locale:'en-US',editorial_locale:'en-US',
    role:'viewer',plan:'free',region:'MX',flags:{},viewport:{width:1440,height:900,scale_milli:1000}
  }})).entity;
  return{product,release,source,target};
}

test('R32 observes exact committed Git metadata without executing code or reading diff contents',t=>{
  const f=fixture(t),args={repository_root:f.repo,source_alias:'project_alpha',base_sha:f.base,head_sha:f.head};
  const before=git(f.repo,'status','--porcelain');
  const first=observeGitChanges(args),second=observeGitChanges(args);
  assert.equal(git(f.repo,'status','--porcelain'),before,'Git metadata probe must not alter repository worktree');
  assert.equal(first.schema_version,GIT_OBSERVATION_SCHEMA);
  assert.deepEqual(first,second);
  assert.equal(first.changed_files,3);
  assert.equal(first.commit_count,1);
  assert.deepEqual(first.changed_paths,[
    {path:'README.md',status:'M'},
    {path:'docs/CHANGELOG.md',status:'A'},
    {path:'removed.txt',status:'D'}
  ]);
  assert.match(first.observation_sha256,/^[0-9a-f]{64}$/);
  assert.match(first.base_tree_sha,/^[0-9a-f]{40}$/);
  assert.equal(first.file_contents_included,false);
  assert.equal(first.commit_messages_included,false);
  assert.equal(first.technical_state,'UNKNOWN');
  assert.equal(first.project_graph_authority,false);
  assert.equal(first.platform_execution_authority,false);
  const json=JSON.stringify(first);
  assert.ok(!json.includes(f.repo),'Local repo path must never leak into portable snapshot');
  assert.ok(!json.includes('Project fixture: release B'),'Git file contents must never be copied');
  assert.ok(!json.includes('R32 synthetic second commit'),'Commit messages must never be copied');
});

test('R32 rejects nonancestral or noncommit revisions, relative/nested directory and unchanged range',t=>{
  const f=fixture(t);
  const args={repository_root:f.repo,source_alias:'project_alpha',base_sha:f.base,head_sha:f.head};
  assert.throws(()=>observeGitChanges({...args,base_sha:f.head,head_sha:f.base}),{code:'InvalidArgument'});
  assert.throws(()=>observeGitChanges({...args,base_sha:f.base,head_sha:f.base}),{code:'InvalidArgument'});
  assert.throws(()=>observeGitChanges({...args,base_sha:'0'.repeat(40)}),{code:'Unavailable'});
  assert.throws(()=>observeGitChanges({...args,repository_root:'relative'}),{code:'InvalidArgument'});
  assert.throws(()=>observeGitChanges({...args,repository_root:join(f.repo,'docs')}),{code:'InvalidArgument'});
  assert.throws(()=>observeGitChanges({...args,source_alias:'../../bad'}),{code:'InvalidArgument'});
});

test('R32 observation validation rejects changed paths/digests and forged canonical authority',t=>{
  const f=fixture(t);
  const raw=observeGitChanges({repository_root:f.repo,source_alias:'project_alpha',base_sha:f.base,head_sha:f.head});
  assert.equal(verifyGitObservation(raw).observation_sha256,raw.observation_sha256);
  assert.throws(()=>verifyGitObservation({...raw,changed_files:999}),{code:'InvalidArgument'});
  assert.throws(()=>verifyGitObservation({...raw,observation_sha256:'0'.repeat(64)}),{code:'Conflict'});
  assert.throws(()=>verifyGitObservation({...raw,platform_execution_authority:true}),{code:'PolicyDenied'});
  assert.throws(()=>verifyGitObservation({...raw,project_graph_authority:true}),{code:'PolicyDenied'});
  assert.throws(()=>verifyGitObservation({...raw,changed_paths:[{path:'../secret',status:'M'}],changed_files:1}),{code:'InvalidArgument'});
});

test('R32 records only imported UNKNOWN evidence through canonical Semwright application',async t=>{
  const f=fixture(t),{app}=setup(t);
  const context=await localContext(app,'project_alpha',f.head);
  const observed=observeGitChanges({repository_root:f.repo,source_alias:'project_alpha',base_sha:f.base,head_sha:f.head});
  const recorded=await importGitObservation(app,observed,{
    source_id:context.source.id,target_id:context.target.id,release_id:context.release.id,
    name:'Git committed metadata',rights:'owned',acknowledge_imported:true
  });
  assert.equal(recorded.kind,'evidence');
  assert.equal(recorded.data.origin_digest,observed.observation_sha256);
  assert.equal(recorded.data.admission,'imported-declaration');
  assert.equal(recorded.data.technical,'UNKNOWN');
  assert.equal(recorded.data.rights_basis,'operator-declaration');
  assert.equal(recorded.data.host_acceptance,'NOT_ESTABLISHED');
});

test('R32 rejects unapproved origins, mismatched alias/build/target, and missing acknowledgement',async t=>{
  const f=fixture(t),{app}=setup(t);
  const context=await localContext(app,'project_alpha',f.head);
  const observation=observeGitChanges({repository_root:f.repo,source_alias:'project_alpha',base_sha:f.base,head_sha:f.head});
  const input={
    source_id:context.source.id,target_id:context.target.id,release_id:context.release.id,
    name:'Imported Git observation',rights:'owned',acknowledge_imported:true
  };
  await assert.rejects(importGitObservation(app,observation,{...input,acknowledge_imported:false}),{code:'ConsentRequired'});
  await assert.rejects(importGitObservation(app,{...observation,source_alias:'unrelated'},input),{code:'Conflict'});
  await assert.rejects(importGitObservation(app,observation,{...input,rights:'unknown'}),{code:'InvalidArgument'});
  const source=(await execute(app,'entity.update',{id:context.source.id,expected:context.source.version,
    data:{...context.source.data,approval:'denied'}})).entity;
  await assert.rejects(importGitObservation(app,observation,{...input,source_id:source.id}),{code:'PermissionDenied'});
});

test('R32 operator CLI observation writes an exclusive private file without network mutation',t=>{
  const f=fixture(t),out=join(f.repo,'private-observation.json');
  const args=['scripts/git-change-source.mjs','observe',
    '--repo',f.repo,'--alias','project_alpha','--base',f.base,
    '--head',f.head,'--out',out];
  const cwd=fileURLToPath(new URL('../',import.meta.url));
  const result=spawnSync(process.execPath,args,{cwd,encoding:'utf8'});
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.equal(JSON.parse(result.stdout).network_access_performed,false);
  const data=JSON.parse(readFileSync(out,'utf8'));
  assert.equal(data.changed_files,3);
  if(process.platform!=='win32')assert.equal(statSync(out).mode&0o077,0);
  const rerun=spawnSync(process.execPath,args,{cwd,encoding:'utf8'});
  assert.notEqual(rerun.status,0);
});


test('R32 operator CLI record imports a saved observation without claiming canonical execution',async t=>{
  const f=fixture(t),{app,root}=setup(t),context=await localContext(app,'project_alpha',f.head);
  const observation=observeGitChanges({repository_root:f.repo,source_alias:'project_alpha',
    base_sha:f.base,head_sha:f.head});
  const file=join(f.repo,'snapshot-to-import.json');
  writeFileSync(file,JSON.stringify(observation),{mode:0o600});
  const cwd=fileURLToPath(new URL('../',import.meta.url));
  const args=['scripts/git-change-source.mjs','record','--state',root,'--in',file,
    '--source',context.source.id,'--target',context.target.id,
    '--release',context.release.id,'--name','Source metadata evidence',
    '--rights','owned','--acknowledge-imported'];
  const command=spawnSync(process.execPath,args,{cwd,encoding:'utf8'});
  assert.equal(command.status,0,command.stdout+command.stderr);
  const output=JSON.parse(command.stdout);
  assert.equal(output.observation_sha256,observation.observation_sha256);
  assert.equal(output.technical_state,'UNKNOWN');
  assert.equal(output.platform_authority,false);
  assert.equal(output.driver_host_authority,false);
  assert.equal(app.get(output.id).data.origin_digest,observation.observation_sha256);
  assert.equal(app.get(output.id).data.admission,'imported-declaration');
});


test('R32 large source inventories fail closed instead of returning a truncated denominator',t=>{
  const f=fixture(t),base=f.head;
  for(let i=0;i<513;i++)writeFileSync(join(f.repo,'file-'+String(i).padStart(4,'0')+'.txt'),'x');
  git(f.repo,'add','-A');
  git(f.repo,'commit','-m','Bounded inventory fixture');
  const head=git(f.repo,'rev-parse','HEAD');
  assert.throws(()=>observeGitChanges({
    repository_root:f.repo,source_alias:'project_alpha',base_sha:base,head_sha:head
  }),{code:'ResourceExhausted'});
});
