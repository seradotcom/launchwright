// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setup } from './helpers.mjs';
import { execute } from '../src/application.mjs';
import { observeGitChanges, importGitObservation } from '../src/git-change-source.mjs';
import { previewGitReleaseOutline, createGitReleaseOutline } from '../src/git-release-outline.mjs';

const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],{
  encoding:'utf8',env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1'}
}).trim();
async function fixture(t){
  const repo=mkdtempSync(join(tmpdir(),'launchwright-r33-git-'));
  t.after(()=>rmSync(repo,{recursive:true,force:true,maxRetries:4,retryDelay:50}));
  execFileSync('git',['init',repo],{stdio:'ignore'});
  git(repo,'config','user.name','R33 fixture');
  git(repo,'config','user.email','r33@example.invalid');
  writeFileSync(join(repo,'README.md'),'Initial editorial fixture');
  git(repo,'add','.');git(repo,'commit','-m','first');
  const base=git(repo,'rev-parse','HEAD');
  writeFileSync(join(repo,'README.md'),'Updated fixture');
  writeFileSync(join(repo,'internal-secrets-manifest.md'),'Confidential path demo');
  git(repo,'add','.');git(repo,'commit','-m','second');
  const head=git(repo,'rev-parse','HEAD');
  const observation=observeGitChanges({repository_root:repo,
    source_alias:'r33_fixture',base_sha:base,head_sha:head});
  const {app,root}=setup(t);
  const add=async(kind,data)=>(await execute(app,'entity.create',{kind,data})).entity;
  const product=await add('product',{name:'R33 synthetic product'});
  const release=await add('release',{product_id:product.id,name:'v2 draft',build:head});
  const source=await add('source',{product_id:product.id,name:'Approved Git source',
    type:'cli',locator:'git-local:r33_fixture',build:head,coverage:'declared',
    purpose:'Explicit operator-owned source change metadata',approval:'approved'});
  const target=await add('target',{release_id:release.id,name:'en-US target',
    ui_locale:'en-US',editorial_locale:'en-US',role:'viewer',plan:'basic',
    region:'MX',flags:{},viewport:{width:1440,height:900,scale_milli:1000}});
  const evidence=await importGitObservation(app,observation,{
    source_id:source.id,release_id:release.id,target_id:target.id,
    name:'Git metadata source',rights:'owned',acknowledge_imported:true});
  const input={
    source_id:source.id,release_id:release.id,target_id:target.id,
    evidence_id:evidence.id,name:'Review draft from Git',
    include_paths:false,acknowledge_path_disclosure:false,
    acknowledge_editorial_draft:true
  };
  return{repo,root,app,base,head,observation,product,release,source,target,evidence,input};
}
test('R33 default preview shows only factual committed counts and evidence identity, not private paths or feature claims',async t=>{
  const x=await fixture(t),draft=previewGitReleaseOutline(x.app,x.observation,x.input);
  assert.equal(draft.schema_version,'launchwright-git-release-outline/1');
  assert.equal(draft.counts.A,1);assert.equal(draft.counts.M,1);
  assert.equal(draft.counts.D,0);
  assert.equal(draft.file_names_disclosed,false);
  assert.equal(draft.technical_state,'UNKNOWN');
  assert.equal(draft.claims_verified,false);
  assert.equal(draft.external_send_performed,false);
  assert.equal(draft.project_graph_authority,false);
  assert.ok(draft.content.includes(x.observation.observation_sha256));
  assert.ok(draft.content.includes(x.head));
  assert.match(draft.content,/DRAFT|review required|NOT a feature announcement/u);
  assert.ok(!draft.content.includes('internal-secrets-manifest.md'));
  assert.ok(!draft.content.includes('README.md'));
  assert.ok(!draft.content.includes(x.repo),'Source path disclosure is prohibited');
});

test('R33 file-path appendix requires explicit independent disclosure acknowledgement',async t=>{
  const x=await fixture(t);
  assert.throws(()=>previewGitReleaseOutline(x.app,x.observation,{
    ...x.input,include_paths:true
  }),{code:'ConsentRequired'});
  const disclosed=previewGitReleaseOutline(x.app,x.observation,{
    ...x.input,include_paths:true,acknowledge_path_disclosure:true
  });
  assert.equal(disclosed.file_names_disclosed,true);
  assert.ok(disclosed.content.includes('internal-secrets-manifest.md'));
  assert.ok(disclosed.content.includes('    A  "internal-secrets-manifest.md"'));
});

