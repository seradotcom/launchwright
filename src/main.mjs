#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import { resolve, join } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { LaunchwrightApplication, execute } from './application.mjs';
import { createAppServer, localToken } from './server.mjs';
import { makeRequest, RESOURCE, APP_VERSION } from './contracts.mjs';
import { applicationContext, dispatchApplication } from '@semwright/native-sdk';
import { exportSnapshot, restoreSnapshot } from './snapshot.mjs';
const here=fileURLToPath(new URL('..',import.meta.url));
const [command='help',...args]=process.argv.slice(2);
function option(name,fallback){const i=args.indexOf('--'+name);if(i>=0){if(!args[i+1]||args[i+1].startsWith('--'))throw Error(`Missing --${name} value`);return args[i+1];}return fallback;}
const root=resolve(option('state',process.env.LAUNCHWRIGHT_STATE??'.state'));
const print=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
async function main(){
  if(command==='help'){console.log(`Launchwright ${APP_VERSION} — AGPL-3.0-only\n\nCommands:\n  init [--state DIR]                 Create an empty local workspace\n  serve [--state DIR] [--port 4317]  Serve on loopback only\n  doctor [--state DIR]               Report actual capabilities; no repairs\n  snapshot --out FILE [--state DIR]  Export a portable offline recovery snapshot\n  restore --snapshot FILE --state DIR Restore into a new workspace; old request receipts stay inactive\n  list [--kind KIND] [--state DIR]   Read paginated native observations\n  call --operation NAME --input FILE [--request KEY] [--state DIR]\n  prepare --operation NAME --input FILE --out FILE [--state DIR]\n  send --prepared FILE [--state DIR]  Send exactly one saved native intent\n  recover --prepared FILE [--state DIR]\n  demo [--state DIR]                 Create synthetic editorial examples, NOT captures\n  platform --work ID [--recover] [--state DIR]\n\nHeavy compilation, browser tests and Host conformance belong to GitHub Actions.\n`);return;}
  if(command==='init'){const app=new LaunchwrightApplication(root,{initialize:true});app.close();localToken(root);print({state:root,created_or_opened:true,session_token_file:join(root,'session-token')});return;}
  if(command==='doctor'){
    const parts=process.versions.node.split('.').map(Number),supported=parts[0]===24&&(parts[1]>21||(parts[1]===21&&parts[2]>=0));
    const lock=JSON.parse(readFileSync(join(here,'SOURCE_LOCK.json'),'utf8'));
    print({app:'Launchwright',node:process.versions.node,canonical_sdk_engine_supported:supported,required_node:'>=24.21.0 <25',sqlite:process.versions.sqlite??null,state_initialized:existsSync(join(root,'launchwright.sqlite3')),native_sdk:lock.native_sdk??lock.sem_wright_sdk,platform_sdk_configured:!!process.env.SEMWRIGHT_PLATFORM_SDK,platform_connected:false,native_host_accepted:false,external_delivery:false,heavy_checks:'NOT_RUN_BY_DOCTOR',warnings:supported?[]:['Supplemental local checks on this engine are not canonical SDK engine acceptance.']});return;
  }
  if(command==='restore'){
    const source=option('snapshot',null);if(!source)throw Error('--snapshot is required');
    const snapshot=JSON.parse(readFileSync(resolve(source),'utf8'));print(restoreSnapshot(root,snapshot));return;
  }
  if(command==='serve'){
    const port=Number(option('port','4317'));if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Port must be 1024–65535');
    const app=new LaunchwrightApplication(root),service=createAppServer(app,{port});const url=await service.listen();
    console.log(`Launchwright: ${url}\nUnlock with the token stored in ${join(root,'session-token')}\nLocal-only mode; no external publication or runtime acceptance inferred.`);
    const close=async()=>{await service.close();app.close();process.exit(0);};process.once('SIGINT',close);process.once('SIGTERM',close);return;
  }
  const app=new LaunchwrightApplication(root);try{
    if(command==='snapshot'){
      const out=option('out',null);if(!out)throw Error('--out is required');const target=resolve(out);const snapshot=exportSnapshot(app);
      writeFileSync(target,JSON.stringify(snapshot,null,2)+'\n',{flag:'wx',mode:0o600});print({saved:target,digest:snapshot.digest,entities:snapshot.entities.length,blobs:snapshot.blobs.length,pending:snapshot.pending.length});return;
    }
    if(command==='list'){
      let cursor=null;do{const page=await dispatchApplication(app,'observe',null,{resource:RESOURCE,scope:option('kind','all'),limit:64,cursor},applicationContext(randomUUID()));print(page);cursor=page.next;}while(cursor);return;
    }
    if(command==='demo'){const{seedDemo}=await import('../fixtures/seed.mjs');print(await seedDemo(app));return;}
    if(command==='platform'){const{runPlatformWork}=await import('./platform.mjs');print(await runPlatformWork(app,option('work',null),{recover:args.includes('--recover')}));return;}
    if(command==='call'||command==='prepare'){
      const operation=option('operation',null),inputPath=option('input',null);if(!operation||!inputPath)throw Error('--operation and --input are required');
      const input=JSON.parse(readFileSync(resolve(inputPath),'utf8'));
      if(command==='call'){print(await execute(app,operation,input,{key:option('request',randomUUID())}));return;}
      const out=option('out',null);if(!out)throw Error('--out is required to retain the request before sending');
      const expected=app.store.version(),envelope={schema_version:'launchwright-prepared/1',operation,expected,args:makeRequest(operation,input,expected,app.store.meta().epoch)};
      writeFileSync(resolve(out),JSON.stringify(envelope,null,2)+'\n',{flag:'wx',mode:0o600});print({saved:resolve(out),key:envelope.args.request.key,sent:false});return;
    }
    if(command==='send'||command==='recover'){
      const p=JSON.parse(readFileSync(resolve(option('prepared','')),'utf8'));
      if(command==='recover'){print(await dispatchApplication(app,'lookup',null,p.args.request,applicationContext(randomUUID())));return;}
      print(await dispatchApplication(app,'invoke',p.operation,p.args,applicationContext(p.args.request.key,p.expected)));return;
    }
    throw Error('Unknown command. Run node src/main.mjs help');
  }finally{app.close();}
}
main().catch(err=>{print({error:{code:err.code??'InvalidArgument',message:err.message,outcome_known:err.outcomeKnown??true}});process.exitCode=1;});
