#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// R42 operator-only, two-phase editable PPTX / real PDF export.
import { lstatSync,readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LaunchwrightApplication } from '../src/application.mjs';
import { planDeckPdf,exportDeckPdf } from '../src/deck-pdf.mjs';

const [verb='help',...argv]=process.argv.slice(2);
const allowed=new Set(['state','candidate','artifact','out','plan','out-dir','confirm-plan','confirm-candidate']);
const flags=new Set(['acknowledge-draft','acknowledge-unverified','acknowledge-private-export']);
const print=data=>process.stdout.write(JSON.stringify(data,null,2)+'\n');
function parse(){
  const out={};
  for(let i=0;i<argv.length;i++){
    const token=argv[i];
    if(!token.startsWith('--')||Object.hasOwn(out,token))
      throw Error('Unexpected or duplicate deck export option');
    const key=token.slice(2);
    if(flags.has(key)){out[key]=true;continue;}
    if(!allowed.has(key)||!argv[i+1]||argv[i+1].startsWith('--'))
      throw Error('Unsupported or missing deck option: '+key);
    out[key]=argv[++i];
  }
  return out;
}
function privatePlan(file){
  if(!file)throw Error('An explicit private plan file is required');
  const s=lstatSync(resolve(file));
  if(!s.isFile()||s.isSymbolicLink()||s.size>16*1024||
    (process.platform!=='win32'&&(s.mode&0o077)!==0))
    throw Error('Deck plan must be a private 0600 regular JSON file, <=16 KiB');
  return JSON.parse(readFileSync(resolve(file),'utf8'));
}
async function main(){
  if(verb==='help'){
    process.stdout.write(
      'Launchwright private editable PPTX and real PDF from approved frozen Markdown.\n'+
      ' plan --state DIR --candidate ID --artifact ID --out PRIVATE_FILE --acknowledge-draft [--acknowledge-unverified]\n'+
      ' export --state DIR --plan PRIVATE_FILE --out-dir PRIVATE_0700_DIR --confirm-plan SHA256 --confirm-candidate SHA256 --acknowledge-private-export\n'+
      ' This NEVER publishes, executes external tools or promotes UNKNOWN to technical PASS.\n'
    );return;
  }
  if(!['plan','export'].includes(verb))throw Error('Unknown deck command');
  const input=parse();
  const admitted=verb==='plan'
    ? ['state','candidate','artifact','out','acknowledge-draft','acknowledge-unverified']
    : ['state','plan','out-dir','confirm-plan','confirm-candidate','acknowledge-private-export'];
  if(Object.keys(input).some(key=>!admitted.includes(key))||!input.state)
    throw Error('Deck command has missing or unsupported options');
  const app=new LaunchwrightApplication(resolve(input.state));
  try{
    if(verb==='plan'){
      if(!input.out)throw Error('A private --out JSON path is required');
      const plan=planDeckPdf(app,{
        candidate_id:input.candidate,artifact_id:input.artifact,
        acknowledge_draft_only:input['acknowledge-draft']===true,
        acknowledge_unverified:input['acknowledge-unverified']===true
      });
      writeFileSync(resolve(input.out),JSON.stringify(plan,null,2)+'\n',{
        flag:'wx',mode:0o600
      });
      print({saved_plan:resolve(input.out),plan_sha256:plan.plan_sha256,
        candidate_sha256:plan.candidate_sha256,
        source_sha256:plan.markdown_sha256,
        page_count:plan.total_pages,workspace_mutated:false,
        technical_state:plan.technical_state,publication_authority:false});
      return;
    }
    if(!input['out-dir'])throw Error('Choose a private output directory');
    const plan=privatePlan(input.plan);
    const receipt=await exportDeckPdf(app,plan,resolve(input['out-dir']),{
      confirm_plan_sha256:input['confirm-plan'],
      confirm_candidate_sha256:input['confirm-candidate'],
      acknowledge_private_export:input['acknowledge-private-export']===true
    });
    print(receipt);
  }finally{app.close();}
}
main().catch(err=>{
  print({error:{code:err.code??'InvalidArgument',
    message:err.message,outcome_known:err.outcomeKnown??true}});
  process.exitCode=1;
});
