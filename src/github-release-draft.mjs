// SPDX-License-Identifier: AGPL-3.0-only
// Explicit, operator-owned GitHub RELEASE DRAFT transport. Never publishes, moves
// tags, grants Platform authority or executes untrusted release artifacts.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeError, requireCondition as ensure, validateValue } from '@semwright/native-sdk';
import { digest, iso } from './base.mjs';
import { buildPrivateChannelBundle } from './channel-bundle.mjs';
import { execute } from './application.mjs';

export const GITHUB_DRAFT_SCHEMA = 'launchwright-github-draft-intent/1';
export const GITHUB_DRAFT_SOURCE = 'github-release-draft:';
const REMOTE_MARKER = '<!-- launchwright-github-draft-sha256:';
const MAX_NOTES_BYTES = 64 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function exactKeys(value, required, optional=[]) {
  ensure(value && typeof value==='object' && !Array.isArray(value), 'Expected bounded input object');
  const allowed=new Set([...required,...optional]);
  ensure(Object.keys(value).every(key=>allowed.has(key)) && required.every(key=>Object.hasOwn(value,key)),
    'Input contains missing or extra fields');
}
function text(value,max,label) {
  ensure(typeof value==='string' && value.length>0 && Buffer.byteLength(value,'utf8')<=max &&
    !/[\0-\x1f\x7f]/u.test(value),label+' must be bounded single-line text');
  return value;
}
function repositoryName(value) {
  text(value,128,'GitHub repository');
  ensure(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/u.test(value) &&
    !value.includes('..') && !value.endsWith('.'), 'Expected explicit OWNER/REPO');
  return value;
}
function releaseTag(value) {
  text(value,120,'Release tag');
  ensure(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u.test(value) &&
    !value.endsWith('.') && !value.includes('..') && !value.endsWith('.lock'),
    'GitHub tag must be a bounded single path component');
  return value;
}
function commitSha(value) {
  ensure(typeof value==='string' && /^[a-f0-9]{40}$/u.test(value),'An exact 40-character lowercase target commit SHA is required');
  return value;
}
function requestedBytes(app, notesArtifactId, candidate) {
  ensure(candidate.data.manifest.artifact_ids.includes(notesArtifactId),
    'Release notes must be a frozen artifact in this candidate','PermissionDenied');
  const artifact=app.get(notesArtifactId,'artifact');
  const frozen=candidate.data.manifest.artifacts.find(x=>x.id===notesArtifactId);
  ensure(frozen && frozen.sha256===artifact.data.sha256 &&
    ['text/markdown','text/plain'].includes(frozen.mime.split(';')[0].trim().toLowerCase()),
    'Release notes must be an exact frozen Markdown or plain-text artifact','Conflict');
  const body=app.store.readBlob(frozen.sha256).bytes;
  ensure(body.length>0 && body.length<=MAX_NOTES_BYTES &&
    body.length===frozen.bytes,'Frozen release notes exceed budget or changed','Conflict');
  const notes=new TextDecoder('utf-8',{fatal:true}).decode(body);
  ensure(!notes.includes('\0'),'Release notes contain NUL');
  return {notes,sha256:sha256(body)};
}
function getContext(app,input) {
  const delivery=app.get(input.delivery_id,'channel_delivery');
  const profile=app.get(delivery.data.profile_id,'channel_profile');
  const candidate=app.get(delivery.data.candidate_id,'candidate');
  const release=app.get(candidate.data.release_id,'release');
  ensure(delivery.data.state==='PACKAGE_READY' && delivery.data.external_state==='NOT_SENT' &&
    !delivery.data.parent_delivery_id, 'Only an unsent immutable channel package can start a GitHub draft','Conflict');
  ensure(delivery.data.candidate_sha256===candidate.data.candidate_sha256,
    'Channel package differs from frozen candidate','StaleReference');
  ensure(profile.data.product_id===release.data.product_id &&
    profile.data.channel==='github-release-draft' &&
    profile.data.destination_class==='external-draft' &&
    profile.data.idempotency==='recover-first' &&
    profile.data.source===GITHUB_DRAFT_SOURCE+input.repository &&
    profile.data.requirements?.format==='zip',
    'Channel profile does not authorize this exact GitHub draft destination','PermissionDenied');
  const pins=candidate.data.manifest.channel_profiles??[];
  ensure(pins.some(p=>p.id===profile.id &&
    p.version?.generation===profile.version.generation &&
    p.version?.revision===profile.version.revision),
    'GitHub destination profile is not pinned by the candidate','StaleReference');
  const checked=app.inspectCandidate(candidate);
  ensure(checked.private_draft_allowed && checked.fresh,
    'Candidate has stale inputs or failed integrity gates','StaleReference');
  ensure(checked.editorial_review.state==='APPROVED_EDITORIAL',
    'An approved editorial review is required before any remote GitHub draft','ConsentRequired');
  ensure(input.acknowledge_draft_only===true,
    'Explicitly acknowledge this creates only a remote draft, never a published release','ConsentRequired');
  if(checked.technical_state!=='PASS') ensure(input.acknowledge_unverified===true,
    'Unknown verification/capture coverage requires explicit operator acknowledgement','ConsentRequired');
  const bundle=buildPrivateChannelBundle(app,delivery.id);
  const rendered=requestedBytes(app,input.notes_artifact_id,candidate);
  return {delivery,profile,candidate,release,bundle,rendered,checked};
}
export function prepareGithubDraft(app,raw) {
  validateValue(raw);
  const keys=['delivery_id','repository','tag','tag_commit_sha','title','notes_artifact_id','acknowledge_draft_only','acknowledge_unverified'];
  exactKeys(raw,keys.slice(0,-1),['acknowledge_unverified']);
  repositoryName(raw.repository);releaseTag(raw.tag);commitSha(raw.tag_commit_sha);
  text(raw.title,120,'Draft title');
  ensure(!raw.title.startsWith('-'),'Draft title must not begin with an option prefix');
  ensure(typeof raw.notes_artifact_id==='string' && /^[a-z][a-z0-9_-]{1,95}$/u.test(raw.notes_artifact_id),
    'Notes artifact identity is invalid');
  ensure(raw.acknowledge_unverified===undefined || typeof raw.acknowledge_unverified==='boolean',
    'Unverified acknowledgement must be boolean');
  const ctx=getContext(app,raw);
  const core={
    schema_version:GITHUB_DRAFT_SCHEMA,
    delivery_id:ctx.delivery.id,
    candidate_id:ctx.candidate.id,
    candidate_sha256:ctx.candidate.data.candidate_sha256,
    package_sha256:ctx.delivery.data.package_sha256,
    bundle_sha256:ctx.bundle.sha256,
    bundle_bytes:ctx.bundle.bytes.length,
    repository:raw.repository,
    tag:raw.tag,
    tag_commit_sha:raw.tag_commit_sha,
    title:raw.title,
    notes_artifact_id:raw.notes_artifact_id,
    notes_sha256:ctx.rendered.sha256,
    profile_id:ctx.profile.id,
    profile_version:ctx.profile.version,
    acknowledge_draft_only:true,
    acknowledge_unverified:raw.acknowledge_unverified===true
  };
  return {...core,intent_sha256:digest('github-draft-intent-v1',core)};
}
function confirmIntent(app,intent) {
  validateValue(intent);
  const {intent_sha256,...core}=intent;
  ensure(typeof intent_sha256==='string' && /^[a-f0-9]{64}$/u.test(intent_sha256),
    'Github draft intent digest must be SHA-256');
  ensure(digest('github-draft-intent-v1',core)===intent_sha256,
    'GitHub draft intent changed after preparation','Conflict');
  exactKeys(core,['schema_version','delivery_id','candidate_id','candidate_sha256','package_sha256',
    'bundle_sha256','bundle_bytes','repository','tag','tag_commit_sha','title','notes_artifact_id',
    'notes_sha256','profile_id','profile_version','acknowledge_draft_only','acknowledge_unverified']);
  ensure(core.schema_version===GITHUB_DRAFT_SCHEMA,'Unknown GitHub draft intent schema');
  const actual=prepareGithubDraft(app,{
    delivery_id:core.delivery_id,repository:core.repository,tag:core.tag,
    tag_commit_sha:core.tag_commit_sha,title:core.title,
    notes_artifact_id:core.notes_artifact_id,
    acknowledge_draft_only:core.acknowledge_draft_only,
    acknowledge_unverified:core.acknowledge_unverified
  });
  ensure(actual.intent_sha256===intent_sha256 &&
    actual.candidate_id===core.candidate_id &&
    actual.candidate_sha256===core.candidate_sha256 &&
    actual.bundle_sha256===core.bundle_sha256 &&
    actual.notes_sha256===core.notes_sha256,
    'Frozen GitHub draft intent no longer matches the Launchwright workspace','StaleReference');
  const ctx=getContext(app,core);
  return {...ctx,intent};
}
function expectedBody(intent,notes) {
  return notes.trimEnd()+
    '\n\n---\n\nDraft prepared by Launchwright for candidate '+
    intent.candidate_id+'; byte-pinned release asset SHA-256: '+intent.bundle_sha256+
    '. This draft does not establish public publication or Semwright Platform authority.\n\n'+
    REMOTE_MARKER+intent.intent_sha256+' -->\n';
}
function releaseIsOwnedDraft(release,intent,expectedBody) {
  // An intent marker alone is not sufficient: another GitHub actor may have
  // changed the title or body while leaving the marker intact.
  ensure(release && release.draft===true && release.tag_name===intent.tag &&
    release.name===intent.title &&
    typeof release.body==='string' &&
    release.body.replace(/\r\n/gu,'\n')===expectedBody,
    'Remote draft title/body differs from the exact approved Launchwright intent; no mutation is authorized','Conflict');
  ensure(Number.isSafeInteger(release.id) && release.id>0,
    'Remote draft does not have a stable GitHub release ID','Conflict');
  ensure(Array.isArray(release.assets),'GitHub release assets are unavailable','Conflict');
}
function getAsset(release,name) {
  const matches=release.assets.filter(asset=>asset.name===name);
  ensure(matches.length<=1,'Remote draft has duplicate asset names','Conflict');
  return matches[0]??null;
}
function checkedRemoteAsset(asset,intent) {
  ensure(Number.isSafeInteger(asset.size) && asset.size===intent.bundle_bytes,
    'Remote asset byte count differs from the frozen bundle','Conflict');
  if(asset.digest!==undefined && asset.digest!==null)ensure(asset.digest==='sha256:'+intent.bundle_sha256,
    'GitHub remote asset digest differs from the frozen bundle','Conflict');
}
export async function sendGithubDraft(app,intent,github,{
  confirm_repository,confirm_tag,confirm_candidate_sha256,recover_only=false
}={}) {
  const ctx=confirmIntent(app,intent);
  ensure(confirm_repository===intent.repository && confirm_tag===intent.tag &&
    confirm_candidate_sha256===intent.candidate_sha256,
    'Explicit operator confirmations must equal the pinned repo, tag and candidate SHA-256','ConsentRequired');
  ensure(github && typeof github.getTagCommit==='function' && typeof github.getRelease==='function' &&
    typeof github.createDraft==='function' && typeof github.uploadAsset==='function' &&
    typeof github.downloadAsset==='function','GitHub transport does not implement the draft protocol');
  const tagCommit=await github.getTagCommit(intent.repository,intent.tag);
  ensure(tagCommit===intent.tag_commit_sha,
    'Existing remote tag does not point to the exact reviewed commit','StaleReference');
  const body=expectedBody(intent,ctx.rendered.notes);
  const name='launchwright-'+intent.delivery_id+'.zip';
  let remoteMutationPerformed=false;
  let release=await github.getRelease(intent.repository,intent.tag);
  if(!release) {
    ensure(recover_only!==true,'GitHub draft does not exist; read-only recovery cannot create it','NotFound');
    await github.createDraft(intent.repository,intent.tag,intent.title,body);
    remoteMutationPerformed=true;
    release=await github.getRelease(intent.repository,intent.tag);
  }
  releaseIsOwnedDraft(release,intent,body);
  const releaseId=release.id;
  let asset=getAsset(release,name);
  if(!asset) {
    ensure(recover_only!==true,'GitHub draft has no matching asset; read-only recovery cannot upload it','NotFound');
    await github.uploadAsset(intent.repository,intent.tag,name,ctx.bundle.bytes);
    remoteMutationPerformed=true;
    release=await github.getRelease(intent.repository,intent.tag);
    releaseIsOwnedDraft(release,intent,body);
    asset=getAsset(release,name);
  }
  ensure(!!asset,'GitHub did not expose the uploaded draft asset','Unavailable');
  checkedRemoteAsset(asset,intent);
  const remoteBytes=await github.downloadAsset(intent.repository,intent.tag,name);
  ensure(Buffer.isBuffer(remoteBytes) && remoteBytes.length===ctx.bundle.bytes.length &&
    sha256(remoteBytes)===ctx.bundle.sha256,
    'Authenticated GitHub asset bytes differ from the immutable Launchwright bundle','Conflict');
  const after=await github.getRelease(intent.repository,intent.tag);
  releaseIsOwnedDraft(after,intent,body);
  ensure(after.id===releaseId,'Remote draft identity changed during asset upload','Conflict');
  ensure(await github.getTagCommit(intent.repository,intent.tag)===intent.tag_commit_sha,
    'Remote tag moved during draft preparation','StaleReference');
  const confirmedAsset=getAsset(after,name);
  ensure(!!confirmedAsset,'GitHub draft asset disappeared during receipt verification','Unavailable');
  checkedRemoteAsset(confirmedAsset,intent);
  const proof={
    schema_version:'launchwright-github-draft-receipt/1',
    intent_sha256:intent.intent_sha256,repository:intent.repository,tag:intent.tag,
    tag_commit_sha:intent.tag_commit_sha,release_id:after.id,
    candidate_sha256:intent.candidate_sha256,asset:name,
    bundle_sha256:intent.bundle_sha256,bundle_bytes:intent.bundle_bytes,
    state:'DRAFT_CREATED',publicly_published:false,platform_authority:false
  };
  const receipt_digest=digest('github-draft-receipt-v1',proof);
  // Revalidate candidate and input pins after network effects; an observed draft
  // may need manual recovery if the owner's workspace changed mid-upload.
  confirmIntent(app,intent);
  const prior=app.list('channel_delivery',ctx.delivery.data.release_id).filter(x=>
    x.data.root_delivery_id===ctx.delivery.id && x.data.external_state==='DRAFT_CREATED');
  if(prior.length) {
    ensure(prior.length===1 && prior[0].data.receipt_digest===receipt_digest &&
      prior[0].data.external_id==='github:'+intent.repository+':release/'+after.id,
      'Local delivery already has a different external draft receipt','Conflict');
    return {record:prior[0],proof,recovered:true,external_send_performed:false};
  }
  const record=(await execute(app,'channel.record_outcome',{
    delivery_id:ctx.delivery.id,state:'DRAFT_CREATED',
    external_id:'github:'+intent.repository+':release/'+after.id,
    receipt_digest,observed_at:iso(),
    message:'Operator-owned GitHub release DRAFT; verified exact ZIP SHA-256, no publication'
  })).entity;
  return {record,proof,recovered:false,external_send_performed:remoteMutationPerformed};
}

