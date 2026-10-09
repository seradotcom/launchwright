// SPDX-License-Identifier: AGPL-3.0-only
// Real official MCP stdio Client ↔ separate Launchwright MCP process ↔ public
// Launchwright HTTP Client ↔ canonical Native SDK workspace.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { LaunchwrightClient } from '../client/index.mjs';
import { createAppServer } from '../src/server.mjs';
import { createLaunchwrightMcpTools,createMcpPendingJournal,readLocalMcpToken,
  localLoopbackUrl } from '../src/mcp-public-tools.mjs';
import { setup, baseline } from './helpers.mjs';

const codeRoot=fileURLToPath(new URL('../',import.meta.url));
const OWNER='synthetic-local-mcp-owner-1234567890';
function response(result){
  assert.notEqual(result?.isError,true);
  assert.equal(result.content?.[0]?.type,'text');
  return JSON.parse(result.content[0].text);
}
async function fixture(t){
  const {app,root}=setup(t);
  const service=createAppServer(app,{port:0,token:OWNER});
  const url=await service.listen();
  t.after(()=>service.close());
  const tokenFile=join(root,'owner.token');
  writeFileSync(tokenFile,OWNER+'\n',{mode:0o600,flag:'wx'});
  const pendingDir=join(root,'mcp-pending');
  mkdirSync(pendingDir,{mode:0o700});
  const client=new LaunchwrightClient({baseUrl:url,token:OWNER});
  return{app,root,service,url,tokenFile,pendingDir,client};
}
async function connectMcp(t,fixtureData){
  const client=new Client({name:'launchwright-external-mcp-consumer-test',version:'1.0.0'},
    {capabilities:{}});
  const transport=new StdioClientTransport({
    command:process.execPath,
    args:['scripts/mcp-local.mjs','--url',fixtureData.url,
      '--token-file',fixtureData.tokenFile,'--pending-dir',fixtureData.pendingDir],
    cwd:codeRoot,stderr:'pipe'
  });
  await client.connect(transport);
  t.after(async()=>{try{await client.close();}catch{}});
  return client;
}
const call=(client,name,args={})=>client.callTool({name,arguments:args});

test('R38 official MCP SDK client negotiates a separate stdio server and reads real workspace via public Client SDK',async t=>{
  const f=await fixture(t),remote=await connectMcp(t,f);
  const list=await remote.listTools();
  const tools=list.tools.map(x=>x.name);
  assert.equal(tools.length,10);
  assert.ok(tools.includes('launchwright_describe'));
  assert.ok(tools.includes('launchwright_prepare'));
  assert.ok(tools.includes('launchwright_recover'));
  assert.ok(tools.includes('launchwright_history'));
  assert.ok(tools.includes('launchwright_channel'));
  assert.ok(!tools.some(x=>x.includes('publish')||x.includes('approve')));
  assert.ok(!JSON.stringify(list).includes(f.tokenFile));
  assert.ok(!JSON.stringify(list).includes(OWNER));
  const descriptor=response(await call(remote,'launchwright_describe'));
  assert.equal(descriptor.native_sdk,'1.0.0');
  const initial=response(await call(remote,'launchwright_list',{limit:5}));
  assert.deepEqual(initial.items,[]);
  assert.equal(f.app.store.all().length,0);
});

test('R38 MCP prepare → persisted exact digest → independently confirmed submit → SDK read',async t=>{
  const f=await fixture(t),remote=await connectMcp(t,f);
  const prepared=response(await call(remote,'launchwright_prepare',{
    operation:'entity.create',input:{kind:'product',
      data:{name:'MCP public-client owned product'}}
  }));
  assert.equal(prepared.schema_version,'launchwright-mcp-intent/1');
  assert.equal(prepared.durably_saved_before_send,true);
  assert.equal(prepared.mutation_performed,false);
  assert.match(prepared.request_sha256,/^[0-9a-f]{64}$/);
  assert.equal(f.app.list('product').length,0);
  assert.equal(readdirSync(f.pendingDir).length,1);
  const pendingName=readdirSync(f.pendingDir)[0];
  if(process.platform!=='win32'){
    const {statSync}=await import('node:fs');
    assert.equal(statSync(join(f.pendingDir,pendingName)).mode&0o077,0);
  }
  let bad=await call(remote,'launchwright_submit',{
    intent_key:prepared.intent_key,request_sha256:prepared.request_sha256,acknowledge_send:false
  });
  assert.equal(bad.isError,true);
  bad=await call(remote,'launchwright_submit',{
    intent_key:prepared.intent_key,request_sha256:'a'.repeat(64),acknowledge_send:true
  });
  assert.equal(bad.isError,true);
  assert.equal(f.app.list('product').length,0);
  const submitted=response(await call(remote,'launchwright_submit',{
    intent_key:prepared.intent_key,request_sha256:prepared.request_sha256,
    acknowledge_send:true
  }));
  assert.equal(submitted.schema_version,'launchwright-mcp-submission/1');
  assert.equal(submitted.result.entity.kind,'product');
  assert.equal(f.app.list('product').length,1);
  assert.deepEqual(readdirSync(f.pendingDir),[]);
  const read=response(await call(remote,'launchwright_get',{id:submitted.result.entity.id}));
  assert.equal(read.data.name,'MCP public-client owned product');
  const inventory=response(await call(remote,'launchwright_list',{limit:12}));
  assert.equal(inventory.items.length,1);
});

