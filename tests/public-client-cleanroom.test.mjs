// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createAppServer } from '../src/server.mjs';
import { CLIENT_VERSION, LaunchwrightClient } from '../client/index.mjs';
import { setup } from './helpers.mjs';

async function server(t){
  const {app}=setup(t);
  const service=createAppServer(app,{port:0,token:'synthetic-cleanroom-token'});
  const baseUrl=await service.listen();
  t.after(()=>service.close());
  return{app,service,baseUrl};
}
function runChild(command,args,options={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{...options,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    child.stdout.on('data',chunk=>stdout+=chunk);
    child.stderr.on('data',chunk=>stderr+=chunk);
    child.once('error',reject);
    child.once('close',(code,signal)=>resolve({code,signal,stdout,stderr}));
  });
}

test('public client validates discovery compatibility and required operations',async t=>{
  const {service,baseUrl}=await server(t);
  const client=new LaunchwrightClient({baseUrl,token:service.token});
  const discovery=await client.connect({requiredOperations:['resource.get','entity.create','events.list']});
  assert.equal(discovery.api.version,'0.2');
  assert.equal(discovery.api.public_client,'@launchwright/client');
  assert.equal(discovery.api.discovery_schema,discovery.schema_version);
  assert.equal(CLIENT_VERSION,'0.2.0-dev.11');
});

test('an older or incompatible client fails closed instead of reinterpreting discovery',async()=>{
  const payload={schema_version:'launchwright-http-discovery/1',app:'Launchwright',version:'0.2.0-dev.11',api:{version:'0.2',discovery_schema:'launchwright-http-discovery/1'},operations:[]};
  const fetchImpl=async()=>new Response(JSON.stringify(payload),{status:200,headers:{'content-type':'application/json'}});
  const oldProtocol=new LaunchwrightClient({baseUrl:'http://127.0.0.1:1',token:'synthetic',fetchImpl,supportedDiscoverySchemas:['launchwright-http-discovery/0']});
  await assert.rejects(oldProtocol.discovery(),{code:'Unsupported'});
  const oldApi=new LaunchwrightClient({baseUrl:'http://127.0.0.1:1',token:'synthetic',fetchImpl,supportedAppApis:['0.1']});
  await assert.rejects(oldApi.discovery(),{code:'Unsupported'});
  const current=new LaunchwrightClient({baseUrl:'http://127.0.0.1:1',token:'synthetic',fetchImpl});
  await assert.rejects(current.discovery({requiredOperations:['publish.invoke']}),{code:'Unsupported'});
});

test('packed public client works from a clean directory without private application imports',async t=>{
  const {service,baseUrl}=await server(t);
  const clean=mkdtempSync(join(tmpdir(),'launchwright-client-cleanroom-'));
  t.after(()=>rmSync(clean,{recursive:true,force:true}));
  const npm=process.platform==='win32'?'npm.cmd':'npm';
  const pack=spawnSync(npm,['pack',join(process.cwd(),'client'),'--pack-destination',clean],{encoding:'utf8'});
  assert.equal(pack.status,0,pack.stderr||pack.stdout);
  const archive=readdirSync(clean).find(name=>name.endsWith('.tgz'));
  assert.ok(archive,'client tarball was not produced');
  const consumer=join(clean,'consumer');mkdirSync(consumer);
  writeFileSync(join(consumer,'package.json'),JSON.stringify({name:'launchwright-cleanroom-consumer',private:true,type:'module'}));
  const install=spawnSync(npm,['install',join(clean,archive),'--ignore-scripts','--no-audit','--no-fund'],{cwd:consumer,encoding:'utf8'});
  assert.equal(install.status,0,install.stderr||install.stdout);
  const installed=join(consumer,'node_modules','@launchwright','client');
  assert.deepEqual(readdirSync(installed).sort(),['index.mjs','package.json']);
  assert.equal(readFileSync(join(installed,'index.mjs'),'utf8').includes('../src/'),false);
  writeFileSync(join(consumer,'consumer.mjs'),`
import { CLIENT_VERSION, LaunchwrightClient } from '@launchwright/client';
const client=new LaunchwrightClient({baseUrl:process.env.LAUNCHWRIGHT_URL,token:process.env.LAUNCHWRIGHT_TOKEN});
const discovery=await client.connect({requiredOperations:['entity.create','resource.get']});
const created=await client.mutate('entity.create',{kind:'product',data:{name:'Clean-room consumer'}},{key:'cleanroom-consumer-create'});
const readback=await client.get(created.entity.id);
console.log(JSON.stringify({client:CLIENT_VERSION,api:discovery.api.version,id:readback.id,name:readback.data.name}));
`);
  const result=await runChild(process.execPath,['consumer.mjs'],{cwd:consumer,env:{...process.env,LAUNCHWRIGHT_URL:baseUrl,LAUNCHWRIGHT_TOKEN:service.token}});
  assert.equal(result.code,0,result.stderr||result.stdout);
  const output=JSON.parse(result.stdout.trim());
  assert.deepEqual({client:output.client,api:output.api,name:output.name},{client:'0.2.0-dev.11',api:'0.2',name:'Clean-room consumer'});
});