function gh(args,{allow404=false}={}) {
  ensure(!process.env.GH_HOST || process.env.GH_HOST==='github.com',
    'This bounded GitHub draft adapter is limited to github.com','PolicyDenied');
  const proc=spawnSync('gh',args,{
    encoding:'utf8',timeout:120000,maxBuffer:1024*1024,
    env:{...process.env,GH_PROMPT_DISABLED:'1',GIT_TERMINAL_PROMPT:'0'}
  });
  if(proc.error || proc.status!==0) {
    const missing=allow404 && /(?:HTTP 404|404 Not Found|404 \\(Not Found\\))/u.test(proc.stderr??'');
    if(missing)return null;
    throw new NativeError('Unavailable',
      'GitHub CLI request was not confirmed; use recover-only before attempting another send',
      false);
  }
  return proc.stdout;
}
function ghJson(run,args,options) {
  const result=run(args,options);
  if(result===null)return null;
  try{return JSON.parse(result);}catch {
    throw new NativeError('ProtocolMismatch','GitHub CLI did not return the expected JSON');
  }
}
function temporaryFile(name,bytes,fn) {
  const root=mkdtempSync(join(tmpdir(),'launchwright-github-draft-'));
  chmodSync(root,0o700);
  try {
    const file=join(root,name);
    if(bytes!==null)writeFileSync(file,bytes,{mode:0o600,flag:'wx'});
    return fn(file,root);
  } finally {rmSync(root,{recursive:true,force:true});}
}
export function githubCliTransport(run=gh) {
  const json=(args,options)=>ghJson(run,args,options);
  return {
    async getTagCommit(repo,tag) {
      let ref=json(['api','repos/'+repo+'/git/ref/tags/'+tag]);
      ensure(ref?.ref==='refs/tags/'+tag && ref.object,'Unexpected GitHub tag reference','Conflict');
      for(let i=0;i<4;i++) {
        if(ref.object.type==='commit')return commitSha(ref.object.sha);
        ensure(ref.object.type==='tag' && /^[a-f0-9]{40}$/u.test(ref.object.sha),
          'Unsupported GitHub tag target','Conflict');
        ref=json(['api','repos/'+repo+'/git/tags/'+ref.object.sha]);
      }
      throw new NativeError('Conflict','GitHub tag chain exceeds the reviewed depth');
    },
    async getRelease(repo,tag) {
      return json(['api','repos/'+repo+'/releases/tags/'+tag],{allow404:true});
    },
    async createDraft(repo,tag,title,body) {
      temporaryFile('NOTES.md',Buffer.from(body,'utf8'),file=>
        run(['release','create',tag,'--repo',repo,'--verify-tag','--draft','--title',title,'--notes-file',file]));
    },
    async uploadAsset(repo,tag,name,bytes) {
      temporaryFile(name,bytes,file=>
        run(['release','upload',tag,file,'--repo',repo]));
    },
    async downloadAsset(repo,tag,name) {
      return temporaryFile(name,null,(file,dir)=>{
        run(['release','download',tag,'--repo',repo,'--pattern',name,'--dir',dir]);
        return readFileSync(file);
      });
    }
  };
}
