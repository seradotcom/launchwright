// SPDX-License-Identifier: AGPL-3.0-only
// R67: owner-only, recoverable browser interface to the existing R54 Native
// two-release continuity engine. Never executes a customer project or publishes.
import { createHash } from 'node:crypto';
import { constants as fsConstants, closeSync, existsSync, fstatSync,
  lstatSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { NativeError, requireCondition as ensure, validateValue } from '@semwright/native-sdk';
import { planReleaseContinuity, exportReleaseContinuity } from './release-continuity.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const folderName='.local-continuity-exports';
const maxZipBytes=32*1024*1024;
const exact=(obj,keys)=>ensure(obj&&typeof obj==='object'&&!Array.isArray(obj)&&
  Object.keys(obj).length===keys.length&&keys.every(k=>Object.hasOwn(obj,k)),
  'Unexpected or missing continuity fields','InvalidArgument');

function destination(app,create){
  const root=app.store.root;
  ensure(isAbsolute(root),'Continuity export requires absolute state root','InvalidArgument');
  const dir=join(root,folderName);
  if(create&&!existsSync(dir)){
    try{mkdirSync(dir,{mode:0o700});}
    catch(err){if(err.code!=='EEXIST')throw err;}
  }
  if(!existsSync(dir))return null;
  const st=lstatSync(dir);
  ensure(st.isDirectory()&&!st.isSymbolicLink()&&
    (process.platform==='win32'||(st.mode&0o077)===0),
    'Browser continuity storage must be an owner-only directory','PermissionDenied');
  return dir;
}
function readPrivate(path,maxBytes){
  // O_NOFOLLOW, lstat and fstat guard against replacing the file with symlinks.
  const st=lstatSync(path);
  ensure(st.isFile()&&!st.isSymbolicLink()&&st.size>0&&st.size<=maxBytes&&
    (process.platform==='win32'||(st.mode&0o077)===0),
    'Continuity export is not an unmodified private file','Conflict');
  const fd=openSync(path,fsConstants.O_RDONLY|
    (process.platform==='win32'?0:fsConstants.O_NOFOLLOW));
  try{
    const check=fstatSync(fd);
    ensure(check.isFile()&&check.dev===st.dev&&check.ino===st.ino&&
      check.size===st.size,'Continuity export was replaced during read','Conflict');
    return readFileSync(fd);
  }finally{closeSync(fd);}
}

export function planBrowserContinuity(app,input){
  app.allow('read');
  validateValue(input);
  exact(input,['before_release_id','after_release_id','before_candidate_id',
    'after_candidate_id','acknowledge_private_only',
    'acknowledge_incomplete_coverage']);
  return planReleaseContinuity(app,input);
}

export async function exportBrowserContinuity(app,raw){
  app.allow('edit');
  validateValue(raw);
  exact(raw,['plan','confirm_plan_sha256','confirm_before_candidate_sha256',
    'confirm_after_candidate_sha256','acknowledge_private_export']);
  const p=raw.plan;
  ensure(p&&hex(p.plan_sha256),'Missing exact continuity plan SHA','InvalidArgument');
  // Explicit confirmation happens BEFORE a directory is created. Underlying R54
  // revalidates the exact Native candidate revisions and owns the writer lock.
  ensure(raw.confirm_plan_sha256===p.plan_sha256&&
    raw.confirm_before_candidate_sha256===p.before_candidate_sha256&&
    raw.confirm_after_candidate_sha256===p.after_candidate_sha256&&
    raw.acknowledge_private_export===true,
    'Owner must confirm plan and both candidate hashes','ConsentRequired');
  const dir=destination(app,true);
  const result=await exportReleaseContinuity(app,p,dir,{
    confirm_plan_sha256:raw.confirm_plan_sha256,
    confirm_before_candidate_sha256:raw.confirm_before_candidate_sha256,
    confirm_after_candidate_sha256:raw.confirm_after_candidate_sha256,
    acknowledge_private_export:true
  });
  return{
    ...result,
    download_url:`/api/v1/local-continuity/${p.plan_sha256}/bundle.zip`,
    browser_local_export:true,
    published:false,customer_acceptance:false,
    technical_state:'UNKNOWN'
  };
}

export function inspectBrowserContinuity(app,hash,{includeBytes=false}={}){
  app.allow('read');
  ensure(hex(hash),'Expected full SHA-256 continuity plan identifier','InvalidArgument');
  const dir=destination(app,false);
  const prefix='launchwright-continuity-'+hash.slice(0,12);
  const zipPath=dir&&join(dir,prefix+'.zip');
  const receiptPath=dir&&join(dir,prefix+'.receipt.json');
  if(!dir||(!existsSync(zipPath)&&!existsSync(receiptPath))){
    if(includeBytes)throw new NativeError('NotFound','Exact continuity export not found');
    return{schema_version:'launchwright-browser-continuity-status/1',
      plan_sha256:hash,state:'ABSENT',external_send_performed:false};
  }
  ensure(existsSync(zipPath)&&existsSync(receiptPath),
    'Partially recovered continuity export; resubmit the same confirmed plan',
    'Conflict');
  let receipt;
  try{receipt=JSON.parse(readPrivate(receiptPath,24*1024).toString('utf8'));}
  catch(err){if(err instanceof NativeError)throw err;
    throw new NativeError('Conflict','Continuity receipt is malformed');}
  ensure(receipt.schema_version==='launchwright-release-continuity-receipt/1'&&
    receipt.plan_sha256===hash&&hex(receipt.zip_sha256)&&
    hex(receipt.before_candidate_sha256)&&hex(receipt.after_candidate_sha256)&&
    receipt.private_only===true&&receipt.unknown_frontier===true&&
    receipt.external_send_performed===false&&receipt.platform_authority===false&&
    receipt.technical_behavior_verified===false&&
    receipt.external_publication_verified===false,
    'Stored continuity receipt is not the exact private unverified export','Conflict');
  const bytes=readPrivate(zipPath,maxZipBytes);
  ensure(bytes.length===receipt.zip_bytes&&digest(bytes)===receipt.zip_sha256&&
    bytes.subarray(0,2).toString('ascii')==='PK',
    'Stored continuity ZIP differs from its exact SHA-256 receipt','Conflict');
  return{
    schema_version:'launchwright-browser-continuity-status/1',
    plan_sha256:hash,state:'READY',
    before_candidate_sha256:receipt.before_candidate_sha256,
    after_candidate_sha256:receipt.after_candidate_sha256,
    zip_sha256:receipt.zip_sha256,zip_bytes:receipt.zip_bytes,
    change_counts:receipt.change_counts,
    external_send_performed:false,platform_authority:false,
    published:false,technical_state:'UNKNOWN',
    ...(includeBytes?{bytes}:{})
  };
}
