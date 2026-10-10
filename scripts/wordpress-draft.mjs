#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// R47 private WordPress draft transport: plan (offline), explicit first-send,
// read-only recover. No automatic publish, delete, retry, update or Platform.
import { closeSync,existsSync,lstatSync,openSync,readFileSync,unlinkSync,writeFileSync } from 'node:fs';
import { isAbsolute,resolve,join } from 'node:path';
import { LaunchwrightApplication } from '../src/application.mjs';
import { NativeError } from '@semwright/native-sdk';
import { prepareWordPressDraft,readPrivateWordPressCredentials,
  wordpressHttpTransport,sendWordPressDraft } from '../src/wordpress-draft.mjs';

const [action='help',...argv]=process.argv.slice(2);
const opts=new Set(['state','delivery','origin','title','notes-artifact','out',
  'intent','credentials','confirm-origin','confirm-candidate','confirm-intent']);
const switches=new Set(['acknowledge-draft','acknowledge-unverified',
  'acknowledge-site-control','acknowledge-source-rights','acknowledge-send']);
const print=v=>process.stdout.write(JSON.stringify(v,null,2)+'\n');
function argumentsMap(){
  const out={};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];
    if(!arg.startsWith('--')||Object.hasOwn(out,arg))throw Error('Duplicate/unknown operator option');
    const key=arg.slice(2);
    if(switches.has(key)){out[key]=true;continue;}
    if(!opts.has(key)||!argv[i+1]||argv[i+1].startsWith('--'))
      throw Error('Unsupported or missing WordPress option '+key);
    out[key]=argv[++i];
  }
  return out;
}
function exact(argv,permitted){
  if(Object.keys(argv).some(k=>!permitted.includes(k)))
    throw Error('WordPress action has unknown/unsafe option');
}
function privateJson(path,name){
  if(!path||!isAbsolute(path))throw Error(name+' must be an explicit absolute path');
  const info=lstatSync(path);
  if(!info.isFile()||info.isSymbolicLink()||info.size>16*1024||
    (process.platform!=='win32'&&(info.mode&0o077)!==0))
    throw Error(name+' must be a private 0600 JSON file (max 16 KiB)');
  return JSON.parse(readFileSync(path,'utf8'));
}
async function exclusive(root,task){
  const lock=join(root,'.wordpress-draft-send.lock');
  let fd;
  try{fd=openSync(lock,'wx',0o600);}
  catch(err){
    throw new NativeError('Conflict',
      'WordPress DRAFT send already running or a stale lock needs operator review');
  }
  try{return await task();}
  finally{try{closeSync(fd);}finally{unlinkSync(lock);}}
}
async function main(){
  if(action==='help'){
    console.log('WordPress DRAFT: source-bound exact Markdown, operator-owned origin only, never publish.\n'+
    ' plan --state ABS_STATE --delivery ID --origin HTTPS_ORIGIN --title TITLE --notes-artifact ID --out PRIVATE_JSON --acknowledge-draft --acknowledge-site-control --acknowledge-source-rights [--acknowledge-unverified]\n'+
    ' send --state ABS_STATE --intent PRIVATE_JSON --credentials PRIVATE_0600_JSON --confirm-origin HTTPS_ORIGIN --confirm-candidate SHA256 --confirm-intent SHA256 --acknowledge-send [--out PRIVATE_RECEIPT]\n'+
    ' recover --state ABS_STATE --intent PRIVATE_JSON --credentials PRIVATE_0600_JSON --confirm-origin HTTPS_ORIGIN --confirm-candidate SHA256 --confirm-intent SHA256 [--out PRIVATE_RECEIPT]\n'+
    ' Credentials JSON: {"username":"operator","application_password":"FROM_WORDPRESS_USER_SETTINGS"}. Never include password in command flags or commit it.');
    return;
  }
  if(!['plan','send','recover'].includes(action))throw Error('Unknown WordPress action');
  const options=argumentsMap();
  const planKeys=['state','delivery','origin','title','notes-artifact','out',
    'acknowledge-draft','acknowledge-unverified',
    'acknowledge-site-control','acknowledge-source-rights'];
  const sendKeys=['state','intent','credentials','confirm-origin','confirm-candidate',
    'confirm-intent','acknowledge-send','out'];
  exact(options,action==='plan'?planKeys:sendKeys);
  if(!options.state||!isAbsolute(options.state))
    throw Error('Exact absolute Launchwright state path is required');
  if(action==='recover'&&options['acknowledge-send'])
    throw Error('Read-only recovery never permits acknowledging a fresh send');
  const app=new LaunchwrightApplication(resolve(options.state));
  try{
    if(action==='plan'){
      if(!options.out||!isAbsolute(options.out))
        throw Error('Private absolute output plan path is required');
      const intent=prepareWordPressDraft(app,{
        delivery_id:options.delivery,origin:options.origin,title:options.title,
        notes_artifact_id:options['notes-artifact'],
        acknowledge_draft_only:options['acknowledge-draft']===true,
        acknowledge_unverified:options['acknowledge-unverified']===true,
        acknowledge_site_control:options['acknowledge-site-control']===true,
        acknowledge_source_rights:options['acknowledge-source-rights']===true
      });
      writeFileSync(options.out,JSON.stringify(intent,null,2)+'\n',
        {flag:'wx',mode:0o600});
      print({saved_plan:options.out,intent_sha256:intent.intent_sha256,
        origin:intent.origin,slug:intent.slug,candidate_sha256:intent.candidate_sha256,
        draft_only:true,workspace_mutated:false,external_send_performed:false});
      return;
    }
    if(options.out&&!isAbsolute(options.out))
      throw Error('Receipt path must be an absolute private output location');
    if(options.out&&existsSync(options.out))
      throw Error('A private WordPress receipt already exists; it cannot be overwritten');
    const intent=privateJson(options.intent,'Saved WordPress DRAFT plan');
    if(!options.credentials||!isAbsolute(options.credentials))
      throw Error('An explicit private WordPress application-password file is required');
    const reply=await exclusive(app.store.root,async()=>{
      const credentials=readPrivateWordPressCredentials(options.credentials);
      const remote=wordpressHttpTransport(intent.origin,credentials);
      return sendWordPressDraft(app,intent,remote,{
        confirm_origin:options['confirm-origin'],
        confirm_candidate_sha256:options['confirm-candidate'],
        confirm_intent_sha256:options['confirm-intent'],
        acknowledge_first_send:action==='send'&&options['acknowledge-send']===true,
        recover_only:action==='recover'
      });
    });
    if(options.out)writeFileSync(options.out,JSON.stringify(reply,null,2)+'\n',
      {flag:'wx',mode:0o600});
    print(reply);
  }finally{app.close();}
}
main().catch(error=>{
  // Never log credentials, request headers or unbounded WordPress HTML.
  const known=error instanceof NativeError;
  print({error:{
    code:known?error.code:'InvalidArgument',
    message:known?error.message:'WordPress operator input or file access failed',
    outcome_known:known?error.outcomeKnown:true
  }});
  process.exitCode=1;
});