test('R33 creates editable markdown deliverable via canonical SDK, with UNKNOWN state, and reuses an exact repeated intent',async t=>{
  const x=await fixture(t);
  const draft=await createGitReleaseOutline(x.app,x.observation,x.input);
  assert.equal(draft.reused,false);
  assert.equal(draft.entity.kind,'deliverable');
  assert.equal(draft.entity.data.format,'markdown');
  assert.deepEqual(draft.entity.data.source_ids,[x.source.id]);
  assert.deepEqual(draft.entity.data.claim_ids,[]);
  assert.equal(draft.entity.data.target_id,x.target.id);
  const rendered=(await execute(x.app,'deliverable.render',{id:draft.entity.id})).entity;
  assert.equal(rendered.data.draft,true);
  assert.equal(rendered.data.technical,'UNKNOWN');
  const bytes=x.app.store.readBlob(rendered.data.sha256).bytes.toString('utf8');
  assert.ok(bytes.includes('DRAFT'));
  assert.ok(bytes.includes(x.observation.observation_sha256));
  const again=await createGitReleaseOutline(x.app,x.observation,x.input);
  assert.equal(again.reused,true);
  assert.equal(again.entity.id,draft.entity.id);
  assert.equal(again.outline_sha256,draft.outline_sha256);
  assert.equal(x.app.list('deliverable',x.release.id).length,1);
});

test('R33 refuses to overwrite human edits or silently reuse an unrelated document of the same name',async t=>{
  const x=await fixture(t);
  const first=await createGitReleaseOutline(x.app,x.observation,x.input);
  await execute(x.app,'entity.update',{
    id:first.entity.id,expected:first.entity.version,
    data:{...first.entity.data,content:'Human revised release notes'}
  });
  await assert.rejects(createGitReleaseOutline(x.app,x.observation,x.input),{code:'Conflict'});
  assert.equal(x.app.list('deliverable',x.release.id).length,1);
});

test('R33 cannot create editorial output without an accepted imported evidence binding',async t=>{
  const x=await fixture(t);
  await assert.rejects(createGitReleaseOutline(x.app,x.observation,{
    ...x.input,acknowledge_editorial_draft:false
  }),{code:'ConsentRequired'});
  assert.throws(()=>previewGitReleaseOutline(x.app,x.observation,{
    ...x.input,evidence_id:x.source.id
  }),{code:'InvalidArgument'});
  assert.throws(()=>previewGitReleaseOutline(x.app,{
    ...x.observation,observation_sha256:'f'.repeat(64)
  },x.input),{code:'Conflict'});
  assert.throws(()=>previewGitReleaseOutline(x.app,x.observation,{
    ...x.input,source_id:x.product.id
  }),{code:'InvalidArgument'});
});

test('R33 source revision drift fails closed; human review work cannot inherit stale Git evidence',async t=>{
  const x=await fixture(t);
  await execute(x.app,'entity.update',{
    id:x.source.id,expected:x.source.version,
    data:{...x.source.data,purpose:'Updated purpose after imported observation'}
  });
  assert.throws(()=>previewGitReleaseOutline(x.app,x.observation,x.input),{code:'StaleReference'});
  assert.equal(x.app.list('deliverable',x.release.id).length,0);
});

test('R33 operator CLI preview is private and read-only, create is explicit and repeatable without duplicates',async t=>{
  const x=await fixture(t),snapshot=join(x.repo,'private-observation.json'),
    preview=join(x.repo,'release-notes-private.md');
  writeFileSync(snapshot,JSON.stringify(x.observation),{mode:0o600});
  const common=['--state',x.root,'--in',snapshot,
    '--source',x.source.id,'--release',x.release.id,
    '--target',x.target.id,'--evidence',x.evidence.id,
    '--name','Release notes from metadata'];
  const exec=(command,args)=>spawnSync(process.execPath,
    ['scripts/git-release-outline.mjs',command,...args],
    {cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8'});
  const read=exec('preview',[...common,'--out',preview]);
  assert.equal(read.status,0,read.stdout+read.stderr);
  assert.equal(x.app.list('deliverable',x.release.id).length,0);
  assert.equal(JSON.parse(read.stdout).domain_mutation_performed,false);
  if(process.platform!=='win32')assert.equal(statSync(preview).mode&0o077,0);
  assert.ok(!readFileSync(preview,'utf8').includes('internal-secrets-manifest.md'));
  const make=exec('create',[...common,'--acknowledge-editorial-draft']);
  assert.equal(make.status,0,make.stdout+make.stderr);
  assert.equal(JSON.parse(make.stdout).technical_state,'UNKNOWN');
  const second=exec('create',[...common,'--acknowledge-editorial-draft']);
  assert.equal(second.status,0,second.stdout+second.stderr);
  assert.equal(JSON.parse(second.stdout).reused,true);
  assert.equal(x.app.list('deliverable',x.release.id).length,1);
});
