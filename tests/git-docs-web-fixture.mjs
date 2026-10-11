// SPDX-License-Identifier: AGPL-3.0-only
// R68: an entirely owned real-Git + Native SDK fixture; customer code is never run.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execute} from '../src/application.mjs';
import {baseline} from './helpers.mjs';
export const ownedGit=(root,...args)=>execFileSync('git',['-C',root,...args],{
  encoding:'utf8',timeout:12000,maxBuffer:1048576,
  env:{...process.env,GIT_TERMINAL_PROMPT:'0'}
}).trim();

export async function createR68Fixture(app){
  const repository_root=mkdtempSync(join(tmpdir(),'launchwright-r68-owned-repo-'));
  try{
    execFileSync('git',['init','-b','main',repository_root],{stdio:'ignore'});
    ownedGit(repository_root,'config','user.name','R68 Owned Git Fixture');
    ownedGit(repository_root,'config','user.email','r68@example.invalid');
    mkdirSync(join(repository_root,'docs'));
    writeFileSync(join(repository_root,'docs','RELEASE_NOTES.md'),
      '# Existing owned release notes\n');
    ownedGit(repository_root,'add','docs/RELEASE_NOTES.md');
    ownedGit(repository_root,'commit','-m','Owned initial Git docs fixture');
    const base=ownedGit(repository_root,'rev-parse','HEAD');
    const b=await baseline(app);
    const artifact=(await execute(app,'deliverable.render',
      {id:b.deliverable.id})).entity;
    const candidate=(await execute(app,'candidate.freeze',{
      release_id:b.release.id,name:'R68 approved Markdown',
      artifact_ids:[artifact.id],destination:'local-git-docs-branch',
      contract:{version:'r68-owned',required_reviewers:1,require_claims_verified:false}
    })).entity;
    await execute(app,'candidate.review',{
      id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,
      decision:'approve-editorial',comment:'Explicit owned synthetic editorial review'
    });
    return{repository_root,b,base,artifact,candidate,
      planInput:{
        repository_root,github_repository:'owned-org/release-docs',
        base_branch:'main',docs_path:'docs/RELEASE_NOTES.md',
        candidate_id:candidate.id,artifact_id:artifact.id,
        acknowledge_draft_only:true,acknowledge_unverified:true
      },
      cleanup:()=>rmSync(repository_root,{recursive:true,force:true,maxRetries:5,retryDelay:50})
    };
  }catch(error){
    rmSync(repository_root,{recursive:true,force:true,maxRetries:5,retryDelay:50});
    throw error;
  }
}
