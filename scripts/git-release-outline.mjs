#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// R33 operator-controlled editorial outline from imported R32 observation.
import { readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { LaunchwrightApplication } from '../src/application.mjs';
import { previewGitReleaseOutline, createGitReleaseOutline } from '../src/git-release-outline.mjs';

const [command='help',...args]=process.argv.slice(2);
function option(name){
  const at=args.indexOf('--'+name);
  if(at<0)return null;
  if(!args[at+1]||args[at+1].startsWith('--'))throw Error('--'+name+' requires an argument');
  return args[at+1];
}
function privateObservation(filename){
  if(!filename)throw Error('--in FILE is required');
  const path=resolve(filename);
  const stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024||
      (process.platform!=='win32'&&(stat.mode&0o077)!==0))
    throw Error('Git observation must be a private regular file (0600, maximum 1 MiB)');
  return JSON.parse(readFileSync(path,'utf8'));
}
async function run(){
  if(command==='help'){
    console.log('Launchwright imported Git editorial outline (no product claims or external send)\n'+
      '  preview --state DIR --in FILE --source ID --release ID --target ID --evidence ID\n'+
      '          --name TITLE --out PRIVATE_FILE [--include-paths --acknowledge-path-disclosure]\n'+
      '  create --state DIR --in FILE --source ID --release ID --target ID --evidence ID\n'+
      '         --name TITLE --acknowledge-editorial-draft\n'+
      '         [--include-paths --acknowledge-path-disclosure]\n'+
      'Preview creates a 0600 local Markdown file, not a domain resource.\n'+
      'Create stores an editable source-linked deliverable via Native SDK; technical state remains UNKNOWN.');
    return;
  }
  if(!['preview','create'].includes(command))throw Error('Unknown command');
  const root=option('state');
  if(!root)throw Error('--state DIR is required');
  const observation=privateObservation(option('in'));
  const input={
    source_id:option('source'),release_id:option('release'),
    target_id:option('target'),evidence_id:option('evidence'),
    name:option('name'),include_paths:args.includes('--include-paths'),
    acknowledge_path_disclosure:args.includes('--acknowledge-path-disclosure'),
    acknowledge_editorial_draft:args.includes('--acknowledge-editorial-draft')
  };
  const app=new LaunchwrightApplication(resolve(root));
  try{
    if(command==='preview'){
      const output=option('out');
      if(!output)throw Error('--out FILE is required for a private preview');
      const result=previewGitReleaseOutline(app,observation,input);
      writeFileSync(resolve(output),result.content,{flag:'wx',mode:0o600});
      console.log(JSON.stringify({saved:resolve(output),outline_sha256:result.outline_sha256,
        observation_sha256:result.observation_sha256,
        contains_file_paths:result.file_names_disclosed,technical_state:'UNKNOWN',
        domain_mutation_performed:false,external_send_performed:false},null,2));
      return;
    }
    const created=await createGitReleaseOutline(app,observation,input);
    console.log(JSON.stringify({deliverable_id:created.entity.id,
      release_id:created.entity.data.release_id,
      revision:created.entity.version,outline_sha256:created.outline_sha256,
      reused:created.reused,format:'markdown',
      technical_state:'UNKNOWN',source_provenance:'imported-Git-only',
      human_editorial_review_required:true,external_send_performed:false},null,2));
  }finally{app.close();}
}
run().catch(error=>{
  console.log(JSON.stringify({error:{code:error.code??'InvalidArgument',
    message:error.message,outcome_known:true}},null,2));
  process.exitCode=1;
});
