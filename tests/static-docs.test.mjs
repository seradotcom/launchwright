// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync,rmSync,readFileSync,writeFileSync,
  readdirSync,mkdirSync,chmodSync,symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import { execute } from '../src/application.mjs';
import { makeOwnedStaticDocsFixture } from './static-docs-fixture.mjs';
import { parseStaticDocsMarkdown,renderStaticDocs } from '../src/static-docs-view.mjs';
import { planStaticDocs,verifyStaticDocsPlan,exportStaticDocs } from '../src/static-docs.mjs';

const hash=x=>createHash('sha256').update(x).digest('hex');
const cwd=fileURLToPath(new URL('../',import.meta.url));
async function fixture(t,opts={}){
  const root=mkdtempSync(join(tmpdir(),'launchwright-r45-suite-'));
  const f=await makeOwnedStaticDocsFixture({root,...opts});
  t.after(()=>{try{f.app.close();}catch{}rmSync(root,{
    recursive:true,force:true,maxRetries:5,retryDelay:50
  });});
  return f;
}
const readArchive=async(f,receipt)=>{
  const name='launchwright-docs-'+receipt.plan_sha256.slice(0,12)+'.zip';
  const bytes=readFileSync(join(f.output,name));
  const zip=await JSZip.loadAsync(bytes,{checkCRC32:true});
  const manifest=JSON.parse(await zip.file('manifest.json').async('string'));
  return{zip,bytes,manifest};
};
test('R45 public-safe plan binds exact candidate, release build, Markdown digests and internal link graph without mutation',async t=>{
  const f=await fixture(t);
  const plan=await planStaticDocs(f.app,f.input);
  assert.deepEqual(await planStaticDocs(f.app,f.input),plan);
  assert.deepEqual(await verifyStaticDocsPlan(f.app,plan),plan);
  assert.equal(plan.page_count,4);
  assert.equal(plan.pages.length,3);
  assert.equal(plan.release_build,f.release.data.build);
  assert.equal(plan.candidate_sha256,f.candidate.data.candidate_sha256);
  assert.equal(plan.technical_state,'UNKNOWN');
  assert.equal(plan.link_validation_performed,true);
  assert.equal(plan.network_access,false);
  assert.equal(plan.publication_authority,false);
  assert.equal(plan.platform_authority,false);
  assert.equal(f.app.list('artifact',f.release.id).length,3);
  assert.equal(f.app.list('channel_delivery').length,0);
  assert.deepEqual(readdirSync(f.output),[]);
  assert.ok(!JSON.stringify(plan).includes(f.root));
});
test('R45 exported offline ZIP has four valid no-script HTML pages, safe local links and exact source/receipt hashes',async t=>{
  const f=await fixture(t),plan=await planStaticDocs(f.app,f.input);
  const receipt=await exportStaticDocs(f.app,plan,f.output,f.approve(plan));
  assert.equal(receipt.files_created,2);
  assert.equal(receipt.html_pages,4);
  assert.equal(receipt.published,false);
  assert.equal(receipt.technical_state,'UNKNOWN');
  const {zip,bytes,manifest}=await readArchive(f,receipt);
  assert.equal(hash(bytes),receipt.archive_sha256);
  assert.equal(zip.file('index.html')!==null,true);
  assert.deepEqual(Object.keys(zip.files).sort(),[
    'api.html','index.html','manifest.json','review.html','start.html'
  ]);
  assert.equal(manifest.links_verified,true);
  assert.equal(manifest.code_samples_inert,true);
  assert.equal(manifest.internet_required,false);
  assert.equal(manifest.pages.length,3);
  assert.equal(manifest.release_build,f.release.data.build);
  assert.equal(manifest.candidate_sha256,f.candidate.data.candidate_sha256);
  for(const slug of ['start','api','review']){
    const html=await zip.file(slug+'.html').async('string');
    assert.ok(html.includes('<nav aria-label="Documentation sections">'));
    assert.ok(html.includes("script-src &#39;none&#39;"));
    assert.ok(html.includes("connect-src &#39;none&#39;"));
    assert.ok(html.includes('<a class="skip" href="#main-content">'));
    assert.ok(!/<script\b|<iframe\b|<img\b|https?:\/\//iu.test(html));
    assert.ok(html.includes('TECHNICAL UNKNOWN')===false ||
      html.includes('Technical UNKNOWN'));
    assert.ok(html.includes('Private docs'));
    assert.ok(!html.includes(f.root));
  }
  const overview=await zip.file('start.html').async('string');
  assert.ok(overview.includes('<a href="./api.html">API guide</a>'));
  assert.ok(overview.includes('<pre><code data-language="bash">npm run start</code></pre>'));
  assert.ok(overview.includes('aria-current="page"'));
  assert.ok(overview.includes('source-note'));
  assert.ok(!overview.includes('<p>&gt;</p>'),
    'Native Markdown blockquote trailing marker is not a visible content item');
  assert.equal(f.app.list('channel_delivery').length,0);
});
test('R45 binary deterministic ZIP across independent runs and exact-source recovery after partial file loss',async t=>{
  const f=await fixture(t),plan=await planStaticDocs(f.app,f.input);
  const first=await exportStaticDocs(f.app,plan,f.output,f.approve(plan));
  await new Promise(resolve=>setTimeout(resolve,1300));
  const again=await exportStaticDocs(f.app,plan,f.output,f.approve(plan));
  assert.equal(again.archive_sha256,first.archive_sha256);
  assert.equal(again.files_created,0);
  assert.equal(again.recovered,true);
  const receipt='launchwright-docs-'+plan.plan_sha256.slice(0,12)+'.receipt.json';
  rmSync(join(f.output,receipt));
  const recovered=await exportStaticDocs(f.app,plan,f.output,f.approve(plan));
  assert.equal(recovered.files_created,1);
  assert.equal(recovered.archive_sha256,first.archive_sha256);
  assert.equal(f.app.list('channel_delivery').length,0);
});
test('R45 missing or external hyperlinks fail before any disk mutation or invented substitute',async t=>{
  const f=await fixture(t);
  for(const content of [
    '## Unsafe\nSee [here](https://example.com/api) and run a code sample.',
    '## Broken\nRead [the missing page](./missing.html) for details.',
    '## Unsafe\nFollow [download](javascript:alert(1)).',
    '## Path escape\nRead [secret](../private.html).',
    '## Markup\n<img src=x onerror=alert(1)>',
    '## Images\n![diagram](./api.html)',
    '## Code\n~~~bash\nuname -a\n',
    '## Table\n| A | B |',
    '## Unreadable\n'+('a'.repeat(350)),
    '## Untrusted\nText with a control '+String.fromCharCode(27)+' is rejected'
  ]){
    const source=Buffer.from('# Docs\n\n'+content);
    assert.throws(()=>parseStaticDocsMarkdown(source,new Set(['start','api'])),
      'Unsupported source failed to be rejected: '+content.slice(0,60));
  }
  assert.deepEqual(readdirSync(f.output),[]);
});
test('R45 missing editorial approval and technical UNKNOWN acknowledgements fail closed',async t=>{
  const f=await fixture(t,{review:false});
  await assert.rejects(planStaticDocs(f.app,f.input),{code:'ConsentRequired'});
  assert.equal(readdirSync(f.output).length,0);
  await execute(f.app,'candidate.review',{
    id:f.candidate.id,candidate_sha256:f.candidate.data.candidate_sha256,
    decision:'approve-editorial',comment:'Synthetic authorized doc test'
  });
  await assert.rejects(planStaticDocs(f.app,{
    ...f.input,acknowledge_unverified:false
  }),{code:'ConsentRequired'});
  await assert.rejects(planStaticDocs(f.app,{
    ...f.input,acknowledge_draft_only:false
  }),{code:'ConsentRequired'});
  await assert.rejects(planStaticDocs(f.app,{
    ...f.input,acknowledge_source_rights:false
  }),{code:'ConsentRequired'});
});
test('R45 plan tamper, output permission and wrong independent confirmations reject without writing',async t=>{
  const f=await fixture(t),plan=await planStaticDocs(f.app,f.input);
  await assert.rejects(verifyStaticDocsPlan(f.app,{
    ...plan,output_zip_bytes:42
  }),{code:'Conflict'});
  await assert.rejects(exportStaticDocs(f.app,plan,f.output,{
    ...f.approve(plan),confirm_plan_sha256:'a'.repeat(64)
  }),{code:'ConsentRequired'});
  await assert.rejects(exportStaticDocs(f.app,plan,f.output,{
    ...f.approve(plan),acknowledge_private_export:false
  }),{code:'ConsentRequired'});
  if(process.platform!=='win32'){
    const exposed=join(f.root,'exposed');mkdirSync(exposed,{mode:0o755});
    chmodSync(exposed,0o755);
    await assert.rejects(exportStaticDocs(f.app,plan,exposed,f.approve(plan)),
      {code:'PermissionDenied'});
    const link=join(f.root,'bad-link');symlinkSync(f.output,link);
    await assert.rejects(exportStaticDocs(f.app,plan,link,f.approve(plan)),
      {code:'PermissionDenied'});
  }
  assert.deepEqual(readdirSync(f.output),[]);
});
test('R45 preexisting edited ZIP or symlink are never overwritten; lock prevents concurrent exports',async t=>{
  const f=await fixture(t),plan=await planStaticDocs(f.app,f.input);
  const first=await exportStaticDocs(f.app,plan,f.output,f.approve(plan));
  const name='launchwright-docs-'+plan.plan_sha256.slice(0,12)+'.zip';
  writeFileSync(join(f.output,name),'human-edited archive');
  await assert.rejects(exportStaticDocs(f.app,plan,f.output,f.approve(plan)),{code:'Conflict'});
  assert.equal(readFileSync(join(f.output,name),'utf8'),'human-edited archive');
  const lock=join(f.app.store.root,'.static-docs-apply.lock');
  writeFileSync(lock,'someone else owns this lock',{mode:0o600});
  await assert.rejects(exportStaticDocs(f.app,plan,f.output,f.approve(plan)),{code:'Conflict'});
  assert.equal(readFileSync(lock,'utf8'),'someone else owns this lock');
});
test('R45 two releases within same product retain separate fully version-pinned sites; second release cannot overwrite first',async t=>{
  const root=mkdtempSync(join(tmpdir(),'launchwright-r45-continuity-'));
  const v1=await makeOwnedStaticDocsFixture({root,releaseName:'1.0',build:'build-A'});
  const v2=await makeOwnedStaticDocsFixture({
    app:v1.app,root,product:v1.product,releaseName:'2.0',build:'build-B',
    pages:[
      {slug:'start',title:'Getting started version two',
        content:'## Changes\nRead [API v2](./api.html). Use the version-specific command.\n~~~bash\nnpm run start:v2\n~~~'},
      {slug:'api',title:'API guide version two',
        content:'## Endpoint\nSee [start](./start.html).\n~~~json\n{"version":2}\n~~~'}
    ]
  });
  t.after(()=>{try{v1.app.close();}catch{}rmSync(root,{
    recursive:true,force:true,maxRetries:5,retryDelay:50
  });});
  const p1=await planStaticDocs(v1.app,v1.input),
    p2=await planStaticDocs(v2.app,v2.input);
  assert.notEqual(p1.plan_sha256,p2.plan_sha256);
  const old=await exportStaticDocs(v1.app,p1,v1.output,v1.approve(p1));
  const oldBytes=(await readArchive(v1,old)).bytes;
  const newer=await exportStaticDocs(v2.app,p2,v2.output,v2.approve(p2));
  const {zip}=await readArchive(v2,newer);
  assert.ok((await zip.file('start.html').async('string')).includes('start:v2'));
  assert.ok(!oldBytes.includes('start:v2'));
  assert.equal(hash((await readArchive(v1,old)).bytes),hash(oldBytes));
  assert.equal(old.release_build,'build-A');
  assert.equal(newer.release_build,'build-B');
  assert.equal(v1.app.list('channel_delivery').length,0);
});
test('R45 changed frozen input, wrong target or duplicated artifacts cannot produce a misleading site',async t=>{
  const f=await fixture(t),plan=await planStaticDocs(f.app,f.input);
  await assert.rejects(planStaticDocs(f.app,{
    ...f.input,pages:[
      {slug:'one',artifact_id:f.artifacts[0].id},
      {slug:'one',artifact_id:f.artifacts[1].id}
    ]
  }),{code:'InvalidArgument'});
  await assert.rejects(planStaticDocs(f.app,{
    ...f.input,pages:[
      {slug:'start',artifact_id:f.artifacts[0].id},
      {slug:'api',artifact_id:f.artifacts[0].id}
    ]
  }),{code:'Conflict'});
  await execute(f.app,'entity.update',{
    id:f.deliverables[0].id,expected:f.deliverables[0].version,
    data:{...f.deliverables[0].data,content:'Editorial copy revised after approval'}
  });
  await assert.rejects(exportStaticDocs(f.app,plan,f.output,f.approve(plan)));
  assert.deepEqual(readdirSync(f.output),[]);
});
test('R45 page text escaping preserves literal source but prevents script execution and unauthorized links',()=>{
  const pages=new Set(['start','api']);
  const content=parseStaticDocsMarkdown(Buffer.from(
    '# Source safety\n## What the text says\nLiteral text <script>alert(1)</script> must remain escaped.\n'+
    '~~~html\n<img src=x onerror=alert(1)>\n~~~\n'+
    'Read the [API](./api.html) page.'),pages);
  assert.ok(content.html.includes('&lt;script&gt;'));
  assert.ok(content.html.includes('&lt;img'));
  assert.ok(!content.html.includes('<script>'));
  assert.ok(!content.html.includes('<img'));
  assert.deepEqual(content.links,['api']);
  assert.equal(content.codeSamples,1);
});


test('R45 two-phase operator CLI creates a private plan and never overwrites it or an edited site',async t=>{
  const f=await fixture(t);
  const pages=join(f.root,'private-docs-pages.json'),
    planFile=join(f.root,'private-docs-plan.json');
  writeFileSync(pages,JSON.stringify(f.input.pages),{mode:0o600});
  const cli=args=>spawnSync(process.execPath,['scripts/static-docs.mjs',...args],{
    cwd,encoding:'utf8',timeout:35000
  });
  const planArgs=['plan','--state',f.root,'--candidate',f.candidate.id,
    '--pages-file',pages,'--out',planFile,
    '--acknowledge-draft','--acknowledge-source-rights','--acknowledge-unknown'];
  const planned=cli(planArgs);
  assert.equal(planned.status,0,planned.stdout+planned.stderr);
  const privatePlan=JSON.parse(readFileSync(planFile,'utf8'));
  assert.equal(JSON.parse(planned.stdout).workspace_mutated,false);
  assert.equal(privatePlan.release_build,f.release.data.build);
  assert.notEqual(cli(planArgs).status,0,'A private intent file cannot be overwritten');
  const applyArgs=['export','--state',f.root,'--plan-file',planFile,
    '--out-dir',f.output,'--confirm-plan',privatePlan.plan_sha256,
    '--confirm-candidate',privatePlan.candidate_sha256,'--acknowledge-private-export'];
  const first=cli(applyArgs);
  assert.equal(first.status,0,first.stdout+first.stderr);
  const result=JSON.parse(first.stdout);
  assert.equal(result.files_created,2);
  const again=cli(applyArgs);
  assert.equal(again.status,0,again.stdout+again.stderr);
  assert.equal(JSON.parse(again.stdout).recovered,true);
  const collision=join(f.output,'launchwright-docs-'+privatePlan.plan_sha256.slice(0,12)+'.zip');
  writeFileSync(collision,'Edited document');
  assert.notEqual(cli(applyArgs).status,0);
  assert.equal(readFileSync(collision,'utf8'),'Edited document');
  assert.equal(f.app.list('channel_delivery').length,0);
});


test('R45 direct offline renderer also rejects traversal/HTML slugs before materializing pages',async()=>{
  const source=Buffer.from('# Page\n## Example\n~~~bash\nnpm test\n~~~\nSee [page](./api.html)');
  await assert.rejects(renderStaticDocs([
    {slug:'../../secrets',artifact_id:'artifact_fixture',bytes:source},
    {slug:'api',artifact_id:'artifact_fixture_2',bytes:source}
  ],{
    release_id:'release_fixture',release_version:{revision:'1'},build:'build-fixture',
    candidate_id:'candidate_fixture',shaValue:'a'.repeat(64),locale:'en-US',
    release:'Owned synthetic release',technical_state:'UNKNOWN'
  }),{code:'Conflict'});
});
