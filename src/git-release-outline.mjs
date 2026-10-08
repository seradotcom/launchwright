// SPDX-License-Identifier: AGPL-3.0-only
// R33: source-linked, human-review-only release note outlines from R32 Git
// metadata. Never converts filenames, commits or imported evidence into claims.
import { requireCondition as ensure, sameVersion } from '@semwright/native-sdk';
import { digest } from './base.mjs';
import { verifyGitObservation } from './git-change-source.mjs';
import { execute } from './application.mjs';

export const OUTLINE_SCHEMA='launchwright-git-release-outline/1';

function validateInput(input){
  ensure(input&&typeof input==='object'&&!Array.isArray(input),'Outline input must be an object');
  const names=['source_id','release_id','target_id','evidence_id','name','include_paths',
    'acknowledge_path_disclosure','acknowledge_editorial_draft'];
  ensure(Object.keys(input).every(k=>names.includes(k))&&
    names.slice(0,5).every(k=>Object.hasOwn(input,k)),
    'Outline input has missing or unsupported properties','InvalidArgument');
  ensure(typeof input.name==='string'&&input.name.length>0&&
    Buffer.byteLength(input.name,'utf8')<=160&&!/[\r\n\0]/u.test(input.name),
    'Outline title must be a bounded single line','InvalidArgument');
  ensure(input.include_paths===undefined||typeof input.include_paths==='boolean',
    'include_paths must be boolean','InvalidArgument');
  ensure(input.acknowledge_path_disclosure===undefined||
    typeof input.acknowledge_path_disclosure==='boolean',
    'Path-disclosure acknowledgement must be boolean','InvalidArgument');
  ensure(input.acknowledge_editorial_draft===undefined||
    typeof input.acknowledge_editorial_draft==='boolean',
    'Editorial acknowledgement must be boolean','InvalidArgument');
  if(input.include_paths===true)ensure(input.acknowledge_path_disclosure===true,
    'Explicitly acknowledge sensitive filename disclosure','ConsentRequired');
}
function checkObservation(app,observation,input){
  verifyGitObservation(observation);
  validateInput(input);
  const release=app.get(input.release_id,'release');
  const target=app.get(input.target_id,'target');
  const source=app.get(input.source_id,'source');
  const evidence=app.get(input.evidence_id,'evidence');
  ensure(target.data.release_id===release.id&&source.data.product_id===release.data.product_id,
    'Outline source/target belongs to another product or release','PermissionDenied');
  ensure(source.data.type==='cli'&&source.data.approval==='approved'&&source.data.purpose&&
    source.data.locator==='git-local:'+observation.source_alias,
    'Outline source must be an approved matching operator-owned Git origin','PermissionDenied');
  ensure(release.data.build===observation.head_sha&&source.data.build===observation.head_sha,
    'Git observation no longer belongs to this release build','StaleReference');
  ensure(evidence.data.source_id===source.id&&evidence.data.target_id===target.id&&
    evidence.data.release_id===release.id&&
    evidence.data.build===release.data.build&&
    evidence.data.origin_digest===observation.observation_sha256,
    'Imported Git evidence belongs to a different source, target or snapshot','Conflict');
  ensure(evidence.data.admission==='imported-declaration'&&
    evidence.data.technical==='UNKNOWN'&&
    evidence.data.host_acceptance==='NOT_ESTABLISHED',
    'Git evidence is not a bounded imported UNKNOWN observation','PolicyDenied');
  ensure(sameVersion(source.version,evidence.data.source_version)&&
    sameVersion(target.version,evidence.data.target_version),
    'Git imported evidence is stale against its source/target revision','StaleReference');
  return{release,target,source,evidence};
}
function outlineContent(observation,includePaths){
  const counts={A:0,D:0,M:0,T:0};
  for(const entry of observation.changed_paths)counts[entry.status]++;
  const parts=[
    '## Change inventory — NOT a feature announcement','',
    'Imported Git source alias: '+observation.source_alias,
    'Exact base commit: '+observation.base_sha,
    'Exact target commit: '+observation.head_sha,
    'Imported observation SHA-256: '+observation.observation_sha256,
    '',
    'This is a committed-file inventory only. It does not prove a product feature,',
    'behavior, availability, build success, customer impact or deployment.',
    '',
    '### Change statistics (tracked files, not release features)','',
    '- Commits in reviewed range: '+observation.commit_count,
    '- Tracked files changed: '+observation.changed_files,
    '- Added paths: '+counts.A,
    '- Modified paths: '+counts.M,
    '- Deleted paths: '+counts.D,
    '- Type-changed paths: '+counts.T,
    '',
    '### Editorial review required','',
    '- [ ] Confirm which changes, if any, are user-facing.',
    '- [ ] Verify proposed claims against runtime/capture evidence.',
    '- [ ] Check plan/role/region/localization and rights constraints.',
    '- [ ] Independently review private paths, credentials and publication scope.',
    '- [ ] Replace this inventory with customer-ready release notes after human review.',
    '',
    'Technical state: UNKNOWN. Git metadata: imported declaration.',
    'Semwright Project Graph/Driver Host/Platform/publication authority: NOT ESTABLISHED.'
  ];
  if(includePaths){
    ensure(observation.changed_paths.length<=128,
      'Explicit filename appendix exceeds 128 paths; split the review window','ResourceExhausted');
    parts.push('','### Private filename appendix — operator-approved disclosure','',
      'These are source-control path names, not feature claims. Do not auto-publish.');
    for(const e of observation.changed_paths){
      // A four-space indented line is Markdown code, so filenames containing
      // backticks, brackets or HTML syntax cannot escape into rich markup.
      parts.push('    '+e.status+'  '+JSON.stringify(e.path));
    }
  }else parts.push('','Filename appendix: REDACTED by default. No file paths embedded.');
  const text=parts.join('\n')+'\n';
  ensure(Buffer.byteLength(text,'utf8')<=22000,
    'Outline exceeds editorial size budget; split the review window','ResourceExhausted');
  return{text,counts};
}
export function previewGitReleaseOutline(app,observation,input){
  const context=checkObservation(app,observation,input);
  const includePaths=input.include_paths===true;
  const built=outlineContent(observation,includePaths);
  const core={
    schema_version:OUTLINE_SCHEMA,
    release_id:context.release.id,target_id:context.target.id,
    source_id:context.source.id,evidence_id:context.evidence.id,
    observation_sha256:observation.observation_sha256,
    name:input.name,include_paths:includePaths,
    content:built.text,counts:built.counts,
    editor_state:'DRAFT_REVIEW_REQUIRED',
    technical_state:'UNKNOWN',
    imported_only:true,claims_verified:false,
    file_names_disclosed:includePaths,
    external_send_performed:false,
    project_graph_authority:false,platform_authority:false
  };
  return {...core,outline_sha256:digest('git-release-outline-v1',core)};
}
export async function createGitReleaseOutline(app,observation,input){
  ensure(input?.acknowledge_editorial_draft===true,
    'Explicitly acknowledge these are unverified editorial notes, not product claims',
    'ConsentRequired');
  const preview=previewGitReleaseOutline(app,observation,input);
  const previous=app.list('deliverable',input.release_id).filter(row=>
    row.data.target_id===input.target_id&&row.data.name===input.name);
  if(previous.length){
    ensure(previous.length===1&&previous[0].data.format==='markdown'&&
      previous[0].data.content===preview.content&&
      previous[0].data.source_ids.length===1&&
      previous[0].data.source_ids[0]===input.source_id,
      'An editorial draft with this name already exists or was edited; choose a new name',
      'Conflict');
    return{entity:previous[0],reused:true,outline_sha256:preview.outline_sha256};
  }
  const result=await execute(app,'entity.create',{kind:'deliverable',data:{
    release_id:input.release_id,target_id:input.target_id,
    name:input.name,format:'markdown',content:preview.content,
    claim_ids:[],source_ids:[input.source_id]
  }});
  return{entity:result.entity,reused:false,outline_sha256:preview.outline_sha256};
}