test('R38 MCP denies approval/publication tools, invalid IDs and unsafe arbitrary operations',async t=>{
  const f=await fixture(t),remote=await connectMcp(t,f);
  for(const operation of ['candidate.review','channel.record_outcome','work.claim',
    'publish.deployment_create','usage.adjust','capture.ingest']){
    const err=await call(remote,'launchwright_prepare',{operation,input:{}});
    assert.equal(err.isError,true,operation);
  }
  const approval=await call(remote,'launchwright_send_approval',{id:'foo'});
  assert.equal(approval.isError,true);
  const path=await call(remote,'launchwright_get',{id:'../../etc/passwd'});
  assert.equal(path.isError,true);
  const many=await call(remote,'launchwright_list',{limit:500});
  assert.equal(many.isError,true);
  assert.equal(f.app.store.all().length,0);
});

test('R38 simulated lost HTTP ACK retains one private intent and read-only recovery never re-sends',async t=>{
  const f=await fixture(t);
  const journal=createMcpPendingJournal(f.pendingDir);
  let invoked=0;
  const client=new LaunchwrightClient({
    baseUrl:f.url,token:OWNER,pendingStore:journal,
    fetchImpl:async(url,options)=>{
      const res=await fetch(url,options);
      if(String(url).endsWith('/api/v1/invoke')){
        invoked++;
        throw Error('Synthetic response dropped after successful backend commit');
      }
      return res;
    }
  });
  const tools=createLaunchwrightMcpTools(client,journal);
  const p=response(await tools.call('launchwright_prepare',{
    operation:'entity.create',
    input:{kind:'product',data:{name:'MCP ACK-loss fixture'}}
  }));
  const first=await tools.call('launchwright_submit',{
    intent_key:p.intent_key,request_sha256:p.request_sha256,
    acknowledge_send:true
  });
  assert.equal(first.isError,true);
  assert.equal(f.app.list('product').length,1);
  assert.equal(readdirSync(f.pendingDir).length,1);
  const recovered=response(await tools.call('launchwright_recover',{
    intent_key:p.intent_key
  }));
  assert.equal(recovered.state,'recorded');
  assert.equal(recovered.result.entity.kind,'product');
  assert.equal(recovered.mutation_resubmitted,false);
  assert.equal(invoked,1);
  assert.equal(f.app.list('product').length,1);
  assert.equal(readdirSync(f.pendingDir).length,0);
});

test('R38 unknown request lookup remains pending for operator recovery rather than automatic re-send',async t=>{
  const f=await fixture(t);
  const journal=createMcpPendingJournal(f.pendingDir);
  const tools=createLaunchwrightMcpTools(f.client,journal);
  const p=response(await tools.call('launchwright_prepare',{
    operation:'entity.create',
    input:{kind:'product',data:{name:'Recovery was never submitted'}}
  }));
  const recovery=response(await tools.call('launchwright_recover',{intent_key:p.intent_key}));
  assert.notEqual(recovery.state,'recorded');
  assert.equal(recovery.mutation_resubmitted,false);
  assert.equal(f.app.list('product').length,0);
  assert.equal(readdirSync(f.pendingDir).length,1);
});

test('R38 private token, local URL and custody permissions are fail-closed',async t=>{
  const f=await fixture(t);
  assert.equal(readLocalMcpToken(f.tokenFile),OWNER);
  assert.equal(localLoopbackUrl(f.url),f.url);
  for(const url of ['http://evil.example:4317','https://127.0.0.1:4317',
    'http://127.0.0.1:4317/path','http://localhost:4317?secret=true',
    'http://127.0.0.1:99999']){
    assert.throws(()=>localLoopbackUrl(url));
  }
  if(process.platform!=='win32'){
    chmodSync(f.tokenFile,0o644);
    assert.throws(()=>readLocalMcpToken(f.tokenFile),/private permissions/u);
    chmodSync(f.tokenFile,0o600);
    chmodSync(f.pendingDir,0o755);
    assert.throws(()=>createMcpPendingJournal(f.pendingDir),/private permissions/u);
  }
});

