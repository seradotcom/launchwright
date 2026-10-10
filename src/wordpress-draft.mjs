// SPDX-License-Identifier: AGPL-3.0-only
// R47: exact approved Markdown -> operator-owned WordPress POST DRAFT.
// WordPress REST API is a bounded external channel, never Semwright Platform.
// This module does not create a new backend or publish/merge/update remote posts.
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { readFileSync, lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { NativeError, requireCondition as ensure, validateValue } from '@semwright/native-sdk';
import { digest, iso } from './base.mjs';
import { execute } from './application.mjs';

export const WORDPRESS_DRAFT_SCHEMA='launchwright-wordpress-draft-intent/1';
const CHANNEL='wordpress-post-draft',SOURCE_PREFIX='wordpress-draft:';
const MAX_MARKDOWN=16*1024,MAX_RESPONSE=64*1024;
const sha=b=>createHash('sha256').update(b).digest('hex');
function exact(value,required,optional=[]){
  ensure(value&&typeof value==='object'&&!Array.isArray(value),
    'WordPress input must be an object','InvalidArgument');
  const permitted=new Set([...required,...optional]);
  ensure(required.every(k=>Object.hasOwn(value,k)) &&
    Object.keys(value).every(k=>permitted.has(k)),
    'WordPress intent has missing/extra fields','InvalidArgument');
}
function short(value,n,label){
  ensure(typeof value==='string'&&value.length>0&&
    Buffer.byteLength(value,'utf8')<=n && !/[\0-\x1f\x7f]/u.test(value),
    label+' must be a bounded single line','InvalidArgument');
  return value;
}
export function wordpressOrigin(raw){
  short(raw,240,'WordPress site origin');
  let url;try{url=new URL(raw);}catch{
    throw new NativeError('InvalidArgument','WordPress site origin is not a URL');
  }
  ensure(!url.username&&!url.password&&!url.search&&!url.hash&&
    url.pathname==='/'&&!url.origin.includes('@')&&
    url.origin===raw.replace(/\/$/u,''),
    'WordPress destination must be an exact origin without path, credentials, fragment or query',
    'InvalidArgument');
  const loopback=url.hostname==='127.0.0.1'&&url.protocol==='http:';
  const secure=url.protocol==='https:' &&
    /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/iu.test(url.hostname) &&
    isIP(url.hostname)===0 &&
    !['localhost','127.0.0.1','0.0.0.0'].includes(url.hostname) &&
    !url.hostname.endsWith('.local')&&!url.hostname.endsWith('.internal') &&
    !url.hostname.endsWith('.localhost');
  ensure(secure||loopback,'WordPress origin must use HTTPS, except an owned 127.0.0.1 fixture',
    'PolicyDenied');
  return url.origin;
}
function context(app,raw){
  const delivery=app.get(raw.delivery_id,'channel_delivery');
  const candidate=app.get(delivery.data.candidate_id,'candidate');
  const profile=app.get(delivery.data.profile_id,'channel_profile');
  const release=app.get(candidate.data.release_id,'release');
  ensure(delivery.data.state==='PACKAGE_READY'&&delivery.data.external_state==='NOT_SENT'&&
    !delivery.data.parent_delivery_id,'Only a fresh unsent channel package is eligible','Conflict');
  ensure(delivery.data.candidate_sha256===candidate.data.candidate_sha256,
    'WordPress channel package differs from the frozen candidate','StaleReference');
  ensure(profile.data.product_id===release.data.product_id&&
    profile.data.channel===CHANNEL &&
    profile.data.destination_class==='external-draft' &&
    profile.data.idempotency==='recover-first' &&
    profile.data.source===SOURCE_PREFIX+raw.origin &&
    profile.data.requirements?.format==='markdown',
    'WordPress destination profile must explicitly authorize this exact external DRAFT site',
    'PermissionDenied');
  const pins=candidate.data.manifest.channel_profiles??[];
  ensure(pins.some(p=>p.id===profile.id &&
    p.version?.generation===profile.version.generation &&
    p.version?.revision===profile.version.revision),
    'Candidate is not pinned to this exact WordPress channel profile','StaleReference');
  const verified=app.inspectCandidate(candidate);
  ensure(verified.private_draft_allowed&&verified.fresh&&
    verified.editorial_review.state==='APPROVED_EDITORIAL',
    'Exact fresh candidate requires independent human editorial approval',
    'ConsentRequired');
  if(verified.technical_state!=='PASS')ensure(raw.acknowledge_unverified===true,
    'Technical UNKNOWN needs separate operator consent, not a fabricated PASS','ConsentRequired');
  ensure(candidate.data.manifest.artifact_ids.includes(raw.notes_artifact_id),
    'WordPress source text must be a frozen candidate artifact','PermissionDenied');
  const artifact=app.get(raw.notes_artifact_id,'artifact');
  const frozen=candidate.data.manifest.artifacts.find(a=>a.id===raw.notes_artifact_id);
  ensure(frozen && frozen.sha256===artifact.data.sha256 &&
    frozen.bytes===artifact.data.size_bytes &&
    frozen.mime?.split(';')[0].trim().toLowerCase()==='text/markdown',
    'Only frozen Markdown editorial input can become a WordPress DRAFT',
    'Conflict');
  const bytes=app.store.readBlob(frozen.sha256).bytes;
  ensure(bytes.length>0&&bytes.length<=MAX_MARKDOWN&&
    bytes.length===frozen.bytes&&sha(bytes)===frozen.sha256,
    'Exact Markdown source is missing or exceeds 16 KiB','Conflict');
  let markdown;try{markdown=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
  catch{throw new NativeError('InvalidArgument','Frozen Markdown is not UTF-8');}
  ensure(!markdown.includes('\0'),'WordPress draft Markdown contains a NUL','InvalidArgument');
  return{delivery,candidate,profile,release,markdown,bytes,verified};
}
function escapedText(markdown){
  return markdown.replace(/[&<>"']/gu,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[ch]);
}
function expectedContent(ctx,intent){
  return '<pre class="launchwright-frozen-markdown">'+
    escapedText(ctx.markdown)+'</pre>\n'+
    '<p>Editorial DRAFT only. Source candidate SHA-256: '+
    intent.candidate_sha256+'; source Markdown SHA-256: '+intent.notes_sha256+
    '. Technical evidence remains unverified unless independently admitted.</p>\n';
}
function payload(ctx,intent){
  return{
    status:'draft',slug:intent.slug,title:intent.title,
    content:expectedContent(ctx,intent),
    comment_status:'closed',ping_status:'closed'
  };
}
export function prepareWordPressDraft(app,raw){
  validateValue(raw);
  exact(raw,['delivery_id','origin','title','notes_artifact_id','acknowledge_draft_only',
    'acknowledge_site_control','acknowledge_source_rights'],
    ['acknowledge_unverified']);
  wordpressOrigin(raw.origin);
  short(raw.title,120,'WordPress editorial draft title');
  ensure(raw.acknowledge_draft_only===true,
    'Operator must independently consent to an external WordPress DRAFT, not publication',
    'ConsentRequired');
  ensure(raw.acknowledge_site_control===true && raw.acknowledge_source_rights===true,
    'Operator must separately declare site authorization and rights to this exact editorial source',
    'ConsentRequired');
  ensure(raw.acknowledge_unverified===undefined||typeof raw.acknowledge_unverified==='boolean',
    'Unverified acknowledgement must be a boolean');
  const ctx=context(app,raw);
  const core={
    schema_version:WORDPRESS_DRAFT_SCHEMA,
    delivery_id:ctx.delivery.id,profile_id:ctx.profile.id,profile_version:ctx.profile.version,
    candidate_id:ctx.candidate.id,candidate_sha256:ctx.candidate.data.candidate_sha256,
    package_sha256:ctx.delivery.data.package_sha256,
    notes_artifact_id:raw.notes_artifact_id,notes_sha256:sha(ctx.bytes),notes_bytes:ctx.bytes.length,
    origin:raw.origin,title:raw.title,post_type:'post',status:'draft',
    acknowledge_draft_only:true,acknowledge_unverified:raw.acknowledge_unverified===true,
    site_authorized_by_operator:true,source_rights_declared_by_operator:true,
    external_publication:false,platform_authority:false,customer_acceptance:false
  };
  const intent_sha256=digest('wordpress-draft',core);
  const intent={...core,intent_sha256,slug:'launchwright-'+intent_sha256.slice(0,24)};
  ensure(Buffer.byteLength(expectedContent(ctx,intent),'utf8')<=24*1024,
    'WordPress HTML projection exceeds source-size/escaping budget: split or shorten original approved content',
    'ResourceExhausted');
  return intent;
}
export function verifyWordPressDraft(app,intent){
  validateValue(intent);
  exact(intent,[
    'schema_version','delivery_id','profile_id','profile_version','candidate_id',
    'candidate_sha256','package_sha256','notes_artifact_id','notes_sha256',
    'notes_bytes','origin','title','post_type','status','acknowledge_draft_only',
    'acknowledge_unverified','site_authorized_by_operator','source_rights_declared_by_operator',
    'external_publication','platform_authority',
    'customer_acceptance','intent_sha256','slug'
  ]);
  const {intent_sha256,slug,...core}=intent;
  ensure(typeof intent_sha256==='string'&&/^[0-9a-f]{64}$/u.test(intent_sha256)&&
    digest('wordpress-draft',core)===intent_sha256&&
    slug==='launchwright-'+intent_sha256.slice(0,24),
    'Private WordPress draft intent differs from exact source','Conflict');
  const actual=prepareWordPressDraft(app,{
    delivery_id:core.delivery_id,origin:core.origin,title:core.title,
    notes_artifact_id:core.notes_artifact_id,acknowledge_draft_only:core.acknowledge_draft_only,
    acknowledge_unverified:core.acknowledge_unverified,
    acknowledge_site_control:core.site_authorized_by_operator,
    acknowledge_source_rights:core.source_rights_declared_by_operator
  });
  ensure(JSON.stringify(actual)===JSON.stringify(intent),
    'WordPress source, candidate, channel profile or Markdown bytes changed','StaleReference');
  return{ctx:context(app,{
    delivery_id:core.delivery_id,origin:core.origin,title:core.title,
    notes_artifact_id:core.notes_artifact_id,acknowledge_unverified:core.acknowledge_unverified
  }),intent};
}
function checkPost(post,intent,body){
  ensure(post && Number.isSafeInteger(post.id)&&post.id>0&&
    post.slug===intent.slug&&post.status==='draft'&&post.type==='post'&&
    post.title?.raw===intent.title&&post.content?.raw===body&&
    post.comment_status==='closed'&&post.ping_status==='closed',
    'WordPress remote post no longer matches the exact approved DRAFT: refuse clobber or publication',
    'Conflict');
  return post;
}
function inspectList(posts,intent,body){
  ensure(Array.isArray(posts)&&posts.length<=1,'WordPress slug has ambiguous remote post identity','Conflict');
  return posts.length?checkPost(posts[0],intent,body):null;
}
export async function sendWordPressDraft(app,intent,remote,{
  confirm_origin,confirm_candidate_sha256,confirm_intent_sha256,
  acknowledge_first_send=false,recover_only=false
}={}){
  const {ctx}=verifyWordPressDraft(app,intent);
  ensure(confirm_origin===intent.origin&&
    confirm_candidate_sha256===intent.candidate_sha256&&
    confirm_intent_sha256===intent.intent_sha256,
    'Operator must confirm exact origin, Candidate SHA and saved intent SHA',
    'ConsentRequired');
  for(const name of ['findBySlug','getPost','createDraft'])
    ensure(remote&&typeof remote[name]==='function','Bounded CMS transport is incomplete');
  const body=expectedContent(ctx,intent);
  let post=inspectList(await remote.findBySlug(intent.origin,intent.slug),intent,body);
  let sent=false;
  if(!post){
    ensure(recover_only!==true,
      'No matching DRAFT exists; read-only recovery will not create a remote post','NotFound');
    ensure(acknowledge_first_send===true,
      'An explicit first-send authorization is required for this exact external WordPress DRAFT',
      'ConsentRequired');
    try{await remote.createDraft(intent.origin,payload(ctx,intent));sent=true;}
    catch{
      throw new NativeError('Unavailable',
        'WordPress DRAFT creation outcome unknown; use recover-only with the same saved intent before any re-send',
        false);
    }
    post=inspectList(await remote.findBySlug(intent.origin,intent.slug),intent,body);
  }
  ensure(post,'Remote WordPress did not expose the exact private draft','Unavailable');
  const authoritative=checkPost(await remote.getPost(intent.origin,post.id),intent,body);
  ensure(authoritative.id===post.id&&
    inspectList(await remote.findBySlug(intent.origin,intent.slug),intent,body)?.id===post.id,
    'WordPress draft identity changed during authorized readback','Conflict');
  verifyWordPressDraft(app,intent);
  const proof={
    schema_version:'launchwright-wordpress-draft-proof/1',
    intent_sha256:intent.intent_sha256,origin:intent.origin,post_id:post.id,
    slug:intent.slug,candidate_sha256:intent.candidate_sha256,
    notes_sha256:intent.notes_sha256,post_status:'draft',
    published:false,platform_authority:false,customer_acceptance:false
  };
  const receipt_digest=digest('wordpress-draft-receipt',proof);
  const prior=app.list('channel_delivery',ctx.release.id).filter(row=>
    row.data.root_delivery_id===ctx.delivery.id && row.data.external_state==='DRAFT_CREATED');
  ensure(prior.length<=1,'Multiple competing application channel receipts','Conflict');
  if(prior.length){
    ensure(prior[0].data.receipt_digest===receipt_digest&&
      prior[0].data.external_id==='wordpress:'+intent.origin+':post/'+post.id,
      'Local WordPress draft custody differs from external exact receipt','Conflict');
    return{record:prior[0],proof,recovered:true,external_send_performed:false};
  }
  const record=(await execute(app,'channel.record_outcome',{
    delivery_id:ctx.delivery.id,state:'DRAFT_CREATED',
    external_id:'wordpress:'+intent.origin+':post/'+post.id,
    receipt_digest,observed_at:iso(),
    message:'Operator-owned WordPress post DRAFT; exact Markdown source readback and no publication'
  })).entity;
  return{record,proof,recovered:!sent,external_send_performed:sent};
}
export function readPrivateWordPressCredentials(file){
  ensure(typeof file==='string'&&file.length>0&&file.length<2048&&isAbsolute(file),
    'Private credentials file path must be provided','InvalidArgument');
  const fs=awaitFileStat(file);
  ensure(fs.isFile()&&!fs.isSymbolicLink()&&fs.size>0&&fs.size<=2048&&
    (process.platform==='win32'||(fs.mode&0o077)===0),
    'WordPress credentials require a 0600 regular owner-only JSON file','PermissionDenied');
  const data=JSON.parse(readFileSync(file,'utf8'));
  exact(data,['username','application_password']);
  short(data.username,80,'WordPress username');
  ensure(!data.username.includes(':'),'WordPress Basic authentication username cannot contain a colon','InvalidArgument');
  ensure(typeof data.application_password==='string'&&
    data.application_password.length>=8&&data.application_password.length<=250&&
    !/[\0\r\n]/u.test(data.application_password),
    'WordPress application password format is invalid','InvalidArgument');
  return{username:data.username,application_password:data.application_password};
}
function awaitFileStat(file){return lstatSync(file);}
async function boundedJson(response){
  ensure(response&&response.status>=200&&response.status<300&&
    response.headers?.get('content-type')?.toLowerCase().includes('application/json'),
    'WordPress API must return successful JSON without redirect or HTML','Unavailable');
  const reader=response.body?.getReader();
  ensure(reader,'WordPress response stream is unavailable','Unavailable');
  const chunks=[];let size=0;
  while(true){
    const {value,done}=await reader.read();
    if(done)break;
    size+=value.length;
    if(size>MAX_RESPONSE){await reader.cancel();throw new NativeError('ResourceExhausted','WordPress reply exceeds 64 KiB');}
    chunks.push(Buffer.from(value));
  }
  try{return JSON.parse(Buffer.concat(chunks,size).toString('utf8'));}
  catch{throw new NativeError('ProtocolMismatch','WordPress reply is not JSON');}
}
export function wordpressHttpTransport(origin,creds,{fetchImpl=fetch}={}){
  wordpressOrigin(origin);
  ensure(creds&&typeof creds.username==='string'&&
    typeof creds.application_password==='string',
    'WordPress private credentials must be loaded from an owned file');
  const auth='Basic '+Buffer.from(creds.username+':'+creds.application_password).toString('base64');
  async function call(path,method='GET',data=null){
    const url=new URL('/wp-json/wp/v2/posts'+path,origin);
    ensure(url.origin===origin,'WordPress request changed origin','PolicyDenied');
    const headers={'accept':'application/json','authorization':auth};
    if(method==='POST')headers['content-type']='application/json';
    const body=data===null?undefined:JSON.stringify(data);
    ensure(!body||Buffer.byteLength(body)<=MAX_MARKDOWN*2,
      'WordPress outgoing post exceeds 32 KiB','ResourceExhausted');
    let reply;
    try{reply=await fetchImpl(url.toString(),{
      method,headers,body,redirect:'manual',signal:AbortSignal.timeout(10000)
    });}catch{
      throw new NativeError('Unavailable','WordPress connection failed or timed out; outcome may be unknown',false);
    }
    return boundedJson(reply);
  }
  return{
    async findBySlug(site,slug){
      ensure(site===origin && /^launchwright-[a-f0-9]{24}$/u.test(slug),
        'Unapproved WordPress origin or draft slug','PermissionDenied');
      const query=new URLSearchParams({
        context:'edit',status:'any',slug,per_page:'2'
      });
      return call('?'+query);
    },
    async getPost(site,id){
      ensure(site===origin&&Number.isSafeInteger(id)&&id>0,
        'WordPress resource identity differs from the approved origin','PermissionDenied');
      return call('/'+id+'?context=edit');
    },
    async createDraft(site,post){
      ensure(site===origin&&post&&post.status==='draft'&&
        post.comment_status==='closed'&&post.ping_status==='closed'&&
        /^launchwright-[a-f0-9]{24}$/u.test(post.slug) &&
        typeof post.content==='string'&&post.content.length<25000,
        'WordPress transport only creates strict private drafts','PermissionDenied');
      return call('','POST',post);
    }
  };
}
