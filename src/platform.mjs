// SPDX-License-Identifier: AGPL-3.0-only
// Integration through the real externally supplied Platform Client SDK. No private SDK code is vendored.
import { readFileSync, lstatSync, realpathSync, readdirSync } from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { NativeError, requireCondition as ensure, object } from '@semwright/native-sdk';
import { execute } from './application.mjs';
import { digest } from './contracts.mjs';
import { PLATFORM_READ_ACTIONS, PUBLICATION_ACTIONS, publicationBindingCurrent } from './publish-work.mjs';

export async function loadPlatformClient(env=process.env){
  const packageDir=env.SEMWRIGHT_PLATFORM_SDK,lockPath=env.SEMWRIGHT_PLATFORM_LOCK,configPath=env.SEMWRIGHT_PLATFORM_CONFIG;
  ensure(packageDir&&lockPath&&configPath,'Owner-pinned Platform SDK, lock and identity configuration are required','Unavailable');
  const root=realpathSync(packageDir),lock=JSON.parse(readFileSync(resolve(lockPath),'utf8'));
  ensure(lock.schema_version==='launchwright-platform-sdk-lock/1','Unsupported Platform source lock','ProtocolMismatch');
  ensure(lock.package_version==='0.3.5-dev.1','Platform SDK version is outside the reviewed adapter cut','ProtocolMismatch');
  object(lock.files);ensure(Object.keys(lock.files).length>0,'Empty SDK lock is not accepted');
  for(const [name,sha]of Object.entries(lock.files)){
    ensure(!isAbsolute(name)&&!name.split(/[\\/]/).includes('..'),'Unsafe SDK lock path');const path=join(root,name);
    ensure(!lstatSync(path).isSymbolicLink()&&!relative(root,realpathSync(path)).startsWith('..'),'SDK file resolves outside its pinned package');
    ensure(createHash('sha256').update(readFileSync(path)).digest('hex')===sha,'Platform SDK source digest differs from owner lock','Conflict');
  }
  const requiredFiles=['package.json'];
  function requiredWalk(path){for(const name of readdirSync(path)){const full=join(path,name),st=lstatSync(full);ensure(!st.isSymbolicLink(),'SDK source contains an unpinned symlink');if(st.isDirectory())requiredWalk(full);else if(st.isFile())requiredFiles.push(relative(root,full).replaceAll('\\','/'));}}
  requiredWalk(join(root,'src'));
  ensure(requiredFiles.every(name=>Object.hasOwn(lock.files,name)),'The source lock does not cover the full runtime import tree','Conflict');
  const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));ensure(pkg.name==='@semwright/platform-client'&&pkg.version===lock.package_version,'Wrong Platform Client package','ProtocolMismatch');
  const config=JSON.parse(readFileSync(resolve(configPath),'utf8'));
  object(config,['base_url','identity','allow_insecure_loopback','budget_enforcement_confirmed'],['base_url','identity']);
  const{PlatformClient,VERSION}=await import(pathToFileURL(join(root,'src/index.mjs')).href);
  ensure(VERSION===lock.package_version,'Loaded Platform Client version differs','ProtocolMismatch');
  const client=new PlatformClient({baseUrl:config.base_url,identity:config.identity,allowInsecureLoopback:config.allow_insecure_loopback===true,authentication:{kind:'bearer',credentialProvider:async()=>{
    const token=env.SEMWRIGHT_PLATFORM_TOKEN;ensure(token,'Platform bearer credential has not been provided','PermissionDenied');return token;
  }}});
  return{client,config};
}

export async function runPlatformWork(app,id,{recover=false,client:injected,config:injectedConfig}={}){
  const loaded=injected?{client:injected,config:injectedConfig??{}}:await loadPlatformClient();
  const{client,config}=loaded;let work=app.get(id,'work');
  const action=work.data.action;
  // Backend auth is always checked by the canonical SDK, not by app actor fields.
  await client.verifyIdentity();await client.negotiate([action]);
  if(action.startsWith('publish.')){
    publicationBindingCurrent(app,work);
    if(action==='publish.invoke'){app.allow('consume');ensure(work.data.authorization==='consumer-invocation','Publish invocation was not prepared by the bounded consumer operation','ConsentRequired');}
    else if(PUBLICATION_ACTIONS.has(action)){app.allow('publish');ensure(work.data.authorization==='explicit-publication','Publication intent was not expressly authorized','ConsentRequired');}
    else app.allow('consume');
  }
  // Cost-bearing work requires a real Platform recipe/preflight configuration that enforces its own limits.
  if(['recipes.execute','recipes.prepare'].includes(action))ensure(config.budget_enforcement_confirmed===true,'Platform-side budget enforcement must be configured before a recipe intent can be sent','PolicyDenied');
  if(PLATFORM_READ_ACTIONS.has(action)){
    ensure(!recover&&work.data.state==='PREPARED','This read intent has already been claimed','Conflict');
    const marker={schema_version:'launchwright-read-projection/1',action,arguments:work.data.arguments};
    const claimed=await execute(app,'work.claim',{id,prepared_record:marker});
    try{const result=await client.call(action,work.data.arguments);return await execute(app,'work.complete',{id,result,pending_digest:claimed.pending_digest});}
    catch(err){await execute(app,'work.mark_unknown',{id});throw err;}
  }
  if(recover){
    ensure(['CLAIMED','OUTCOME_UNKNOWN'].includes(work.data.state),'Only an outstanding saved intent can be recovered','Conflict');
    const row=app.store.db.prepare('SELECT record FROM pending WHERE work_id=?').get(id);ensure(row,'Durable pending export is unavailable','NotFound');
    const record=JSON.parse(row.record);ensure(digest('pending',record)===work.data.pending_digest,'Pending request digest changed','Conflict');
    const recovery=await client.recover(record);
    // A recovery response is not the original action response: preserve it as a projection and do not invent job IDs.
    if(recovery.state==='ACCEPTED')return execute(app,'work.complete',{id,result:{recovered:true,recovery},pending_digest:work.data.pending_digest});
    return{work_id:id,state:'OUTCOME_UNKNOWN',recovery,resent:false};
  }
  ensure(work.data.state==='PREPARED','An intent may be sent only once; use --recover','Conflict');
  const record=client.prepareRequest(action,work.data.arguments);
  const serialized=client.exportPending(record);const saved=JSON.parse(serialized);
  // This atomic application transaction commits before any action network send.
  const claimed=await execute(app,'work.claim',{id,prepared_record:saved});
  try{
    const result=await client.sendPrepared(record);
    return await execute(app,'work.complete',{id,result,pending_digest:claimed.pending_digest});
  }catch(err){try{await execute(app,'work.mark_unknown',{id});}catch{}throw err;}
}