test('R38 public MCP adapter cannot import application/SQLite/SDK internals',()=>{
  const read=name=>readFileSync(join(codeRoot,name),'utf8');
  const server=read('scripts/mcp-local.mjs'),
    tools=read('src/mcp-public-tools.mjs');
  assert.ok(server.includes("@modelcontextprotocol/sdk/server"));
  assert.ok(server.includes("../client/index.mjs"));
  assert.ok(tools.includes("../client/index.mjs"));
  for(const text of [server,tools]){
    assert.ok(!text.includes("from '../src/application.mjs'"));
    assert.ok(!text.includes('node:sqlite'));
    assert.ok(!text.includes('child_process'));
    assert.ok(!text.includes('publish.deploy'));
  }
});


test('R38 another real MCP Client edits the SAME Release/Claim observed by the independent HTTP client',async t=>{
  const f=await fixture(t),b=await baseline(f.app);
  const mcp=await connectMcp(t,f);
  const original=await f.client.get(b.release.id);
  const intended={...original.data,notes:'Source-linked release brief updated via MCP public client'};
  const prepare=response(await call(mcp,'launchwright_prepare',{
    operation:'entity.update',input:{
      id:original.id,expected:original.version,data:intended
    }
  }));
  assert.equal((await f.client.get(original.id)).data.notes,undefined);
  const submitted=response(await call(mcp,'launchwright_submit',{
    intent_key:prepare.intent_key,request_sha256:prepare.request_sha256,
    acknowledge_send:true
  }));
  assert.equal(submitted.result.entity.id,original.id);
  const httpRead=await f.client.get(original.id);
  assert.equal(httpRead.data.notes,intended.notes);
  assert.notDeepEqual(httpRead.version,original.version);
  const mcpRead=response(await call(mcp,'launchwright_get',{id:original.id}));
  assert.deepEqual(mcpRead.version,httpRead.version);
  const impact=response(await call(mcp,'launchwright_impact',{release_id:original.id}));
  assert.ok(impact,'Canonical visible release impact is readable, not executed');
  const channel=response(await call(mcp,'launchwright_channel',{release_id:original.id}));
  assert.equal(channel.external_send_performed,false);
  const history=response(await call(mcp,'launchwright_history',{after:0,limit:24}));
  assert.ok(history.items.some(e=>e.operation==='entity.update'));
  const p2=await f.client.get(b.deliverable.id);
  assert.equal(p2.data.name,'Release notes');
  // The Claim under the same Release is also a public, independent resource,
  // not a shadow MCP-specific object.
  const claim=(await f.client.mutate('entity.create',{kind:'claim',data:{
    release_id:b.release.id,name:'MCP-reviewed claim',
    text:'Synthetic source-specific wording',target_id:b.target.id,
    category:'editorial',evidence_ids:[]
  }})).entity;
  const editClaim=response(await call(mcp,'launchwright_prepare',{
    operation:'entity.update',
    input:{id:claim.id,expected:claim.version,
      data:{...claim.data,text:'Human-review-required wording prepared by MCP'}}
  }));
  const written=response(await call(mcp,'launchwright_submit',{
    intent_key:editClaim.intent_key,request_sha256:editClaim.request_sha256,
    acknowledge_send:true
  }));
  assert.equal(written.result.entity.id,claim.id);
  const otherClientClaim=await f.client.get(claim.id);
  assert.equal(otherClientClaim.data.text,'Human-review-required wording prepared by MCP');
  assert.deepEqual(response(await call(mcp,'launchwright_get',{id:claim.id})).version,
    otherClientClaim.version);
});

test('R38 pagination budgets cannot be used to fetch unlimited events or unbounded workspace reads',async t=>{
  const f=await fixture(t),mcp=await connectMcp(t,f);
  for(const args of [{limit:1000},{after:-1},{after:0,limit:0}]){
    const response=await call(mcp,'launchwright_history',args);
    assert.equal(response.isError,true);
  }
  assert.equal((await call(mcp,'launchwright_get',{id:'?'})).isError,true);
  assert.equal(f.app.store.all().length,0);
});
