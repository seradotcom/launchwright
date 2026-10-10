// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync,mkdirSync,rmSync,readFileSync,writeFileSync,
  readdirSync,statSync,chmodSync,symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { execute } from '../src/application.mjs';
import { setup,baseline } from './helpers.mjs';
import { continuityReport,planReleaseContinuity,verifyReleaseContinuity,
  exportReleaseContinuity } from '../src/release-continuity.mjs';

const dir=fileURLToPath(new URL('../',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const render=async(app,deliverable)=>
  (await execute(app,'deliverable.render',{id:deliverable.id})).entity;
const freeze=async(app,release,artifacts)=>
  (await execute(app,'candidate.freeze',{
    release_id:release.id,name:'Owned candidate '+release.data.build,
    artifact_ids:artifacts.map(a=>a.id),destination:'local-continuity-review',
    contract:{version:'continuity-fixture',required_reviewers:1,
      require_claims_verified:false}
  })).entity;
async function fixture(t,{extraNew=false,malicious=false,sameCopy=true,secondProduct=false,withUnknownClaim=false}={}){
  const {app,root}=setup(t),old=await baseline(app);
  const original=(await render(app,old.deliverable));
  const candidateA=await freeze(app,old.release,[original]);
  await execute(app,'candidate.review',{id:candidateA.id,
    candidate_sha256:candidateA.data.candidate_sha256,
    decision:'approve-editorial',comment:'Owned prior release approved'});
  const otherProduct=secondProduct?await old.create('product',{
    name:'Other synthetic product',description:'Distinct product'}):null;
  const afterRelease=await old.create('release',{
    product_id:otherProduct?.id??old.product.id,
    name:'2.0 owned release',build:'build-B',status:'draft'
  });
  const afterSource=await old.create('source',{
    product_id:afterRelease.data.product_id,name:'Owned source for next release',
    type:'web',locator:'http://127.0.0.1:4320/build/B',
    build:afterRelease.data.build,coverage:'declared'
  });
  const target=await old.create('target',{
    release_id:afterRelease.id,name:'English basic',
    ui_locale:'en-US',editorial_locale:'en-US',
    role:'viewer',plan:'basic',region:'MX',
    flags:{advanced_export:false},
    viewport:{width:1440,height:900,scale_milli:1000}
  });
  const claim=withUnknownClaim?await old.create('claim',{
    release_id:afterRelease.id,target_id:target.id,
    name:'Synthetic registered API claim',
    text:'Synthetic statement requiring independent proof',category:'feature',
    evidence_ids:[]
  }):null;
  const notes=await old.create('deliverable',{
    release_id:afterRelease.id,name:malicious?'Release <script>alert(1)</script>':'Release notes',
    target_id:target.id,format:'markdown',
    content:sameCopy?'Owned synthetic editorial copy.':'Owned synthetic edited copy for new release.',
    claim_ids:claim?[claim.id]:[],source_ids:[afterSource.id]
  });
  const art2=await render(app,notes);
  const nextArtifacts=[art2];
  if(extraNew){
    const extra=await old.create('deliverable',{
      release_id:afterRelease.id,name:'What changed',
      target_id:target.id,format:'markdown',
      content:'Owned scenario newly documented in build-B.',
      claim_ids:[],source_ids:[afterSource.id]
    });
    nextArtifacts.push(await render(app,extra));
  }
  const candidateB=await freeze(app,afterRelease,nextArtifacts);
  await execute(app,'candidate.review',{id:candidateB.id,
    candidate_sha256:candidateB.data.candidate_sha256,
    decision:'approve-editorial',comment:'Owned new release approved'});
  const input={
    before_release_id:old.release.id,
    after_release_id:afterRelease.id,
    before_candidate_id:candidateA.id,
    after_candidate_id:candidateB.id,
    acknowledge_private_only:true,
    acknowledge_incomplete_coverage:true
  };
  const confirmations=plan=>({
    confirm_plan_sha256:plan.plan_sha256,
    confirm_before_candidate_sha256:plan.before_candidate_sha256,
    confirm_after_candidate_sha256:plan.after_candidate_sha256,
    acknowledge_private_export:true
  });
  const out=mkdtempSync(join(tmpdir(),'launchwright-r54-private-'));
  if(process.platform!=='win32')chmodSync(out,0o700);
  t.after(()=>rmSync(out,{recursive:true,force:true,maxRetries:5,retryDelay:50}));
  return{app,root,old,afterRelease,afterSource,target,notes,candidateA,candidateB,
    input,confirmations,out};
}
async function unzip(file){
  const bytes=readFileSync(file),zip=await JSZip.loadAsync(bytes,{checkCRC32:true});
  const json=JSON.parse(await zip.file('report.json').async('string'));
  const html=await zip.file('index.html').async('string');
  return{bytes,zip,json,html,names:Object.keys(zip.files).sort()};
}
test('R54 two genuine Native release candidates produce a deterministic source-scoped diff without fictional verification',async t=>{
  const f=await fixture(t);
  const a=continuityReport(f.app,f.input),b=continuityReport(f.app,f.input);
  assert.deepEqual(a,b);
  assert.equal(a.before.build,'build-A');
  assert.equal(a.after.build,'build-B');
  assert.equal(a.product_id,f.old.product.id);
  assert.equal(a.counts.changed,1);
  assert.equal(a.counts.added,0);
  assert.equal(a.counts.removed,0);
  assert.equal(a.counts.unchanged,0);
  assert.equal(a.changes[0].editorial_copy_unchanged,true,
    'Same editorial content across builds is distinct from released bytes');
  assert.equal(a.changes[0].status,'CHANGED');
  assert.equal(a.changes[0].reused_across_builds,false);
  assert.equal(a.changes[0].technical_truth,'NOT_PROVED_BY_CROSS_RELEASE_HASHES');
  assert.equal(a.registered_graph_scope_fully_observed,false);
  assert.equal(a.before.impact.unknown_frontier,true);
  assert.equal(a.after.impact.unknown_frontier,true);
  assert.equal(a.external_publication_verified,false);
  assert.equal(a.technical_behavior_verified,false);
  assert.equal(a.no_automatic_reuse,true);
  assert.equal(a.historical_release_preserved,true);
});
test('R54 new outputs are ADDED without inventing source product behavior',async t=>{
  const f=await fixture(t,{extraNew:true,sameCopy:false});
  const report=continuityReport(f.app,f.input);
  assert.equal(report.counts.added,1);
  assert.equal(report.counts.changed,1);
  assert.equal(report.changes.find(c=>c.status==='CHANGED').editorial_copy_unchanged,false);
  assert.equal(report.changes.find(c=>c.status==='ADDED').title,'What changed');
});
test('R54 prepare has no effects; actual offline ZIP includes exact report, CSP and no script/network calls',async t=>{
  const f=await fixture(t),plan=planReleaseContinuity(f.app,f.input);
  assert.deepEqual(verifyReleaseContinuity(f.app,plan),plan);
  assert.match(plan.plan_sha256,/^[a-f0-9]{64}$/u);
  assert.equal(f.app.list('artifact').length,2);
  assert.equal(plan.publication_authority,false);
  assert.equal(readdirSync(f.out).length,0);
  const exported=await exportReleaseContinuity(f.app,plan,f.out,f.confirmations(plan));
  assert.equal(exported.files_created,2);
  assert.equal(exported.external_send_performed,false);
  assert.equal(exported.platform_authority,false);
  assert.equal(exported.technical_behavior_verified,false);
  const payload=await unzip(join(f.out,exported.filename));
  assert.deepEqual(payload.names,['README.txt','index.html','report.json']);
  assert.equal(hash(payload.bytes),exported.zip_sha256);
  assert.equal(payload.json.before.candidate_sha256,plan.before_candidate_sha256);
  assert.equal(payload.json.after.candidate_sha256,plan.after_candidate_sha256);
  assert.equal(payload.json.counts.changed,1);
  assert.equal(hash(Buffer.from(payload.html)),exported.html_sha256);
  assert.ok(payload.html.includes('Release continuity'));
  assert.ok(payload.html.includes('build-A'));
  assert.ok(payload.html.includes('build-B'));
  assert.ok(payload.html.includes("script-src &#39;none&#39;"));
  assert.ok(!payload.html.includes('<script'));
  assert.ok(!payload.html.includes('https://'));
  assert.ok(!payload.html.includes(f.root));
  assert.equal(f.app.list('artifact').length,2,
    'A private continuity export must not create a new Native artifact or mutate releases');
});
test('R54 output ZIP is deterministic across time, exact replay and partial completion recover safely',async t=>{
  const f=await fixture(t),plan=planReleaseContinuity(f.app,f.input);
  const one=await exportReleaseContinuity(f.app,plan,f.out,f.confirmations(plan));
  const oldZip=readFileSync(join(f.out,one.filename));
  await new Promise(resolve=>setTimeout(resolve,1250));
  const again=await exportReleaseContinuity(f.app,plan,f.out,f.confirmations(plan));
  assert.equal(again.recovered,true);
  assert.equal(again.files_created,0);
  assert.equal(again.zip_sha256,one.zip_sha256);
  assert.deepEqual(readFileSync(join(f.out,one.filename)),oldZip);
  const receipt=join(f.out,'launchwright-continuity-'+plan.plan_sha256.slice(0,12)+'.receipt.json');
  rmSync(receipt);
  const recovery=await exportReleaseContinuity(f.app,plan,f.out,f.confirmations(plan));
  assert.equal(recovery.files_created,1);
  assert.equal(recovery.recovered,false);
  assert.deepEqual(readFileSync(join(f.out,one.filename)),oldZip);
  assert.equal(f.app.get(f.candidateA.id,'candidate').data.candidate_sha256,
    plan.before_candidate_sha256);
});
test('R54 unrelated source changes do not silently replace historical candidate bytes',async t=>{
  const f=await fixture(t),plan=planReleaseContinuity(f.app,f.input);
  await execute(f.app,'entity.update',{id:f.notes.id,expected:f.notes.version,
    data:{...f.notes.data,content:'Operator edited the current copy after candidate freeze'}});
  await assert.rejects(exportReleaseContinuity(f.app,plan,f.out,f.confirmations(plan)),
    {code:'StaleReference'});
  assert.equal(readdirSync(f.out).length,0);
  assert.equal(f.app.get(f.candidateA.id,'candidate').data.candidate_sha256,
    plan.before_candidate_sha256);
});
test('R54 different product or identical release IDs cannot be compared',async t=>{
  const f=await fixture(t,{secondProduct:true});
  assert.throws(()=>continuityReport(f.app,f.input),{code:'PermissionDenied'});
  assert.throws(()=>continuityReport(f.app,{
    ...f.input,after_release_id:f.input.before_release_id,
    after_candidate_id:f.input.before_candidate_id
  }),{code:'InvalidArgument'});
});
test('R54 exact selected candidate must belong to corresponding Release and copy ambiguities fail closed',async t=>{
  const f=await fixture(t);
  assert.throws(()=>continuityReport(f.app,{
    ...f.input,after_candidate_id:f.candidateA.id
  }),{code:'PermissionDenied'});
  const second=await f.old.create('deliverable',{
    release_id:f.afterRelease.id,name:'Release notes',
    target_id:f.target.id,format:'markdown',content:'Same label, different copy.',
    claim_ids:[],source_ids:[f.afterSource.id]
  });
  const art=(await execute(f.app,'deliverable.render',{id:second.id})).entity;
  const firstArtifact=f.app.get(f.candidateB.data.manifest.artifact_ids[0],'artifact');
  const duplicate=(await execute(f.app,'candidate.freeze',{
    release_id:f.afterRelease.id,name:'Duplicated slot candidate',
    artifact_ids:[firstArtifact.id,art.id],
    destination:'different-local-review',
    contract:{version:'fixture',required_reviewers:1,require_claims_verified:false}
  })).entity;
  assert.throws(()=>continuityReport(f.app,{
    ...f.input,after_candidate_id:duplicate.id
  }),{code:'Conflict'});
});
test('R54 a registered but unverified feature claim stays UNKNOWN across the new release',async t=>{
  const f=await fixture(t,{withUnknownClaim:true});
  const report=continuityReport(f.app,f.input);
  assert.equal(report.after.release_coverage.registered_claims,1);
  assert.equal(report.after.release_coverage.reported_unknown,1);
  assert.equal(report.after.release_coverage.reported_pass,0);
  assert.equal(report.after.candidate_technical,'UNKNOWN');
  assert.equal(report.external_publication_verified,false);
  assert.equal(report.registered_graph_scope_fully_observed,false);
});
test('R54 private plan changes, missing consent and replaced output bytes fail closed',async t=>{
  const f=await fixture(t),plan=planReleaseContinuity(f.app,f.input);
  assert.throws(()=>planReleaseContinuity(f.app,{
    ...f.input,acknowledge_incomplete_coverage:false
  }),{code:'ConsentRequired'});
  assert.throws(()=>verifyReleaseContinuity(f.app,{
    ...plan,after_candidate_sha256:'a'.repeat(64)
  }),{code:'Conflict'});
  await assert.rejects(exportReleaseContinuity(f.app,plan,f.out,{
    ...f.confirmations(plan),acknowledge_private_export:false
  }),{code:'ConsentRequired'});
  assert.deepEqual(readdirSync(f.out),[]);
  const generated=await exportReleaseContinuity(f.app,plan,f.out,f.confirmations(plan));
  writeFileSync(join(f.out,generated.filename),'Overwritten by a different human');
  await assert.rejects(exportReleaseContinuity(f.app,plan,f.out,f.confirmations(plan)),
    {code:'Conflict'});
  assert.equal(readFileSync(join(f.out,generated.filename),'utf8'),
    'Overwritten by a different human');
});
test('R54 private output folder, symlink directory and stale concurrency lock are enforced',async t=>{
  const f=await fixture(t),plan=planReleaseContinuity(f.app,f.input);
  if(process.platform!=='win32'){
    const unsafe=join(f.out,'public');mkdirSync(unsafe,{mode:0o755});chmodSync(unsafe,0o755);
    await assert.rejects(exportReleaseContinuity(f.app,plan,unsafe,f.confirmations(plan)),
      {code:'PermissionDenied'});
    const symlink=join(f.out,'symlink');
    symlinkSync(f.out,symlink);
    await assert.rejects(exportReleaseContinuity(f.app,plan,symlink,f.confirmations(plan)),
      {code:'PermissionDenied'});
    rmSync(unsafe,{recursive:true,force:true});rmSync(symlink);
  }
  const lock=join(f.root,'.release-continuity-export.lock');
  writeFileSync(lock,'another operator running',{mode:0o600});
  await assert.rejects(exportReleaseContinuity(f.app,plan,f.out,f.confirmations(plan)),
    {code:'Conflict'});
  assert.equal(readFileSync(lock,'utf8'),'another operator running');
});
test('R54 malicious operator deliverable title escapes HTML and does not create executable HTML',async t=>{
  const f=await fixture(t,{malicious:true}),plan=planReleaseContinuity(f.app,f.input);
  const result=await exportReleaseContinuity(f.app,plan,f.out,f.confirmations(plan));
  const {html}=await unzip(join(f.out,result.filename));
  assert.ok(html.includes('Release &lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.equal((html.match(/<script/gu)??[]).length,0);
});
test('R54 independent operator CLI plans and exports under exact SHA, never overwrites a private plan',async t=>{
  const f=await fixture(t);
  const planFile=join(f.root,'private-continuity-plan.json');
  const call=args=>spawnSync(process.execPath,['scripts/release-continuity.mjs',...args],
    {cwd:dir,encoding:'utf8',timeout:15000});
  const prepare=[
    'plan','--state',f.root,
    '--before-release',f.old.release.id,'--after-release',f.afterRelease.id,
    '--before-candidate',f.candidateA.id,'--after-candidate',f.candidateB.id,
    '--out',planFile,'--acknowledge-private','--acknowledge-incomplete'
  ];
  const planned=call(prepare);
  assert.equal(planned.status,0,planned.stdout+planned.stderr);
  assert.equal(JSON.parse(planned.stdout).workspace_mutated,false);
  assert.notEqual(call(prepare).status,0);
  if(process.platform!=='win32')assert.equal(statSync(planFile).mode&0o077,0);
  const plan=JSON.parse(readFileSync(planFile,'utf8'));
  const exportArgs=[
    'export','--state',f.root,'--plan',planFile,'--out-dir',f.out,
    '--confirm-plan',plan.plan_sha256,
    '--confirm-before',plan.before_candidate_sha256,
    '--confirm-after',plan.after_candidate_sha256,
    '--acknowledge-export'
  ];
  const output=call(exportArgs);
  assert.equal(output.status,0,output.stdout+output.stderr);
  assert.equal(JSON.parse(output.stdout).files_created,2);
  const replay=call(exportArgs);
  assert.equal(replay.status,0,replay.stdout+replay.stderr);
  assert.equal(JSON.parse(replay.stdout).recovered,true);
});
