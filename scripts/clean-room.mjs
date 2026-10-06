#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot=dirname(dirname(fileURLToPath(import.meta.url)));
const main=join(repoRoot,'src/main.mjs');
const root=mkdtempSync(join(tmpdir(),'launchwright-clean-room-'));
const source=join(root,'source'),restored=join(root,'restored'),snapshot=join(root,'portable.json');
const inherited=Object.fromEntries(['PATH','Path','SystemRoot','WINDIR','TEMP','TMP'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
const childEnv={...inherited};

function cli(args){
  const result=spawnSync(process.execPath,[main,...args],{cwd:repoRoot,env:childEnv,encoding:'utf8',maxBuffer:4*1024*1024});
  if(result.status!==0)throw new Error(`CLI failed (${args.join(' ')}): ${result.stderr}\n${result.stdout}`);
  try{return JSON.parse(result.stdout);}
  catch{throw new Error(`CLI returned non-JSON for ${args[0]}: ${result.stdout}`);}
}
function contains(text,value){return typeof value==='string'&&value.length>3&&text.includes(value);}

let report;
try{
  const initialized=cli(['init','--state',source]);
  const seeded=cli(['demo','--state',source]);
  const sourceDoctor=cli(['doctor','--state',source]);
  const exported=cli(['snapshot','--state',source,'--out',snapshot]);
  const snapshotText=readFileSync(snapshot,'utf8'),ownerToken=readFileSync(join(source,'session-token'),'utf8').trim();
  const restoredResult=cli(['restore','--snapshot',snapshot,'--state',restored]);
  const restoredDoctor=cli(['doctor','--state',restored]);

  const forbidden=[
    {name:'owner-session-token',value:ownerToken},
    {name:'clean-room-root',value:root},
    {name:'repository-path',value:resolve(repoRoot)},
    {name:'home-directory',value:homedir()}
  ];
  const leaked=forbidden.filter(item=>contains(snapshotText,item.value)).map(item=>item.name);
  if(leaked.length)throw new Error('Portable snapshot contains machine-local/secret material: '+leaked.join(', '));
  if(sourceDoctor.source_lock.integrity!=='MATCH'||restoredDoctor.source_lock.integrity!=='MATCH')throw new Error('Pinned Native SDK integrity did not match');
  if(sourceDoctor.workspace.entities!==restoredDoctor.workspace.entities)throw new Error('Entity count differs after clean-room restore');
  if(sourceDoctor.workspace.history_rows!==restoredDoctor.workspace.history_rows)throw new Error('History count differs after clean-room restore');
  if(sourceDoctor.workspace.version.generation===restoredDoctor.workspace.version.generation)throw new Error('Restore did not rotate workspace generation');
  if(sourceDoctor.mutations_performed!==0||restoredDoctor.mutations_performed!==0)throw new Error('Doctor reported a mutation');

  report={
    schema_version:'launchwright-clean-room-report/1',
    environment:{node:process.version,platform:process.platform,arch:process.arch},
    execution:{entrypoint:'src/main.mjs',environment_forwarded:Object.keys(childEnv).sort(),external_platform_used:false},
    source:{entities:sourceDoctor.workspace.entities,history_rows:sourceDoctor.workspace.history_rows,events:sourceDoctor.workspace.events,generation:sourceDoctor.workspace.version.generation},
    restored:{entities:restoredDoctor.workspace.entities,history_rows:restoredDoctor.workspace.history_rows,events:restoredDoctor.workspace.events,generation:restoredDoctor.workspace.version.generation},
    continuity:{snapshot_digest:exported.digest,generation_rotated:true,entity_count_preserved:true,history_count_preserved:true,old_receipts_reactivated:false},
    integrity:{native_sdk:sourceDoctor.source_lock.integrity,hidden_author_paths_detected:false,owner_token_exported:false},
    fixture:{synthetic:true,seed_result_present:!!seeded,init_schema_version:initialized.schema_version},
    authority:{platform_connected:false,native_host_accepted:false,external_delivery:false}
  };
}finally{
  rmSync(root,{recursive:true,force:true,maxRetries:8,retryDelay:50});
}
const reportPath=process.env.LAUNCHWRIGHT_CLEANROOM_REPORT?resolve(process.env.LAUNCHWRIGHT_CLEANROOM_REPORT):null;
if(reportPath){mkdirSync(dirname(reportPath),{recursive:true});writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');}
process.stdout.write(JSON.stringify(report)+'\n');
