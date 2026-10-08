// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, statfsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { LaunchwrightApplication } from './application.mjs';

const supportedNode=version=>{
  const [major,minor,patch]=String(version).split('.').map(Number);
  return major===24&&(minor>21||(minor===21&&patch>=0));
};
const privateMode=(path,issues,label)=>{
  if(process.platform==='win32'||!existsSync(path))return;
  const stat=lstatSync(path);
  if(stat.isSymbolicLink())issues.push({severity:'error',code:`${label}_SYMLINK`,message:`${label} must not be a symlink`});
  else if((stat.mode&0o077)!==0)issues.push({severity:'warning',code:`${label}_MODE`,message:`${label} should not be group/world accessible`});
};

// Portable diagnostics only. Never create directories, truncate or delete data.
// The caller may inject a filesystem-capacity reader to test zero-space and
// unsupported-platform behavior without modifying the host filesystem.
const MIN_BLOCKING_MIB=16n;
const MIN_WARNING_MIB=256n;
function existingAncestor(path){
  let current=resolve(path);
  while(!existsSync(current)){
    const parent=dirname(current);
    if(parent===current)break;
    current=parent;
  }
  return current;
}
export function inspectStorageCapacity(stateRoot,{
  temporaryDirectory=tmpdir(),capacityReader=statfsSync
}={}){
  const sample=(path,scope)=>{
    try{
      const stats=capacityReader(existingAncestor(path),{bigint:true});
      const block=BigInt(stats.bsize),freeBlocks=BigInt(stats.bavail);
      if(block<=0n||freeBlocks<0n)throw Error('Invalid filesystem capacity');
      const mib=(block*freeBlocks)/1048576n;
      const state=mib<MIN_BLOCKING_MIB?'EXHAUSTED':
        mib<MIN_WARNING_MIB?'LOW':'OK';
      return{scope,state,available_mib:Number(mib>BigInt(Number.MAX_SAFE_INTEGER)?
        BigInt(Number.MAX_SAFE_INTEGER):mib)};
    }catch{
      return{scope,state:'UNKNOWN',available_mib:null};
    }
  };
  return{
    temporary:sample(temporaryDirectory,'process-temporary-filesystem'),
    workspace:sample(stateRoot,'workspace-filesystem'),
    mutations_performed:0,
    provenance:'local-filesystem-capacity-only',
    no_cleanups_performed:true
  };
}

