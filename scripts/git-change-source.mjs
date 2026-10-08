#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Explicit local Git-only metadata observer. No repo content is executed or fetched.
import { readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { LaunchwrightApplication } from '../src/application.mjs';
import { observeGitChanges, importGitObservation } from '../src/git-change-source.mjs';

const [command='help',...args]=process.argv.slice(2);
function option(name,fallback=null) {
  const i=args.indexOf('--'+name);
  if(i<0)return fallback;
  if(!args[i+1]||args[i+1].startsWith('--'))throw Error('Missing --'+name+' value');
  return args[i+1];
}
const result=data=>console.log(JSON.stringify(data,null,2));
async function main() {
  if(command==='help') {
    console.log('Launchwright local Git source adapter (operator-owned, imported-only)\n'+
      '  observe --repo ABSOLUTE_REPO_ROOT --alias SOURCE_ALIAS --base FULL_SHA --head FULL_SHA --out FILE\n'+
      '  record --state DIR --in FILE --source ID --target ID --release ID --name TITLE\n'+
      '         --rights owned|licensed --acknowledge-imported\n'+
      'Never fetches/pulls; does not execute project scripts. Record creates only imported UNKNOWN evidence.');
    return;
  }
  if(command==='observe') {
    const out=option('out');
    if(!out)throw Error('An explicit --out private file is required');
    const observed=observeGitChanges({
      repository_root:option('repo'),source_alias:option('alias'),
      base_sha:option('base'),head_sha:option('head')
    });
    const output=resolve(out);
    writeFileSync(output,JSON.stringify(observed,null,2)+'\n',{flag:'wx',mode:0o600});
    result({saved:output,source_alias:observed.source_alias,
      observation_sha256:observed.observation_sha256,
      changed_files:observed.changed_files,commit_count:observed.commit_count,
      network_access_performed:false,technical_state:'UNKNOWN'});
    return;
  }
  if(command==='record'){
    const input=resolve(option('in',''));
    const stat=lstatSync(input);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024||
      (process.platform!=='win32'&&(stat.mode&0o077)!==0))
      throw Error('Git observation must be a private regular file (0600 and at most 1 MiB)');
    const observed=JSON.parse(readFileSync(input,'utf8'));
    const state=option('state');
    if(!state)throw Error('--state must identify an existing Launchwright workspace');
    const app=new LaunchwrightApplication(resolve(state));
    try{
      const stored=await importGitObservation(app,observed,{
        source_id:option('source'),target_id:option('target'),
        release_id:option('release'),name:option('name'),rights:option('rights'),
        acknowledge_imported:args.includes('--acknowledge-imported')
      });
      result({id:stored.id,kind:stored.kind,observation_sha256:observed.observation_sha256,
        admission:stored.data.admission,technical_state:stored.data.technical,
        driver_host_authority:false,platform_authority:false});
    }finally{app.close();}
    return;
  }
  throw Error('Unknown command; run node scripts/git-change-source.mjs help');
}
main().catch(error=>{
  result({error:{code:error.code??'InvalidArgument',message:error.message,
    outcome_known:error.outcomeKnown??true}});
  process.exitCode=1;
});
