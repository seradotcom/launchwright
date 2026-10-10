// SPDX-License-Identifier: AGPL-3.0-only
// R52: Google Android Publisher REST v3 Edit GET/images list/media upload only.
// No edits.insert, edits.commit, deleteall, images.delete, track or app writes.
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { NativeError, requireCondition as ensure } from '@semwright/native-sdk';

const ORIGIN='https://androidpublisher.googleapis.com';
const ROOT='/androidpublisher/v3/applications/';
const UPLOAD='/upload/androidpublisher/v3/applications/';
const IMAGE_TYPES=new Set(['phoneScreenshots','icon','featureGraphic']);
function scoped(v,re,name){
  ensure(typeof v==='string'&&v.length>0&&v.length<=220&&re.test(v),
    'Google Play '+name+' is malformed or too long','InvalidArgument');
  return encodeURIComponent(v);
}
function components(packageName,editId,locale,type){
  const p=scoped(packageName,/^(?:[A-Za-z][A-Za-z0-9_]*\.)+[A-Za-z][A-Za-z0-9_]*$/u,'app package');
  const e=scoped(editId,/^[A-Za-z0-9_-]+$/u,'existing Edit identity');
  if(locale===undefined)return{p,e};
  const l=scoped(locale,/^[A-Za-z]{2}(?:-[A-Za-z0-9]{2,8}){0,2}$/u,'listing language');
  ensure(IMAGE_TYPES.has(type),'Unsupported Google Play ImageType','InvalidArgument');
  return{p,e,l,t:type};
}
function tokenFromFile(path){
  ensure(typeof path==='string'&&isAbsolute(path)&&path.length<=2048,
    'Google Play access token must be provided via an absolute private file path',
    'InvalidArgument');
  const stat=lstatSync(path);
  ensure(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>=12&&stat.size<=4096&&
    (process.platform==='win32'||(stat.mode&0o077)===0),
    'Google Play bearer token file must be private 0600 and not a symlink',
    'PermissionDenied');
  const token=readFileSync(path,'utf8').trim();
  ensure(/^[A-Za-z0-9._~-]{10,4000}$/u.test(token),
    'Google Play OAuth token file is not a bounded bearer token',
    'InvalidArgument');
  return token;
}
async function parseBoundedJSON(response){
  const chunks=[];let bytes=0;
  const reader=response.body?.getReader();
  if(!reader)throw new NativeError('ProtocolMismatch','Google Play REST returned no JSON body');
  try{
    for(;;){
      const item=await reader.read();
      if(item.done)break;
      bytes+=item.value.byteLength;
      if(bytes>128*1024)
        throw new NativeError('ResourceExhausted','Google Play REST JSON exceeds 128 KiB');
      chunks.push(Buffer.from(item.value));
    }
  }finally{reader.releaseLock();}
  let value;
  try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{throw new NativeError('ProtocolMismatch','Google Play REST response was not valid bounded JSON');}
  ensure(value&&typeof value==='object'&&!Array.isArray(value),
    'Google Play REST response is not an object','ProtocolMismatch');
  return value;
}
export function createGooglePlayTransport({accessTokenFile,fetchImpl=fetch}={}){
  const bearer=tokenFromFile(accessTokenFile);
  ensure(typeof fetchImpl==='function','Google Play requires an explicit HTTP client','InvalidArgument');
  async function request(path,{method='GET',body}={}){
    const endpoint=new URL(path,ORIGIN);
    ensure(endpoint.origin===ORIGIN &&
      (endpoint.pathname.startsWith(ROOT)||endpoint.pathname.startsWith(UPLOAD)),
      'Google Play request must stay on pinned AndroidPublisher HTTPS origin','PermissionDenied');
    let response;
    try{
      response=await fetchImpl(endpoint.href,{
        method,headers:{
          Authorization:'Bearer '+bearer,
          Accept:'application/json',
          ...(body?{'Content-Type':'image/png'}:{})
        },
        ...(body?{body}:{}),
        redirect:'error',
        signal:AbortSignal.timeout(30000)
      });
    }catch{
      throw new NativeError('Unavailable',
        method==='POST'?
          'Google Play upload outcome unknown; use recover-only, never blind replay':
          'Google Play authenticated read unavailable. No remote write attempted',
        method==='POST'?false:true);
    }
    ensure(response&&typeof response.status==='number',
      'Google Play REST did not return a status code','ProtocolMismatch');
    if(!response.ok){
      throw new NativeError(response.status===404?'NotFound':'Unavailable',
        method==='POST'?
          'Google Play media POST returned an error: remote outcome may be unknown; recover-only':
          'Google Play Edit/image read failed. Verify account scope and the original Edit ID',
        method==='POST'?false:true);
    }
    return parseBoundedJSON(response);
  }
  return{
    async getEdit(packageName,editId){
      const {p,e}=components(packageName,editId);
      return request(ROOT+p+'/edits/'+e);
    },
    async listImages(packageName,editId,locale,type){
      const {p,e,l,t}=components(packageName,editId,locale,type);
      const data=await request(ROOT+p+'/edits/'+e+'/listings/'+l+'/'+t);
      ensure(data.images===undefined||Array.isArray(data.images),
        'Google Play images.list returned an invalid collection','ProtocolMismatch');
      ensure((data.images??[]).length<=10,
        'Google Play images.list exceeds bounded local profile','ResourceExhausted');
      return data.images??[];
    },
    async uploadImage(packageName,editId,locale,type,bytes){
      const {p,e,l,t}=components(packageName,editId,locale,type);
      ensure(Buffer.isBuffer(bytes)&&bytes.length>30&&bytes.length<=12*1024*1024&&
        bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
        'Google Play media upload needs a bounded PNG body','InvalidArgument');
      const data=await request(UPLOAD+p+'/edits/'+e+'/listings/'+l+'/'+t+
        '?uploadType=media',{method:'POST',body:bytes});
      ensure(data.image&&typeof data.image==='object'&&
        typeof data.image.id==='string'&&
        typeof data.image.sha256==='string',
        'Google Play upload response lacks image ID or SHA-256','ProtocolMismatch');
      return data.image;
    }
  };
}
export const GOOGLE_PLAY_OFFICIAL_ORIGIN=ORIGIN;
