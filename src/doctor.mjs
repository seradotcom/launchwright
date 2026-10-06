// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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

export function inspectDoctor(root,repoRoot,{env=process.env,nodeVersion=process.versions.node}={}){
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
    state_initialized:initialized,workspace,platform_sdk_configured:!!env.SEMWRIGHT_PLATFORM_SDK,
    consumer_auth_configured:!!env.LAUNCHWRIGHT_CONSUMER_AUTH,platform_connected:false,native_host_accepted:false,
    external_delivery:false,heavy_checks:'NOT_RUN_BY_DOCTOR',mutations_performed:0,issues,recommendations};
}
