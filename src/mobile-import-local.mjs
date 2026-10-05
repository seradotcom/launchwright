// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { posix, resolve, sep } from 'node:path';
import { object, validateValue, requireCondition as ensure } from '@semwright/native-sdk';
import { noSecrets, sha, str } from './contracts.mjs';
import { execute } from './application.mjs';
import {
  MOBILE_IMPORT_SCHEMA,MOBILE_MAX_ASSETS,MOBILE_MAX_ASSET_BYTES,MOBILE_MAX_TOTAL_BYTES,
  inspectMobileAssetBytes,validateMobileImport
} from './mobile-import.mjs';

export const MOBILE_MANIFEST_FILE='launchwright-mobile-import.json';
const MANIFEST_MAX_BYTES=64*1024;

function safeRelativePath(value){
  str(value,512);
  ensure(!value.includes('\\')&&!value.startsWith('/')&&!/^[A-Za-z]:/.test(value),'Mobile manifest paths must use relative POSIX syntax');
  const normalized=posix.normalize(value);
  ensure(normalized===value&&normalized!=='.'&&!normalized.startsWith('../')&&!value.split('/').includes('..'),'Mobile asset path escapes the package');
  return value;
}
function fileInside(rootReal,relative){
  const candidate=resolve(rootReal,...relative.split('/'));
  ensure(candidate.startsWith(rootReal+sep),'Mobile asset path escapes the package');
  const stat=lstatSync(candidate);
  ensure(stat.isFile()&&!stat.isSymbolicLink(),'Mobile asset must be a regular non-symlink file');
  const actual=realpathSync(candidate);
  ensure(actual.startsWith(rootReal+sep),'Mobile asset resolves outside the package');
  return actual;
}
function readManifest(packageRoot){
  const requested=resolve(packageRoot),requestedStat=lstatSync(requested);
  ensure(requestedStat.isDirectory()&&!requestedStat.isSymbolicLink(),'Mobile package must be a real non-symlink directory');
  const rootReal=realpathSync(requested);
  const manifestPath=resolve(rootReal,MOBILE_MANIFEST_FILE);
  const manifestStat=lstatSync(manifestPath);
  ensure(manifestStat.isFile()&&!manifestStat.isSymbolicLink(),'Mobile import manifest must be a regular file');
  ensure(manifestStat.size>0&&manifestStat.size<=MANIFEST_MAX_BYTES,'Mobile import manifest exceeds size budget','ResourceExhausted');
  let manifest;
  try{manifest=JSON.parse(readFileSync(manifestPath,'utf8'));}catch{ensure(false,'Mobile import manifest is invalid JSON');}
  validateValue(manifest);noSecrets(manifest);
  return{rootReal,manifest};
}
export async function ingestMobilePackage(app,packageRoot,{key=randomUUID()}={}){
  const {rootReal,manifest}=readManifest(packageRoot);
  object(manifest,
    ['schema_version','release_id','target_id','source_id','name','build','device','os','locale','origin','captured_at','assets'],
    ['schema_version','release_id','target_id','source_id','name','build','device','os','locale','origin','captured_at','assets']);
  ensure(manifest.schema_version===MOBILE_IMPORT_SCHEMA,'Unsupported mobile import manifest schema','ProtocolMismatch');
  ensure(Array.isArray(manifest.assets)&&manifest.assets.length>0&&manifest.assets.length<=MOBILE_MAX_ASSETS,'Invalid mobile asset list');
  const loaded=[];let total=0;
  for(const asset of manifest.assets){
    object(asset,['path','name','kind','mime','sha256','width','height','rights'],
      ['path','name','kind','mime','sha256','width','height','rights']);
    const relative=safeRelativePath(asset.path),file=fileInside(rootReal,relative);
    const stat=lstatSync(file);
    ensure(stat.size>0&&stat.size<=MOBILE_MAX_ASSET_BYTES,'Mobile asset exceeds per-file size budget','ResourceExhausted');
    total+=stat.size;ensure(total<=MOBILE_MAX_TOTAL_BYTES,'Mobile package exceeds total size budget','ResourceExhausted');
    const bytes=readFileSync(file),digest=createHash('sha256').update(bytes).digest('hex');
    sha(asset.sha256);ensure(digest===asset.sha256,'Mobile asset digest does not match manifest','Conflict');
    const dimensions=inspectMobileAssetBytes(bytes,asset.mime);
    ensure(dimensions.width===asset.width&&dimensions.height===asset.height,'Mobile asset dimensions do not match manifest','Conflict');
    loaded.push({bytes,record:{
      name:asset.name,kind:asset.kind,mime:asset.mime,sha256:digest,size_bytes:bytes.length,
      width:dimensions.width,height:dimensions.height,rights:asset.rights
    }});
  }
  const input=validateMobileImport({
    schema_version:manifest.schema_version,release_id:manifest.release_id,target_id:manifest.target_id,
    source_id:manifest.source_id,name:manifest.name,build:manifest.build,device:manifest.device,os:manifest.os,
    locale:manifest.locale,origin:manifest.origin,captured_at:manifest.captured_at,
    assets:loaded.map(item=>item.record)
  });
  for(const item of loaded){
    const stagedHash=app.store.blob(item.bytes,item.record.mime,{maxBytes:MOBILE_MAX_ASSET_BYTES,label:'Mobile asset'});
    ensure(stagedHash===item.record.sha256,'Content-addressed mobile blob digest differs from manifest','Conflict');
    const staged=app.store.readBlob(item.record.sha256);
    ensure(staged.mime===item.record.mime&&staged.bytes.length===item.record.size_bytes,'Content-addressed mobile blob staging conflict','Conflict');
  }
  const result=await execute(app,'mobile.import',input,{key});
  return{...result,package:{
    manifest:MOBILE_MANIFEST_FILE,asset_count:loaded.length,total_bytes:total,local_path_retained:false
  }};
}
