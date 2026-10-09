#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// R40 owner CLI: exact frozen Markdown candidate -> private Git docs review
// branch, without checkout, hooks, GitHub PR, push, or external publication.
import { readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { LaunchwrightApplication } from '../src/application.mjs';
import { prepareGitDocsBranch,applyGitDocsBranch } from '../src/git-docs-pr.mjs';
const [command='help',...argv]=process.argv.slice(2);
const params=new Set(['state','repo-root','owner-repo','base','docs-path',
  'candidate','artifact','out','plan','confirm-plan','confirm-candidate','confirm-base']);
const flags=new Set(['acknowledge-draft-only','acknowledge-unverified','acknowledge-local-git-write']);
function parse(){
  const values={};
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(!a.startsWith('--')||Object.hasOwn(values,a))throw Error('Unexpected/duplicate option');
    const key=a.slice(2);
    if(flags.has(key)){values[a]=true;continue;}
    if(!params.has(key)||!argv[i+1]||argv[i+1].startsWith('--'))
      throw Error('Unknown or missing option --'+key);
    values[a]=argv[++i];
  }
  return values;
}
const output=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
function privateJson(path){
  if(!path)throw Error('Explicit saved Git docs plan is required');
  const file=resolve(path),stat=lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024||
    (process.platform!=='win32'&&(stat.mode&0o077)!==0))
    throw Error('Git docs plan must be a private 0600 regular file, max 16 KiB');
  return JSON.parse(readFileSync(file,'utf8'));
}
async function main(){
  if(command==='help'){
    process.stdout.write(
      'Launchwright R40: exact reviewed Markdown -> PRIVATE Git docs branch (never pushes/publishes)\n'+
      ' plan --state DIR --repo-root ABS_PATH --owner-repo OWNER/REPO --base main \\\n'+
      '      --docs-path docs/RELEASE_NOTES.md --candidate ID --artifact ID \\\n'+
      '      --out PRIVATE_FILE --acknowledge-draft-only [--acknowledge-unverified]\n'+
      ' apply --state DIR --repo-root ABS_PATH --plan PRIVATE_FILE \\\n'+
      '      --confirm-plan SHA256 --confirm-candidate SHA256 --confirm-base COMMIT_SHA \\\n'+
      '      --acknowledge-local-git-write\n'
    );return;
  }
  const input=parse();
  if(!['plan','apply'].includes(command))throw Error('Unknown Git docs command');
  const allowed=new Set(command==='plan'
    ? ['state','repo-root','owner-repo','base','docs-path','candidate','artifact',
       'out','acknowledge-draft-only','acknowledge-unverified']
    : ['state','repo-root','plan','confirm-plan','confirm-candidate','confirm-base',
       'acknowledge-local-git-write']);
  if(Object.keys(input).some(k=>!allowed.has(k.slice(2))))
    throw Error('Git docs command has extra options');
  if(!input['--state']||!input['--repo-root'])throw Error('State and Git repository are required');
  const app=new LaunchwrightApplication(resolve(input['--state']));
  try{
    if(command==='plan'){
      if(!input['--out'])throw Error('A private --out file is required');
      const plan=prepareGitDocsBranch(app,{
        repository_root:resolve(input['--repo-root']),
        github_repository:input['--owner-repo'],base_branch:input['--base'],
        docs_path:input['--docs-path'],candidate_id:input['--candidate'],
        artifact_id:input['--artifact'],
        acknowledge_draft_only:input['--acknowledge-draft-only']===true,
        acknowledge_unverified:input['--acknowledge-unverified']===true
      });
      const file=resolve(input['--out']);
      writeFileSync(file,JSON.stringify(plan,null,2)+'\n',{flag:'wx',mode:0o600});
      output({plan_saved:file,plan_sha256:plan.plan_sha256,branch:plan.branch,
        candidate_sha256:plan.candidate_sha256,base_commit_sha:plan.base_commit_sha,
        docs_path:plan.docs_path,external_network_access_performed:false,
        local_git_write_performed:false,github_pr_created:false});
      return;
    }
    const plan=privateJson(input['--plan']);
    const receipt=applyGitDocsBranch(app,plan,resolve(input['--repo-root']),{
      confirm_plan_sha256:input['--confirm-plan'],
      confirm_candidate_sha256:input['--confirm-candidate'],
      confirm_base_commit_sha:input['--confirm-base'],
      acknowledge_local_git_write:input['--acknowledge-local-git-write']===true
    });
    output(receipt);
  }finally{app.close();}
}
main().catch(err=>{
  output({error:{code:err.code??'InvalidArgument',
    message:err instanceof Error?err.message:'Git docs operation failed',
    outcome_known:err.outcomeKnown??false}});
  process.exitCode=1;
});