export function inspectDoctor(root,repoRoot,{
  env=process.env,nodeVersion=process.versions.node,
  temporaryDirectory=tmpdir(),capacityReader=statfsSync
}={}){
  const issues=[],recommendations=[];
  const lockPath=join(repoRoot,'SOURCE_LOCK.json');
  let lock=null,checked=0,integrity='MATCH';
  try{
    lock=JSON.parse(readFileSync(lockPath,'utf8'));
    for(const [relative,expected] of Object.entries(lock.native_sdk?.files??{})){
      const path=join(repoRoot,'vendor/semwright-native-sdk',relative);
      if(!existsSync(path)||lstatSync(path).isSymbolicLink()){integrity='MISMATCH';issues.push({severity:'error',code:'SDK_FILE_MISSING',message:`Pinned Native SDK file unavailable: ${relative}`});continue;}
      const observed=createHash('sha256').update(readFileSync(path)).digest('hex');checked++;
      if(observed!==expected){integrity='MISMATCH';issues.push({severity:'error',code:'SDK_DIGEST_MISMATCH',message:`Pinned Native SDK digest differs: ${relative}`});}
    }
  }catch{integrity='MISMATCH';issues.push({severity:'error',code:'SOURCE_LOCK_INVALID',message:'SOURCE_LOCK.json could not be validated'});}
  const nodeSupported=supportedNode(nodeVersion);
  if(!nodeSupported){issues.push({severity:'warning',code:'NODE_UNSUPPORTED',message:'This Node runtime is diagnostic only'});recommendations.push('Use Node >=24.21.0 <25 for acceptance.');}
  const storage=inspectStorageCapacity(root,{temporaryDirectory,capacityReader});
  for(const report of [storage.temporary,storage.workspace]){
    const prefix=report.scope==='process-temporary-filesystem'?'TEMP':'STATE';
    if(report.state==='EXHAUSTED'){
      issues.push({severity:'error',code:prefix+'_SPACE_EXHAUSTED',
        message:prefix==='TEMP'?'Temporary filesystem has less than 16 MiB free':
          'Workspace filesystem has less than 16 MiB free'});
    }else if(report.state==='LOW'){
      issues.push({severity:'warning',code:prefix+'_SPACE_LOW',
        message:'Filesystem has less than 256 MiB free'});
    }else if(report.state==='UNKNOWN'){
      issues.push({severity:'warning',code:prefix+'_CAPACITY_UNKNOWN',
        message:'Filesystem capacity could not be determined without mutation'});
    }
  }
  if(storage.temporary.state==='EXHAUSTED'||storage.temporary.state==='LOW')
    recommendations.push('Use an explicitly selected private temporary directory on a filesystem with adequate free space (TMPDIR on POSIX), or arrange reviewed cleanup; Launchwright never deletes unrelated files.');
  if(storage.workspace.state==='EXHAUSTED'||storage.workspace.state==='LOW')
    recommendations.push('Choose a workspace filesystem with adequate free space and back up existing state before moving it; no automatic cleanup or migration is performed.');
  const dbPath=join(root,'launchwright.sqlite3'),tokenPath=join(root,'session-token');
  const initialized=existsSync(dbPath);let workspace=null;
  if(existsSync(root)){
    const stateStat=lstatSync(root);
    if(stateStat.isSymbolicLink())issues.push({severity:'error',code:'STATE_SYMLINK',message:'State directory must not be a symlink'});
  }
  privateMode(dbPath,issues,'DATABASE');privateMode(tokenPath,issues,'SESSION_TOKEN');
  if(initialized&&!issues.some(issue=>issue.code==='STATE_SYMLINK')){
    try{
      const app=new LaunchwrightApplication(root,{readOnly:true});
      try{
        workspace={version:app.store.version(),schema_version:app.store.meta().schema_version,history_ready:app.store.hasHistory,
          entities:app.store.db.prepare('SELECT count(*) AS n FROM entities').get().n,
          history_rows:app.store.hasHistory?app.store.db.prepare('SELECT count(*) AS n FROM entity_history').get().n:0,
          events:app.store.db.prepare('SELECT count(*) AS n FROM events').get().n,
          outstanding_intents:app.store.db.prepare("SELECT count(*) AS n FROM pending WHERE state!='COMPLETED'").get().n};
      }finally{app.close();}
      if(!workspace.history_ready){issues.push({severity:'error',code:'HISTORY_MIGRATION_REQUIRED',message:'Workspace requires explicit history migration before mutation'});recommendations.push('Run node src/main.mjs migrate-history --state <DIR> after making an independent backup.');}
      if(workspace.outstanding_intents>0)recommendations.push('Reconcile outstanding intents before retrying external work.');
    }catch{issues.push({severity:'error',code:'WORKSPACE_OPEN_FAILED',message:'Workspace could not be inspected read-only'});}
  }
  if(!initialized)recommendations.push('Run node src/main.mjs init --state <DIR> to create a workspace.');
  if(integrity!=='MATCH')recommendations.push('Restore the exact Native SDK files pinned by SOURCE_LOCK.json; do not regenerate the pin locally.');
  const blocked=issues.some(issue=>issue.severity==='error');
  return{schema_version:'launchwright-doctor/1',app:'Launchwright',node:nodeVersion,required_node:'>=24.21.0 <25',
    canonical_sdk_engine_supported:nodeSupported,state:blocked?'BLOCKED':issues.length?'ATTENTION':'READY_LOCAL',
    source_lock:{native_sdk_sha:lock?.native_sdk?.sha??null,files_checked:checked,integrity},
    state_initialized:initialized,workspace,storage,platform_sdk_configured:!!env.SEMWRIGHT_PLATFORM_SDK,
    consumer_auth_configured:!!env.LAUNCHWRIGHT_CONSUMER_AUTH,platform_connected:false,native_host_accepted:false,
    external_delivery:false,heavy_checks:'NOT_RUN_BY_DOCTOR',mutations_performed:0,issues,recommendations};
}
