// SPDX-License-Identifier: AGPL-3.0-only
// Local MCP tools are an adapter over the *public* Launchwright Client SDK.
// No application imports, SQLite access, Platform scheduler or Git/OS execution.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { LaunchwrightError } from '../client/index.mjs';

const MAX_RESULT_BYTES=24*1024;
const MAX_INTENT_BYTES=64*1024;
const SAFE_MUTATIONS=new Set([
  'entity.create','entity.update','change.propose','impact.plan',
  'deliverable.render','candidate.freeze','work.prepare'
]);
const id=value=>typeof value==='string'&&/^[a-z][a-z0-9_-]{1,95}$/u.test(value);
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
const sha=value=>typeof value==='string'&&/^[0-9a-f]{64}$/u.test(value);
const exact=(v,keys,required=keys)=>{
  if(!v||typeof v!=='object'||Array.isArray(v)||
    Object.keys(v).some(k=>!keys.includes(k))||required.some(k=>!Object.hasOwn(v,k)))
    throw Error('Input has unsupported or missing fields');
  return v;
};
function checkResult(value){
  const bytes=Buffer.from(JSON.stringify(value));
  if(bytes.length>MAX_RESULT_BYTES)
    throw Error('MCP response exceeds 24 KiB; narrow scope or use the public paginated Client SDK');
  return {content:[{type:'text',text:bytes.toString('utf8')}]};
}
function sourceError(err){
  const safe=err instanceof LaunchwrightError ?
    {code:err.code,message:err.message,outcome_known:err.outcomeKnown} :
    {code:'InvalidArgument',message:'MCP request was rejected; inspect local operator documentation',outcome_known:true};
  return{isError:true,content:[{type:'text',text:JSON.stringify(safe)}]};
}
function privateStat(path,isDir){
  if(!isAbsolute(path))throw Error('A private absolute path must be operator configured');
  const info=lstatSync(path);
  if(info.isSymbolicLink()||(isDir?!info.isDirectory():!info.isFile()))
    throw Error('Configured MCP state/token must be a real regular file or directory');
  if(process.platform!=='win32'&&(info.mode&0o077)!==0)
    throw Error('MCP token and pending custody require private permissions (0600 file / 0700 directory)');
  return info;
}
export function readLocalMcpToken(path){
  const info=privateStat(path,false);
  if(info.size>256)throw Error('MCP owner token file exceeds private token budget');
  const token=readFileSync(path,'utf8').trim();
  if(!/^[A-Za-z0-9_-]{32,128}$/u.test(token))
    throw Error('MCP token file has unexpected format');
  return token;
}
export function localLoopbackUrl(url){
  if(typeof url!=='string'||!/^http:\/\/(?:127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$/u.test(url))
    throw Error('MCP adapter only accepts explicit local loopback HTTP URL with port');
  const parsed=new URL(url);
  if(Number(parsed.port)>65535)throw Error('Loopback port is invalid');
  return url;
}
export function createMcpPendingJournal(root){
  if(!isAbsolute(root))throw Error('MCP pending directory must be an explicit absolute path');
  if(!existsSync(root))mkdirSync(root,{mode:0o700});
  privateStat(root,true);
  const fileFor=key=>{
    if(!uuid(key))throw Error('Unknown pending intent identity');
    return join(root,'intent-'+key+'.json');
  };
  return{
    async save(prepared){
      const key=prepared?.args?.request?.key;
      const path=fileFor(key),bytes=Buffer.from(JSON.stringify(prepared));
      if(bytes.length>MAX_INTENT_BYTES)throw Error('Prepared request exceeds 64 KiB custody budget');
      if(existsSync(path)){
        const existing=await this.load(key);
        if(JSON.stringify(existing)!==JSON.stringify(prepared))
          throw Error('The existing pending request identity belongs to different bytes');
        return;
      }
      writeFileSync(path,bytes,{mode:0o600,flag:'wx'});
    },
    async load(key){
      const path=fileFor(key);
      const stat=privateStat(path,false);
      if(stat.size>MAX_INTENT_BYTES)throw Error('Pending record exceeds recovery budget');
      const prepared=JSON.parse(readFileSync(path,'utf8'));
      if(prepared?.args?.request?.key!==key||!sha(prepared?.args?.request?.request_sha256))
        throw Error('Pending request envelope has an invalid identity/digest');
      return prepared;
    },
    async clear(key){
      const path=fileFor(key);
      if(existsSync(path)){privateStat(path,false);unlinkSync(path);}
    }
  };
}
export const PUBLIC_MCP_TOOLS=Object.freeze([
  {
    name:'launchwright_describe',description:'Read the local Launchwright capabilities. Does not execute a Platform job or publish.',
    inputSchema:{type:'object',properties:{},additionalProperties:false}
  },
  {
    name:'launchwright_list',description:'Read a bounded page of visible Launchwright records. Preserve cursor and UNKNOWN coverage.',
    inputSchema:{type:'object',properties:{
      cursor:{type:['string','null']},limit:{type:'integer',minimum:1,maximum:24}
    },additionalProperties:false}
  },
  {
    name:'launchwright_get',description:'Read one accessible resource by its real returned ID; source and rights apply.',
    inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false}
  },
  {
    name:'launchwright_impact',description:'Read known release dependencies and coverage gaps; omitted edges do not prove independence.',
    inputSchema:{type:'object',properties:{release_id:{type:'string'}},required:['release_id'],additionalProperties:false}
  },
  {
    name:'launchwright_candidate',description:'Inspect exact candidate digest and review/verifier/Publish gates, without modifying approval.',
    inputSchema:{type:'object',properties:{candidate_id:{type:'string'}},required:['candidate_id'],additionalProperties:false}
  },
  {
    name:'launchwright_history',description:'Read bounded committed domain events by durable sequence; no mutation or automatic replay.',
    inputSchema:{type:'object',properties:{
      after:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:24}
    },additionalProperties:false}
  },
  {
    name:'launchwright_channel',description:'Read exact channel package/receipt state for a release; PACKAGE_READY never means published.',
    inputSchema:{type:'object',properties:{release_id:{type:'string'}},
      required:['release_id'],additionalProperties:false}
  },
  {
    name:'launchwright_prepare',description:'Prepare a bounded local editorial or work intent WITHOUT mutation. Does not approve, send or publish. Returns durable intent identity/digest.',
    inputSchema:{type:'object',properties:{
      operation:{type:'string',enum:[...SAFE_MUTATIONS].sort()},
      input:{type:'object'}
    },required:['operation','input'],additionalProperties:false}
  },
  {
    name:'launchwright_submit',description:'After explicit operator confirmation, submit an already prepared EXACT durable intent once. No implicit retries on ambiguous replies.',
    inputSchema:{type:'object',properties:{
      intent_key:{type:'string'},request_sha256:{type:'string'},acknowledge_send:{type:'boolean'}
    },required:['intent_key','request_sha256','acknowledge_send'],additionalProperties:false}
  },
  {
    name:'launchwright_recover',description:'Look up the original pending request result after an unknown/lost reply. NEVER re-submits the mutation.',
    inputSchema:{type:'object',properties:{intent_key:{type:'string'}},required:['intent_key'],additionalProperties:false}
  }
]);
export function createLaunchwrightMcpTools(client,journal){
  if(!client||!journal)throw Error('Client SDK and private pending journal are required');
  return{
    list(){return{tools:PUBLIC_MCP_TOOLS};},
    async call(name,args={}){
      try{
        switch(name){
          case'launchwright_describe':exact(args,[]);return checkResult(await client.describe());
          case'launchwright_list':{
            exact(args,['cursor','limit'],[]);
            if(args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>24))
              throw Error('MCP page limit must be 1–24');
            const cursor=args.cursor??null;
            if(cursor!==null&&(typeof cursor!=='string'||cursor.length>4096))
              throw Error('Invalid bounded observation cursor');
            return checkResult(await client.observe('all',cursor,args.limit??12));
          }
          case'launchwright_get':
            exact(args,['id']);if(!id(args.id))throw Error('Resource ID is invalid');
            return checkResult(await client.get(args.id));
          case'launchwright_impact':
            exact(args,['release_id']);if(!id(args.release_id))throw Error('Release ID is invalid');
            return checkResult(await client.impact(args.release_id));
          case'launchwright_candidate':
            exact(args,['candidate_id']);if(!id(args.candidate_id))throw Error('Candidate ID is invalid');
            return checkResult(await client.read('candidate.inspect',{id:args.candidate_id}));
          case'launchwright_history':{
            exact(args,['after','limit'],[]);
            const after=args.after??0,limit=args.limit??12;
            if(!Number.isSafeInteger(after)||after<0||
              !Number.isInteger(limit)||limit<1||limit>24)
              throw Error('Invalid bounded event pagination');
            return checkResult(await client.read('events.list',{after,limit}));
          }
          case'launchwright_channel':
            exact(args,['release_id']);if(!id(args.release_id))throw Error('Release ID is invalid');
            return checkResult(await client.channelStatus(args.release_id));
          case'launchwright_prepare':{
            exact(args,['operation','input']);
            if(!SAFE_MUTATIONS.has(args.operation))throw Error('MCP preparation excludes approvals, channel delivery, arbitrary operations and external Publish');
            exact(args.input,Object.keys(args.input));
            const prepared=await client.prepare(args.operation,args.input,{key:randomUUID()});
            if(!sha(prepared?.args?.request?.request_sha256)||!uuid(prepared?.args?.request?.key))
              throw Error('Public Client SDK returned an invalid prepared identity');
            await journal.save(prepared);
            return checkResult({
              schema_version:'launchwright-mcp-intent/1',
              operation:prepared.operation,intent_key:prepared.args.request.key,
              request_sha256:prepared.args.request.request_sha256,
              expected:prepared.expected,durably_saved_before_send:true,
              mutation_performed:false,requires_explicit_submit:true
            });
          }
          case'launchwright_submit':{
            exact(args,['intent_key','request_sha256','acknowledge_send']);
            if(!uuid(args.intent_key)||!sha(args.request_sha256)||args.acknowledge_send!==true)
              throw Error('Explicit send confirmation, original key and SHA-256 are required');
            const prepared=await journal.load(args.intent_key);
            if(prepared.args.request.request_sha256!==args.request_sha256)
              throw Error('Saved request digest changed; do not send a substitute');
            const result=await client.sendPrepared(prepared);
            // Preserve recovery data until the result itself meets output bounds:
            // otherwise the agent might lose an already committed result.
            const reply=checkResult({schema_version:'launchwright-mcp-submission/1',intent_key:args.intent_key,
              result,mutation_performed:true,external_publish_performed:false});
            await journal.clear(args.intent_key);
            return reply;
          }
          case'launchwright_recover':{
            exact(args,['intent_key']);if(!uuid(args.intent_key))throw Error('Invalid pending intent key');
            const prepared=await journal.load(args.intent_key);
            const observed=await client.recover(prepared);
            const reply=checkResult({
              schema_version:'launchwright-mcp-recovery/1',
              intent_key:args.intent_key,
              state:observed.state,
              ...(observed.state==='recorded'?{result:observed.result}:{}),
              mutation_resubmitted:false
            });
            if(observed.state==='recorded')await journal.clear(args.intent_key);
            return reply;
          }
          default:throw Error('This MCP tool is unsupported');
        }
      }catch(err){return sourceError(err);}
    }
  };
}
