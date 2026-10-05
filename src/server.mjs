// SPDX-License-Identifier: AGPL-3.0-only
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';
import { NativeError, dispatchApplication, applicationContext, requireCondition as ensure, object, validateValue } from '@semwright/native-sdk';
import { OPERATION_SCOPES, makeRequest, str, idText } from './contracts.mjs';
import { buildPrivateChannelBundle } from './channel-bundle.mjs';
const CODE=dirname(dirname(fileURLToPath(import.meta.url)));
const statusFor={InvalidArgument:400,PermissionDenied:403,PolicyDenied:403,ConsentRequired:403,NotFound:404,StaleReference:409,Conflict:409,ResourceExhausted:413,Unavailable:503,Unsupported:501};
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req){
  ensure(req.headers['content-type']?.split(';')[0]==='application/json','Expected application/json');
  ensure(!req.headers['content-encoding'],'Compressed request bodies are not accepted');
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;ensure(size<=256*1024,'Request body exceeds budget','ResourceExhausted');chunks.push(chunk);}
  let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new NativeError('InvalidArgument','Invalid JSON');}validateValue(data);return data;
}
export function localToken(root){const path=join(root,'session-token');if(existsSync(path)){ensure(!lstatSync(path).isSymbolicLink(),'Token file cannot be a symlink');return str(readFileSync(path,'utf8').trim(),128);}const token=randomBytes(32).toString('base64url');writeFileSync(path,token+'\n',{mode:0o600,flag:'wx'});return token;}
export function createAppServer(app,{token=localToken(app.store.root),port=4317}={}){
  const allowedHosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
  const staticFiles=new Map([['/',['web/index.html','text/html; charset=utf-8']],['/app.mjs',['web/app.mjs','text/javascript; charset=utf-8']],['/style.css',['web/style.css','text/css; charset=utf-8']],['/client.mjs',['client/index.mjs','text/javascript; charset=utf-8']],['/LICENSE',['LICENSE','text/plain; charset=utf-8']]]);
  let actualPort=port;
  const server=createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try{
      ensure(allowedHosts.has(req.headers.host),'Unexpected Host header','PermissionDenied');
      if(req.headers.origin)ensure(req.headers.origin===`http://${req.headers.host}`,'Cross-origin requests are not permitted','PermissionDenied');
      ensure(!req.headers['sec-fetch-site']||['none','same-origin'].includes(req.headers['sec-fetch-site']),'Cross-site request denied','PermissionDenied');
      ensure(!req.url.includes('?'),'Query parameters are not accepted on local routes');
      const path=req.url;const asset=staticFiles.get(path);
      if(req.method==='GET'&&asset){res.writeHead(200,{'Content-Type':asset[1],'Cache-Control':'no-store'});res.end(readFileSync(join(CODE,asset[0])));return;}
      if(req.method==='POST'&&path==='/api/v1/session'){
        const data=await body(req);object(data,['token'],['token']);ensure(equal(data.token,token),'Invalid local session token','PermissionDenied');
        res.setHeader('Set-Cookie',`launchwright=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);json(res,200,{authenticated:true,mode:'local-single-owner'});return;
      }
      const bearer=req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):null;
      const cookies=(req.headers.cookie??'').split(';').map(x=>x.trim());const cookie=cookies.find(x=>x.startsWith('launchwright='))?.slice(13);
      ensure(equal(bearer,token)||equal(cookie,token),'Unlock this local workspace with its session token','PermissionDenied');
      const call=(operation,input)=>dispatchApplication(app,'invoke',operation,input,applicationContext(randomUUID(),null));
      if(path==='/api/v1/describe'&&req.method==='GET'){json(res,200,await call('workspace.describe',{}));return;}
      if(req.method==='GET'&&/^\/api\/v1\/artifacts\/[a-z0-9_-]+\/download$/.test(path)){
        app.allow('read');const id=path.split('/')[4];idText(id);const artifact=app.get(id,'artifact');const bytes=app.store.readBlob(artifact.data.sha256);
        res.writeHead(200,{'Content-Type':bytes.mime,'Content-Disposition':`attachment; filename="${artifact.id}.${artifact.data.extension}"`,'Content-Length':bytes.bytes.length,'Cache-Control':'no-store','ETag':`"${artifact.data.sha256}"`});res.end(bytes.bytes);return;
      }
      if(req.method==='GET'&&/^\/api\/v1\/channel-deliveries\/[a-z0-9_-]+\/bundle\.zip$/.test(path)){
        app.allow('read');const id=path.split('/')[4];idText(id);const bundle=buildPrivateChannelBundle(app,id);
        res.writeHead(200,{'Content-Type':bundle.mime,'Content-Disposition':`attachment; filename="${bundle.filename}"`,'Content-Length':bundle.bytes.length,'Cache-Control':'no-store','ETag':`"${bundle.sha256}"`});res.end(bundle.bytes);return;
      }
      ensure(req.method==='POST','Route not found','NotFound');const data=await body(req);
      if(path==='/api/v1/read'){object(data,['operation','input'],['operation','input']);ensure(OPERATION_SCOPES[data.operation]==='read','This route accepts only read operations');json(res,200,await call(data.operation,data.input));}
      else if(path==='/api/v1/observe')json(res,200,await dispatchApplication(app,'observe',null,data,applicationContext(randomUUID())));
      else if(path==='/api/v1/recover')json(res,200,await dispatchApplication(app,'lookup',null,data,applicationContext(randomUUID())));
      else if(path==='/api/v1/prepare'){
        object(data,['operation','input','expected','key'],['operation','input','key']);str(data.key,128);const scope=OPERATION_SCOPES[data.operation];ensure(scope&&scope!=='read','Unknown mutation');app.allow(scope);
        const expected=data.expected??app.store.version(),args=makeRequest(data.operation,data.input,expected,app.store.meta().epoch,data.key);
        // Preparation has no durable effects and is NOT authorization to bypass the dispatcher's checks.
        json(res,200,{schema_version:'launchwright-prepared/1',operation:data.operation,expected,args});
      }else if(path==='/api/v1/invoke'){
        object(data,['schema_version','operation','expected','args'],['schema_version','operation','expected','args']);ensure(data.schema_version==='launchwright-prepared/1','Prepared request schema mismatch');
        json(res,200,await dispatchApplication(app,'invoke',data.operation,data.args,applicationContext(data.args?.request?.key??'invalid',data.expected)));
      }else if(path==='/api/v1/logout'){res.setHeader('Set-Cookie','launchwright=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');json(res,200,{authenticated:false});}
      else throw new NativeError('NotFound','Route not found');
    }catch(err){const failure=err instanceof NativeError?err:new NativeError('BackendFailed','Request could not complete',req.method==='GET');if(!res.headersSent)json(res,statusFor[failure.code]??500,{error:failure.record()});else res.end();}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;server.maxHeadersCount=64;
  return{server,token,async listen(){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});actualPort=server.address().port;allowedHosts.add(`127.0.0.1:${actualPort}`);allowedHosts.add(`localhost:${actualPort}`);return`http://127.0.0.1:${actualPort}`;},async close(){server.closeAllConnections();await new Promise(r=>server.close(r));},get port(){return actualPort;}};
}
