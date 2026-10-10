#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// R54 operator-controlled two-phase private continuity dossier.
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LaunchwrightApplication } from '../src/application.mjs';
import { planReleaseContinuity, exportReleaseContinuity } from '../src/release-continuity.mjs';

const [mode='help',...args]=process.argv.slice(2);
const keys=new Set(['state','before-release','after-release','before-candidate',
  'after-candidate','out','plan','out-dir','confirm-plan',
  'confirm-before','confirm-after']);
const flags=new Set(['acknowledge-private','acknowledge-incomplete',
  'acknowledge-export']);
function parse(){
  const out={};
  for(let i=0;i<args.length;i++){
    const flag=args[i];
    if(!flag.startsWith('--')||Object.hasOwn(out,flag.slice(2)))
      throw Error('Unexpected or duplicate argument');
    const key=flag.slice(2);
    if(flags.has(key)){out[key]=true;continue;}
    if(!keys.has(key)||!args[i+1]||args[i+1].startsWith('--'))
      throw Error('Unsupported or missing option: '+key);
    out[key]=args[++i];
  }
  return out;
}
function privatePlan(path){
  if(!path)throw Error('A private saved plan must be supplied');
  const file=resolve(path),stat=lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>32*1024||
    (process.platform!=='win32'&&(stat.mode&0o077)!==0))
    throw Error('Continuity plan must be a private 0600 regular file no larger than 32 KiB');
  return JSON.parse(readFileSync(file,'utf8'));
}
const print=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
async function main(){
  if(mode==='help'){
    process.stdout.write(
      'Launchwright two-release continuity dossier (not Publish or customer verification).\n'+
      ' plan --state DIR --before-release ID --after-release ID --before-candidate ID --after-candidate ID --out PRIVATE_JSON --acknowledge-private --acknowledge-incomplete\n'+
      ' export --state DIR --plan PRIVATE_JSON --out-dir PRIVATE_0700_DIR --confirm-plan SHA256 --confirm-before SHA256 --confirm-after SHA256 --acknowledge-export\n'
    );return;
  }
  if(mode!=='plan'&&mode!=='export')throw Error('Unknown release continuity action');
  const input=parse();
  const allowed=mode==='plan'?
    ['state','before-release','after-release','before-candidate','after-candidate',
      'out','acknowledge-private','acknowledge-incomplete']:
    ['state','plan','out-dir','confirm-plan','confirm-before',
      'confirm-after','acknowledge-export'];
  if(!input.state||Object.keys(input).some(key=>!allowed.includes(key)))
    throw Error('Missing workspace or unsupported operation option');
  const app=new LaunchwrightApplication(resolve(input.state),{readOnly:mode==='plan'});
  try{
    if(mode==='plan'){
      if(!input.out)throw Error('--out PRIVATE_JSON required');
      const plan=planReleaseContinuity(app,{
        before_release_id:input['before-release'],
        after_release_id:input['after-release'],
        before_candidate_id:input['before-candidate'],
        after_candidate_id:input['after-candidate'],
        acknowledge_private_only:input['acknowledge-private']===true,
        acknowledge_incomplete_coverage:input['acknowledge-incomplete']===true
      });
      writeFileSync(resolve(input.out),JSON.stringify(plan,null,2)+'\n',
        {flag:'wx',mode:0o600});
      print({saved_plan:resolve(input.out),plan_sha256:plan.plan_sha256,
        before_candidate_sha256:plan.before_candidate_sha256,
        after_candidate_sha256:plan.after_candidate_sha256,
        changes:{changed:plan.changed_artifacts,added:plan.added_artifacts,
          removed:plan.removed_artifacts,unchanged:plan.unchanged_artifacts},
        workspace_mutated:false,publication_authority:false});
      return;
    }
    const plan=privatePlan(input.plan);
    const result=await exportReleaseContinuity(app,plan,resolve(input['out-dir']),{
      confirm_plan_sha256:input['confirm-plan'],
      confirm_before_candidate_sha256:input['confirm-before'],
      confirm_after_candidate_sha256:input['confirm-after'],
      acknowledge_private_export:input['acknowledge-export']===true
    });
    print(result);
  }finally{app.close();}
}
main().catch(error=>{
  print({error:{
    code:error.code??'InvalidArgument',
    message:error.message,
    outcome_known:error.outcomeKnown??true
  }});
  process.exitCode=1;
});
