// SPDX-License-Identifier: AGPL-3.0-only
// R35: Explicit operator-owned onboarding of an existing Git project.
// This is a recoverable LOCAL workflow over the canonical Native SDK dispatcher,
// NOT Semwright Platform project adoption, runtime capture or Project Graph admission.
import { requireCondition as ensure, validateValue, NativeError } from '@semwright/native-sdk';
import { openSync, closeSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { digest } from './base.mjs';
import { validateEntity } from './contracts.mjs';
import { verifyGitObservation, importGitObservation } from './git-change-source.mjs';
import { createGitReleaseOutline, previewGitReleaseOutline } from './git-release-outline.mjs';
import { execute } from './application.mjs';

// Shared between the operator CLI and the owner-authenticated local web UI.
// An unknown lock is NEVER auto-reaped; only the creator removes its own lock.
export async function withGitBootstrapLock(workspaceRoot,callback){
  ensure(typeof callback==='function','Bootstrap lock requires an explicit callback');
  const file=join(workspaceRoot,'.git-bootstrap-apply.lock');
  let fd;
  try {fd=openSync(file,'wx',0o600);}
  catch(err) {
    if(err?.code==='EEXIST')throw new NativeError('Conflict',
      'Another Git bootstrap is in progress, or an abandoned lock needs manual review');
    throw new NativeError('Unavailable','Could not acquire private Git bootstrap lock');
  }
  try{return await callback();}
  finally{
    try{closeSync(fd);}finally{unlinkSync(file);}
  }
}

export const GIT_BOOTSTRAP_SCHEMA='launchwright-git-project-bootstrap/1';
const TYPE_KEYS=[
  'product_name','release_name','source_name','target_name','notes_title',
  'source_purpose','locale','role','plan','region','rights'
];
const marker=sha=>'Launchwright local Git bootstrap: '+sha+
  ' (imported committed metadata only; technical state UNKNOWN)';
function validateOptions(raw){
  validateValue(raw);
  ensure(raw&&typeof raw==='object'&&!Array.isArray(raw) &&
    Object.keys(raw).length===TYPE_KEYS.length &&
    TYPE_KEYS.every(k=>Object.hasOwn(raw,k)),
    'Git project bootstrap requires explicit product/release/source/target context');
  for(const key of TYPE_KEYS){
    const value=raw[key];
    ensure(typeof value==='string'&&value.length>0&&
      Buffer.byteLength(value,'utf8')<=(key==='source_purpose'?1400:key==='locale'?40:150) &&
      !/[\0-\x1f\x7f]/u.test(value),
      'Bootstrap '+key+' must be bounded, nonempty single-line text','InvalidArgument');
  }
  ensure(['owned','licensed'].includes(raw.rights),
    'Rights must be explicitly declared owned or licensed','InvalidArgument');
  // Validate every operator string *before* any workspace mutation.
  validateEntity('product',{name:raw.product_name});
  validateEntity('release',{name:raw.release_name,product_id:'product_fixture',build:'a'.repeat(40)});
  validateEntity('source',{
    product_id:'product_fixture',name:raw.source_name,type:'cli',locator:'git-local:fixture',
    build:'a'.repeat(40),coverage:'declared',purpose:raw.source_purpose,approval:'approved'
  });
  validateEntity('target',{release_id:'release_fixture',name:raw.target_name,
    ui_locale:raw.locale,editorial_locale:raw.locale,role:raw.role,plan:raw.plan,
    region:raw.region,flags:{},viewport:{width:1440,height:900,scale_milli:1000}});
  validateEntity('deliverable',{release_id:'release_fixture',name:raw.notes_title,
    target_id:'target_fixture',format:'markdown',content:'DRAFT',claim_ids:[],source_ids:[]});
  return structuredClone(raw);
}
export function planGitProjectBootstrap(observation,options){
  verifyGitObservation(observation);
  const config=validateOptions(options);
  const core={
    schema_version:GIT_BOOTSTRAP_SCHEMA,
    observation_sha256:observation.observation_sha256,
    source_alias:observation.source_alias,
    base_sha:observation.base_sha,
    head_sha:observation.head_sha,
    head_tree_sha:observation.head_tree_sha,
    changed_files:observation.changed_files,
    commit_count:observation.commit_count,
    config,
    declared_authority:'operator-local-imported-only',
    needs_source_approval:true,
    needs_rights_declaration:true,
    needs_editorial_draft_approval:true,
    technical_state:'UNKNOWN',
    project_graph_authority:false,
    platform_execution_authority:false,
    publication_authority:false,
    git_network_access_performed:false
  };
  return {...core,plan_sha256:digest('git-project-bootstrap',core)};
}
export function verifyGitProjectBootstrap(plan,observation){
  verifyGitObservation(observation);
  validateValue(plan);
  ensure(plan&&typeof plan==='object'&&!Array.isArray(plan),
    'Git bootstrap plan must be a JSON object','InvalidArgument');
  const {plan_sha256,...core}=plan;
  ensure(typeof plan_sha256==='string'&&/^[a-f0-9]{64}$/u.test(plan_sha256),
    'Git bootstrap plan must contain an exact SHA-256','InvalidArgument');
  ensure(digest('git-project-bootstrap',core)===plan_sha256,
    'Saved Git project bootstrap plan was modified','Conflict');
  const regenerated=planGitProjectBootstrap(observation,core.config);
  ensure(JSON.stringify(regenerated)===JSON.stringify(plan),
    'Git project bootstrap plan differs from the exact source observation or contract',
    'StaleReference');
  return plan;
}
function projectData(plan){
  return{
    name:plan.config.product_name,
    description:marker(plan.plan_sha256)
  };
}
function releaseData(plan,product){
  return{
    product_id:product.id,name:plan.config.release_name,build:plan.head_sha,
    status:'draft',notes:marker(plan.plan_sha256)
  };
}
function sourceData(plan,product){
  return{
    product_id:product.id,name:plan.config.source_name,type:'cli',
    locator:'git-local:'+plan.source_alias,build:plan.head_sha,
    coverage:'declared',purpose:plan.config.source_purpose+' | '+marker(plan.plan_sha256),
    approval:'approved'
  };
}
function targetData(plan,release){
  return{
    release_id:release.id,name:plan.config.target_name,ui_locale:plan.config.locale,
    editorial_locale:plan.config.locale,role:plan.config.role,plan:plan.config.plan,
    region:plan.config.region,flags:{},
    viewport:{width:1440,height:900,scale_milli:1000}
  };
}
function exactJson(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function unique(app,kind,predicate){
  const matched=app.list(kind).filter(predicate);
  ensure(matched.length<=1,
    'Ambiguous existing '+kind+' bootstrap identity; do not create duplicates','Conflict');
  return matched[0]??null;
}
async function reconcile(app,kind,data,predicate){
  const prior=unique(app,kind,predicate);
  if(prior){
    ensure(exactJson(prior.data,data),
      'Previously created '+kind+' was edited or conflicts with this bootstrap plan',
      'Conflict');
    return{entity:prior,created:false};
  }
  return {entity:(await execute(app,'entity.create',{kind,data})).entity,created:true};
}
function checkConflictsBeforeWrite(app,plan){
  const product=unique(app,'product',row=>row.data.name===plan.config.product_name);
  if(product)ensure(exactJson(product.data,projectData(plan)),
    'Existing product name belongs to a different bootstrap; no mutation','Conflict');
  const releases=app.list('release').filter(row=>row.data.name===plan.config.release_name &&
    (!product||row.data.product_id===product.id));
  // Before a product exists, an identically named release under a different
  // product is not a conflict; scope its identity to the new product.
  if(product){
    ensure(releases.length<=1,'Ambiguous existing release','Conflict');
    if(releases.length)ensure(exactJson(releases[0].data,releaseData(plan,product)),
      'Existing release differs from saved Git bootstrap plan','Conflict');
  }
}
function evidenceFor(app,plan,release,source,target){
  const matched=app.list('evidence',release.id).filter(e=>
    e.data.origin_digest===plan.observation_sha256 ||
    (e.data.source_id===source.id&&e.data.target_id===target.id&&
      e.data.name==='Imported committed Git changes'));
  ensure(matched.length<=1,'Ambiguous imported Git evidence','Conflict');
  if(!matched.length)return null;
  const record=matched[0];
  ensure(record.data.origin_digest===plan.observation_sha256 &&
    record.data.source_id===source.id&&record.data.target_id===target.id &&
    record.data.release_id===release.id&&record.data.build===plan.head_sha &&
    record.data.rights===plan.config.rights&&
    record.data.admission==='imported-declaration'&&
    record.data.technical==='UNKNOWN'&&
    record.data.host_acceptance==='NOT_ESTABLISHED',
    'An existing Git evidence receipt differs from the exact saved plan','Conflict');
  return record;
}
export async function applyGitProjectBootstrap(app,plan,observation,{
  confirm_plan_sha256,confirm_head_sha,
  acknowledge_source_approval=false,acknowledge_rights=false,
  acknowledge_imported=false,acknowledge_editorial_draft=false
}={}){
  verifyGitProjectBootstrap(plan,observation);
  ensure(confirm_plan_sha256===plan.plan_sha256&&confirm_head_sha===plan.head_sha,
    'Operator must confirm exact saved plan SHA-256 and target Git commit','ConsentRequired');
  ensure(acknowledge_source_approval===true&&acknowledge_rights===true &&
    acknowledge_imported===true&&acknowledge_editorial_draft===true,
    'Explicit source/rights/import/editorial acknowledgements are all required',
    'ConsentRequired');
  app.allow('edit');
  checkConflictsBeforeWrite(app,plan);
  const created={product:false,release:false,source:false,target:false,evidence:false,deliverable:false};
  const productStep=await reconcile(app,'product',projectData(plan),
    r=>r.data.name===plan.config.product_name);
  const product=productStep.entity;created.product=productStep.created;
  const releaseStep=await reconcile(app,'release',releaseData(plan,product),
    r=>r.data.product_id===product.id&&r.data.name===plan.config.release_name);
  const release=releaseStep.entity;created.release=releaseStep.created;
  const sourceStep=await reconcile(app,'source',sourceData(plan,product),r=>
    r.data.product_id===product.id &&
    (r.data.name===plan.config.source_name||r.data.locator==='git-local:'+plan.source_alias));
  const source=sourceStep.entity;created.source=sourceStep.created;
  const targetStep=await reconcile(app,'target',targetData(plan,release),
    r=>r.data.release_id===release.id&&r.data.name===plan.config.target_name);
  const target=targetStep.entity;created.target=targetStep.created;
  let evidence=evidenceFor(app,plan,release,source,target);
  if(!evidence){
    evidence=await importGitObservation(app,observation,{
      source_id:source.id,target_id:target.id,release_id:release.id,
      name:'Imported committed Git changes',rights:plan.config.rights,
      acknowledge_imported:true
    });
    created.evidence=true;
  }
  const outline=await createGitReleaseOutline(app,observation,{
    source_id:source.id,target_id:target.id,release_id:release.id,
    evidence_id:evidence.id,name:plan.config.notes_title,
    include_paths:false,acknowledge_editorial_draft:true
  });
  created.deliverable=!outline.reused;
  return{
    schema_version:'launchwright-git-bootstrap-result/1',
    plan_sha256:plan.plan_sha256,observation_sha256:plan.observation_sha256,
    product_id:product.id,release_id:release.id,source_id:source.id,
    target_id:target.id,evidence_id:evidence.id,deliverable_id:outline.entity.id,
    created,reused:Object.fromEntries(Object.entries(created).map(([k,v])=>[k,!v])),
    imported_evidence_state:'UNKNOWN',editorial_state:'DRAFT_REVIEW_REQUIRED',
    source_approval_basis:'operator-declaration',
    rights_basis:'operator-declaration',external_mutation_performed:false,
    project_graph_authority:false,platform_authority:false,publication_authority:false
  };
}
