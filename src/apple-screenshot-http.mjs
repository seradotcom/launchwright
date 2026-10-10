// SPDX-License-Identifier: AGPL-3.0-only
// R51: strictly bound App Store Connect API + Apple signed blobstore PUT.
// Uses an operator-supplied short-lived private JWT file. No app submission.
import { lstatSync,readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { NativeError, requireCondition as ensure } from '@semwright/native-sdk';

const API='https://api.appstoreconnect.apple.com';
const scope=/^[A-Za-z0-9_-]{5,128}$/u;
const safeId=value=>{
  ensure(typeof value==='string'&&scope.test(value),
    'App Store opaque resource ID is malformed','InvalidArgument');
  return encodeURIComponent(value);
};
export function readAppleJwtFile(path){
  ensure(typeof path==='string'&&isAbsolute(path)&&path.length<2048,
    'Operator must supply an absolute private Apple API JWT token-file path',
    'InvalidArgument');
  const stat=lstatSync(path);
  ensure(stat.isFile()&&!stat.isSymbolicLink()&&
    stat.size>=32&&stat.size<=8192&&
    (process.platform==='win32'||(stat.mode&0o077)===0),
    'Apple JWT token file must be a real private 0600 regular file',
    'PermissionDenied');
  const value=readFileSync(path,'utf8').trim();
  ensure(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(value),
    'Apple API token must contain only a compact signed JWT',
    'InvalidArgument');
  return value;
}
function boundedResponse(result,label){
  ensure(result&&typeof result.status==='number',
    label+' did not return an HTTP response','Unavailable');
  if(!result.ok)throw new NativeError('Unavailable',
    label+' returned HTTP '+result.status+'; response body not logged',false);
}
async function smallJson(response,label){
  boundedResponse(response,label);
  const length=response.headers?.get?.('content-length');
  ensure(length===null||length===undefined||Number(length)<=65536,
    label+' returned too many metadata bytes','ResourceExhausted');
  const bytes=Buffer.from(await response.arrayBuffer());
  ensure(bytes.length<=65536,
    label+' returned unbounded metadata','ResourceExhausted');
  try{return JSON.parse(bytes.toString('utf8'));}
  catch{throw new NativeError('ProtocolMismatch',
    label+' response is not bounded JSON metadata');}
}
function blobstoreUrl(raw){
  ensure(typeof raw==='string'&&raw.length>0&&raw.length<=8192,
    'Unsigned or oversized Apple asset upload URL','PolicyDenied');
  let uri;
  try{uri=new URL(raw);}catch{throw new NativeError('PolicyDenied',
    'Apple asset upload URL is invalid');}
  ensure(uri.protocol==='https:'&&!uri.username&&!uri.password&&!uri.hash&&
    (uri.hostname==='blobstore.apple.com'||uri.hostname.endsWith('.blobstore.apple.com'))&&
    (uri.port===''||uri.port==='443'),
    'Upload target must be a signed HTTPS Apple blobstore endpoint','PolicyDenied');
  return raw;
}
function headersFor(operation){
  ensure(operation?.method==='PUT'&&Array.isArray(operation.requestHeaders)&&
    operation.requestHeaders.length<=12,
    'Apple asset upload operation has unsupported method/headers','PolicyDenied');
  const headers={};
  for(const row of operation.requestHeaders){
    ensure(row&&typeof row.name==='string'&&
      /^(?:content-type|content-length|x-[a-z0-9-]{1,60})$/iu.test(row.name)&&
      typeof row.value==='string'&&row.value.length<=512&&
      !/[\r\n\0]/u.test(row.value)&&
      !Object.keys(headers).some(x=>x.toLowerCase()===row.name.toLowerCase()),
      'Apple blobstore upload header is unsafe or duplicates an existing header',
      'PolicyDenied');
    headers[row.name]=row.value;
  }
  return headers;
}
export function createAppleScreenshotTransport({token_file,fetchImpl=fetch}={}){
  const token=readAppleJwtFile(token_file);
  ensure(typeof fetchImpl==='function','An HTTPS client is required','InvalidArgument');
  async function api(path,{method='GET',data=null}={}){
    ensure(typeof path==='string'&&
      /^\/v1\/[A-Za-z0-9_\/%-]+(?:\?(?:limit=50|include=appStoreVersionLocalization))?$/u.test(path)&&
      ['GET','POST','PATCH'].includes(method),
      'Apple API request path or method is not in the bounded screenshot subset',
      'PolicyDenied');
    let result;
    try{
      result=await fetchImpl(API+path,{
        method,redirect:'error',headers:{
          Authorization:'Bearer '+token,'Accept':'application/json',
          ...(data===null?{}:{'Content-Type':'application/json'})
        },body:data===null?undefined:JSON.stringify(data),
        signal:AbortSignal.timeout(20000)
      });
    }catch{
      throw new NativeError('Unavailable',
        'Apple API outcome unknown. Recover the exact resource before retry.',false);
    }
    return smallJson(result,'Apple screenshot API');
  }
  return {
    async getScreenshotSet(id){
      return api('/v1/appScreenshotSets/'+safeId(id)+'?include=appStoreVersionLocalization');
    },
    async getLocalization(id){
      return api('/v1/appStoreVersionLocalizations/'+safeId(id));
    },
    async listScreenshots(id){
      return api('/v1/appScreenshotSets/'+safeId(id)+'/appScreenshots?limit=50');
    },
    async createScreenshot({screenshot_set_id,file_name,file_size}){
      ensure(typeof file_name==='string'&&/^launchwright-[a-f0-9]{12}-\d{2}[.]png$/u.test(file_name)&&
        Number.isSafeInteger(file_size)&&file_size>0&&file_size<=12*1024*1024,
        'Apple screenshot reservation has unexpected source filename or size','InvalidArgument');
      return api('/v1/appScreenshots',{method:'POST',data:{
        data:{type:'appScreenshots',
          attributes:{fileName:file_name,fileSize:file_size},
          relationships:{appScreenshotSet:{data:{
            type:'appScreenshotSets',id:safeId(screenshot_set_id)
          }}}
        }
      }});
    },
    async uploadPart(operation,bytes){
      ensure(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=12*1024*1024,
        'Asset upload part must contain bounded approved PNG bytes','InvalidArgument');
      const target=blobstoreUrl(operation?.url);
      const headers=headersFor(operation);
      let result;
      try{result=await fetchImpl(target,{
        method:'PUT',redirect:'error',headers,
        body:bytes,signal:AbortSignal.timeout(60000)
      });}
      catch{throw new NativeError('Unavailable',
        'Apple signed chunk upload outcome unknown; do not resend blindly',false);}
      boundedResponse(result,'Apple signed asset part');
      return {part_uploaded:true,remote_response_authority:'signed-asset-only'};
    },
    async commitScreenshot(id,checksum){
      ensure(typeof checksum==='string'&&/^[0-9a-f]{32}$/u.test(checksum),
        'Apple asset checksum must be exact MD5 of original normalized PNG','InvalidArgument');
      return api('/v1/appScreenshots/'+safeId(id),{method:'PATCH',data:{
        data:{type:'appScreenshots',id,
          attributes:{uploaded:true,sourceFileChecksum:checksum}
        }
      }});
    }
  };
}
