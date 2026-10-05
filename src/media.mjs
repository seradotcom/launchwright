// SPDX-License-Identifier: AGPL-3.0-only
import { object, integer, requireCondition as ensure, sameVersion, validateValue } from '@semwright/native-sdk';
import { inputObject, idText, str, array, choice, sha, noSecrets, RIGHTS, locale } from './contracts.mjs';
import { digest, iso } from './base.mjs';

const COMPOSITION_CONTRACT='semwright-composition/C0';
const MEDIA_TIME_AUTHORITY='semwright-media-time';
const OUTPUT_KINDS=Object.freeze(['video','screenshot-series','interactive-demo']);
const ASSET_KINDS=Object.freeze(['narration','music','captions','transcript']);
const MOTION_COMMANDS=Object.freeze({
  plan:'driver.motion-canvas.composition.plan',
  apply:'driver.motion-canvas.composition.apply',
  verify:'driver.motion-canvas.composition.verify'
});

function gcd(a,b){
  a=a<0n?-a:a;b=b<0n?-b:b;
  while(b){const r=a%b;a=b;b=r;}
  return a;
}
function canonicalIntegerText(value,label){
  str(value,20);
  ensure(/^-?(?:0|[1-9][0-9]{0,18})$/.test(value)&&value!=='-0',label+' must be a canonical decimal integer string');
  return BigInt(value);
}
function rational(value,label,{positive=false,nonnegative=false}={}){
  object(value,['num','den'],['num','den']);
  const n=canonicalIntegerText(value.num,label+' numerator');
  const d=canonicalIntegerText(value.den,label+' denominator');
  ensure(d>0n,label+' denominator must be positive');
  ensure(gcd(n,d)===1n,label+' must be reduced');
  if(positive)ensure(n>0n,label+' must be positive');
  if(nonnegative)ensure(n>=0n,label+' must be nonnegative');
  return value;
}
function compareRational(a,b){
  const an=BigInt(a.num),ad=BigInt(a.den),bn=BigInt(b.num),bd=BigInt(b.den);
  const left=an*bd,right=bn*ad;
  return left<right?-1:left>right?1:0;
}
function interval(value,label,duration){
  object(value,['start','end'],['start','end']);
  rational(value.start,label+' start',{nonnegative:true});
  rational(value.end,label+' end',{positive:true});
  ensure(compareRational(value.start,value.end)<0,label+' must be nonempty and ordered');
  ensure(compareRational(value.end,duration)<=0,label+' exceeds composition duration');
  return value;
}
function rate(value){
  object(value,['num','den'],['num','den']);
  const n=integer(value.num,1,1_000_000),d=integer(value.den,1,100_000);
  ensure(gcd(BigInt(n),BigInt(d))===1n,'Frame rate must be reduced');
  return value;
}
function safeLink(raw){
  str(raw,2048);
  let u;try{u=new URL(raw);}catch{ensure(false,'Interactive link is not a valid URL');}
  ensure(u.protocol==='https:','Interactive links must use HTTPS');
  ensure(!u.username&&!u.password,'Interactive links cannot contain credentials');
  return raw;
}
function uniq(values,label){
  ensure(new Set(values).size===values.length,'Duplicate '+label);
}
function pin(e){return{id:e.id,kind:e.kind,version:e.version};}

export function validateMediaPlan(raw){
  validateValue(raw);noSecrets(raw);const d=structuredClone(raw);
  object(d,
    ['release_id','target_id','scenario_id','name','backend','frame_rate','duration','shots','assets','tracks','variants','interactive_policy'],
    ['release_id','target_id','scenario_id','name','backend','frame_rate','duration','shots','assets','tracks','variants','interactive_policy']);
  for(const k of ['release_id','target_id','scenario_id'])idText(d[k]);
  str(d.name,160);
  rate(d.frame_rate);
  rational(d.duration,'Composition duration',{positive:true});

  object(d.backend,['profile','fidelity','losses','unsupported'],['profile','fidelity','losses','unsupported']);
  choice(d.backend.profile,['motion-canvas','declared-alternate']);
  choice(d.backend.fidelity,['exact','variant-required','unsupported']);
  array(d.backend.losses,32).forEach(v=>str(v,512));
  array(d.backend.unsupported,32).forEach(v=>str(v,512));
  if(d.backend.profile==='declared-alternate'){
    ensure(d.backend.fidelity!=='exact','An alternate backend cannot silently claim exact fidelity');
    ensure(d.backend.losses.length+d.backend.unsupported.length>0,'Alternate backend must declare losses or unsupported capabilities');
  }
  if(d.backend.fidelity==='exact')ensure(d.backend.losses.length===0&&d.backend.unsupported.length===0,'Exact fidelity cannot declare losses');

  const shotIds=[];
  array(d.shots,64).forEach(s=>{
    object(s,['id','name','capture_evidence_id','interactive_evidence_id','claim_ids','interval','purpose','transform_refs'],
      ['id','name','capture_evidence_id','interactive_evidence_id','claim_ids','interval','purpose','transform_refs']);
    idText(s.id);shotIds.push(s.id);str(s.name,160);idText(s.capture_evidence_id);idText(s.interactive_evidence_id);
    array(s.claim_ids,32).forEach(idText);uniq(s.claim_ids,'shot claim reference');
    interval(s.interval,'Shot '+s.id,d.duration);
    choice(s.purpose,['demonstrated','illustrative']);
    array(s.transform_refs,32).forEach(v=>str(v,256));
  });uniq(shotIds,'shot ID');

  const assetIds=[];
  array(d.assets,64).forEach(a=>{
    object(a,['id','kind','version','rights','source_resource_id','source_sha256','claim_ids','locale','origin'],
      ['id','kind','version','rights','claim_ids','origin']);
    idText(a.id);assetIds.push(a.id);choice(a.kind,ASSET_KINDS);str(a.version,128);choice(a.rights,RIGHTS);
    ensure((a.source_resource_id===undefined)!==(a.source_sha256===undefined),'Media asset requires exactly one source resource or source digest');
    if(a.source_resource_id!==undefined)idText(a.source_resource_id);
    if(a.source_sha256!==undefined)sha(a.source_sha256);
    array(a.claim_ids,32).forEach(idText);uniq(a.claim_ids,'media asset claim reference');
    if(a.locale!==undefined)locale(a.locale);
    choice(a.origin,['owned','licensed','authorized-tts','generated-sample','imported']);
    if(a.origin==='imported')ensure(a.rights!=='owned','Imported media cannot be relabeled as owned');
  });uniq(assetIds,'media asset ID');

  const trackIds=[];
  array(d.tracks,128).forEach(t=>{
    object(t,['id','asset_id','interval'],['id','asset_id','interval']);
    idText(t.id);trackIds.push(t.id);idText(t.asset_id);ensure(assetIds.includes(t.asset_id),'Track references an unknown media asset');
    interval(t.interval,'Track '+t.id,d.duration);
  });uniq(trackIds,'track ID');

  const variantIds=[],variantKinds=[];
  array(d.variants,32).forEach(v=>{
    object(v,['id','kind','locale','width','height','safe_area_milli','shot_ids','track_ids'],['id','kind','locale','width','height','safe_area_milli','shot_ids','track_ids']);
    idText(v.id);variantIds.push(v.id);choice(v.kind,OUTPUT_KINDS);variantKinds.push(v.kind);locale(v.locale);
    integer(v.width,240,7680);integer(v.height,240,7680);
    object(v.safe_area_milli,['top','right','bottom','left'],['top','right','bottom','left']);
    for(const k of ['top','right','bottom','left'])integer(v.safe_area_milli[k],0,400);
    array(v.shot_ids,64).forEach(idText);uniq(v.shot_ids,'variant shot reference');ensure(v.shot_ids.length>0,'Media variant must reference at least one shot');
    array(v.track_ids,128).forEach(idText);uniq(v.track_ids,'variant track reference');
    ensure(v.shot_ids.every(id=>shotIds.includes(id)),'Media variant references an unknown shot');
    ensure(v.track_ids.every(id=>trackIds.includes(id)),'Media variant references an unknown track');
  });uniq(variantIds,'media variant ID');
  for(const kind of OUTPUT_KINDS)ensure(variantKinds.includes(kind),'Media plan requires a '+kind+' variant');

  object(d.interactive_policy,['sanitized_only','productive_auth','active_source_scripts','external_links'],['sanitized_only','productive_auth','active_source_scripts','external_links']);
  ensure(d.interactive_policy.sanitized_only===true,'Interactive demo must use sanitized sources only');
  ensure(d.interactive_policy.productive_auth===false,'Interactive demo cannot carry productive authentication');
  ensure(d.interactive_policy.active_source_scripts===false,'Interactive demo cannot execute source application scripts');
  array(d.interactive_policy.external_links,32).forEach(safeLink);
  return d;
}

function resolvePins(app,data){
  const release=app.get(data.release_id,'release'),target=app.get(data.target_id,'target'),scenario=app.get(data.scenario_id,'scenario');
  ensure(target.data.release_id===release.id&&scenario.data.release_id===release.id&&scenario.data.target_id===target.id,'Media target/scenario scope mismatch','PermissionDenied');
  const basePins=[pin(release),pin(target),pin(scenario)],pins=[...basePins],shotPins=new Map(),assetPins=new Map();
  for(const shot of data.shots){
    const capture=app.get(shot.capture_evidence_id,'evidence'),safe=app.get(shot.interactive_evidence_id,'evidence'),local=[pin(capture),pin(safe)];
    ensure(capture.data.release_id===release.id&&capture.data.target_id===target.id&&capture.data.scenario_id===scenario.id,'Shot capture belongs to another media context','PermissionDenied');
    ensure(capture.data.evidence_type==='capture','Shot footage source is not capture evidence','InvalidArgument');
    if(shot.purpose==='demonstrated')ensure(capture.data.observed_state_eligible===true,'Demonstrated shot requires observed-state-eligible capture evidence','Conflict');
    ensure(safe.data.release_id===release.id&&safe.data.target_id===target.id&&safe.data.scenario_id===scenario.id,'Interactive derivative belongs to another media context','PermissionDenied');
    ensure(safe.data.evidence_type==='capture'&&safe.data.classification==='sanitized'&&safe.data.provenance?.capture_class==='SANITIZED_DERIVATIVE','Interactive source must be a sanitized capture derivative','Conflict');
    ensure(safe.data.parent_evidence_id===capture.id,'Interactive derivative must preserve the exact shot source relation','Conflict');
    for(const claimId of shot.claim_ids){
      const claim=app.get(claimId,'claim');ensure(claim.data.release_id===release.id&&claim.data.target_id===target.id,'Shot claim belongs to another context','PermissionDenied');local.push(pin(claim));
    }
    shotPins.set(shot.id,local);pins.push(...local);
  }
  for(const asset of data.assets){
    const local=[];
    for(const claimId of asset.claim_ids){
      const claim=app.get(claimId,'claim');ensure(claim.data.release_id===release.id&&claim.data.target_id===target.id,'Media asset claim belongs to another context','PermissionDenied');local.push(pin(claim));
    }
    if(asset.source_resource_id){
      const source=app.get(asset.source_resource_id);ensure(app.productOf(source)===release.data.product_id,'Media asset source belongs to another product','PermissionDenied');
      if(source.data.release_id)ensure(source.data.release_id===release.id,'Media asset source belongs to another release','PermissionDenied');
      local.push(pin(source));
    }
    assetPins.set(asset.id,local);pins.push(...local);
  }
  const trackById=new Map(data.tracks.map(t=>[t.id,t]));
  const assetById=new Map(data.assets.map(a=>[a.id,a]));
  const variantPins=data.variants.map(v=>{
    const local=[...basePins];
    for(const id of v.shot_ids)local.push(...shotPins.get(id));
    for(const id of v.track_ids){
      const track=trackById.get(id),asset=assetById.get(track.asset_id);local.push(...assetPins.get(asset.id));
    }
    const unique=[...new Map(local.map(p=>[p.id,p])).values()].sort((a,b)=>a.id.localeCompare(b.id));
    const shotData=data.shots.filter(s=>v.shot_ids.includes(s.id)),trackData=data.tracks.filter(t=>v.track_ids.includes(t.id));
    const assetData=data.assets.filter(a=>trackData.some(t=>t.asset_id===a.id));
    const variantDigest=digest('media-variant-v1',{variant:v,frame_rate:data.frame_rate,duration:data.duration,backend:data.backend,shots:shotData,tracks:trackData,assets:assetData,pins:unique});
    return{id:v.id,digest:variantDigest,pins:unique};
  });
  return{release,target,scenario,pins:[...new Map(pins.map(p=>[p.id,p])).values()].sort((a,b)=>a.id.localeCompare(b.id)),variantPins};
}

function handoff(data){
  return{
    composition_contract:COMPOSITION_CONTRACT,
    media_time_authority:MEDIA_TIME_AUTHORITY,
    effects_authority:'semwright-composition',
    backend_profile:data.backend.profile,
    operations:data.backend.profile==='motion-canvas'?MOTION_COMMANDS:null,
    execution_authority:false,
    note:'Launchwright preserves planning inputs and pins; the canonical Composition runtime owns clocks, effects, plan/apply/verify and rendering.'
  };
}

function materializePlan(app,data,{parent=null,reason=''}={}){
  const scope=resolvePins(app,data);
  const h=handoff(data);
  const priorVariants=new Map((parent?.data.variant_contracts??[]).map(v=>[v.id,v.digest]));
  const variantContracts=scope.variantPins.map(v=>({...v,reusable_from_parent:priorVariants.get(v.id)===v.digest}));
  const reusableVariantIds=variantContracts.filter(v=>v.reusable_from_parent).map(v=>v.id);
  const planDigest=digest('media-plan-v1',{data,pins:scope.pins,variant_contracts:variantContracts.map(({reusable_from_parent,...v})=>v),handoff:h,parent_plan_id:parent?.id??null});
  return app.store.create('media_plan',{
    ...data,source_pins:scope.pins,variant_contracts:variantContracts,reusable_variant_ids:reusableVariantIds,plan_digest:planDigest,
    schema_version:'launchwright-media-plan/1',
    composition_contract:COMPOSITION_CONTRACT,media_time_authority:MEDIA_TIME_AUTHORITY,
    composition_handoff:h,parent_plan_id:parent?.id??null,root_plan_id:parent?.data.root_plan_id??parent?.id??null,
    revision_reason:reason,state:'PLANNED',execution_authority:false,
    created_by:app.principal,created_at:iso()
  });
}

export function createMediaPlan(app,input){
  const data=validateMediaPlan(input);
  return{entity:materializePlan(app,data),execution_authority:false};
}

export function reviseMediaPlan(app,input){
  inputObject(input,['id','expected','plan','reason'],['id','expected','plan','reason']);
  const prior=app.get(input.id,'media_plan');ensure(sameVersion(prior.version,input.expected),'Media plan revision changed','StaleReference');str(input.reason,2000);
  const data=validateMediaPlan(input.plan);
  for(const k of ['release_id','target_id','scenario_id'])ensure(data[k]===prior.data[k],'Media plan scope is immutable; create another root plan','Conflict');
  const next=materializePlan(app,data,{parent:prior,reason:input.reason});
  return{entity:next,previous_plan_id:prior.id,previous_plan_digest:prior.data.plan_digest};
}

function effectiveOutput(app,data){
  if(data.state==='FAILED'||['FAIL','ERROR'].includes(data.reported_verification))return'FAIL';
  if(data.reported_verification!=='PASS'||data.state!=='SUCCEEDED')return'UNKNOWN';
  return data.authority==='semwright-composition'&&data.admission==='canonical-owner-admitted'?'PASS':'UNKNOWN';
}

export function recordMediaOutput(app,input){
  inputObject(input,['plan_id','variant_id','state','authority','provider','provider_version','job_id','receipt_sha256','artifact_sha256','mime','duration','observed_at','reported_verification'],
    ['plan_id','variant_id','state','authority','provider','provider_version','artifact_sha256','mime','observed_at','reported_verification']);
  const plan=app.get(input.plan_id,'media_plan'),variant=plan.data.variants.find(v=>v.id===input.variant_id);
  ensure(variant,'Media output variant is not declared by the plan','NotFound');
  choice(input.state,['SUCCEEDED','FAILED','UNKNOWN']);choice(input.authority,['semwright-composition','imported']);str(input.provider,160);str(input.provider_version,128);
  if(input.job_id!==undefined)str(input.job_id,160);if(input.receipt_sha256!==undefined)sha(input.receipt_sha256);sha(input.artifact_sha256);str(input.mime,160);
  str(input.observed_at,64);ensure(Number.isFinite(Date.parse(input.observed_at)),'Media output observed_at must be an ISO timestamp');
  choice(input.reported_verification,['PASS','FAIL','ERROR','UNKNOWN']);
  if(input.duration!==undefined)rational(input.duration,'Media output duration',{positive:true});
  if(variant.kind==='video'){
    ensure(input.duration!==undefined,'Video output requires exact rational duration');
    ensure(compareRational(input.duration,plan.data.duration)===0,'Video output duration differs from its media plan','Conflict');
    ensure(input.mime.startsWith('video/'),'Video output requires a video MIME type');
  }
  if(input.authority==='semwright-composition'){
    ensure(!!input.job_id&&!!input.receipt_sha256,'Semwright Composition output requires job and receipt correlation','InvalidArgument');
  }
  const admitted=input.authority==='semwright-composition'&&app.capabilities?.canonical_composition_receipts===true;
  const admission=admitted?'canonical-owner-admitted':input.authority==='semwright-composition'?'composition-receipt-recorded-not-admitted':'imported-declaration';
  const technical_effective=effectiveOutput(app,{...input,admission});
  return{entity:app.store.create('media_output',{
    release_id:plan.data.release_id,name:variant.kind+' · '+variant.id,plan_id:plan.id,plan_digest:plan.data.plan_digest,
    variant_id:variant.id,variant_kind:variant.kind,...input,admission,technical_reported:input.reported_verification,
    technical_effective,editorial_state:'PENDING',recorded_by:app.principal,recorded_at:iso()
  })};
}

export function recordMediaReview(app,input){
  inputObject(input,['output_id','artifact_sha256','decision','comment'],['output_id','artifact_sha256','decision','comment']);
  const output=app.get(input.output_id,'media_output');sha(input.artifact_sha256);ensure(output.data.artifact_sha256===input.artifact_sha256,'Editorial review is bound to different media bytes','Conflict');
  choice(input.decision,['approve-editorial','changes-requested']);str(input.comment,4000);
  return{entity:app.store.create('media_review',{
    release_id:output.data.release_id,name:'Media review · '+output.data.variant_id,output_id:output.id,plan_id:output.data.plan_id,
    artifact_sha256:input.artifact_sha256,decision:input.decision,comment:input.comment,
    reviewer:app.principal,technical_state_at_review:output.data.technical_effective,created_at:iso()
  })};
}

export function inspectMediaPlan(app,input){
  inputObject(input,['id'],[]);
  if(input.id===undefined)return{schema_version:'launchwright-media-profile/1',composition_contract:COMPOSITION_CONTRACT,media_time_authority:MEDIA_TIME_AUTHORITY,backend_profiles:['motion-canvas','declared-alternate'],output_kinds:OUTPUT_KINDS,execution_authority:false};
  const plan=app.get(input.id,'media_plan');
  const changed=app.freshness(plan.data.source_pins);
  const outputs=app.list('media_output',plan.data.release_id).filter(o=>o.data.plan_id===plan.id);
  const reviews=app.list('media_review',plan.data.release_id).filter(r=>r.data.plan_id===plan.id);
  const latestByVariant=new Map(),latestReviewByOutput=new Map();
  for(const output of outputs.sort((a,b)=>a.created.localeCompare(b.created)))latestByVariant.set(output.data.variant_id,output);
  for(const review of reviews.sort((a,b)=>a.created.localeCompare(b.created)))latestReviewByOutput.set(review.data.output_id,review);
  const contractByVariant=new Map(plan.data.variant_contracts.map(v=>[v.id,v]));
  const variants=plan.data.variants.map(v=>{
    const output=latestByVariant.get(v.id)??null,review=output?latestReviewByOutput.get(output.id)??null:null,contract=contractByVariant.get(v.id);
    const variantChanged=app.freshness(contract.pins),current=variantChanged.length===0;
    return{id:v.id,kind:v.kind,output_id:output?.id??null,technical:current?(output?.data.technical_effective??'UNKNOWN'):'UNKNOWN',
      reported:output?.data.technical_reported??'UNKNOWN',editorial:review?.data.decision??'PENDING',
      source_freshness:current?'CURRENT':'STALE',changed_sources:variantChanged,reusable_from_parent:contract.reusable_from_parent===true,
      artifact_sha256:output?.data.artifact_sha256??null,admission:output?.data.admission??null};
  });
  const technical=variants.some(v=>v.technical==='FAIL')?'FAIL':variants.length&&variants.every(v=>v.technical==='PASS')?'PASS':'UNKNOWN';
  const editorial=variants.some(v=>v.editorial==='changes-requested')?'CHANGES_REQUESTED':variants.length&&variants.every(v=>v.editorial==='approve-editorial')?'APPROVED_EDITORIAL':'PENDING';
  const realKinds=new Set(variants.filter(v=>v.technical==='PASS').map(v=>v.kind));
  return{
    plan,source_freshness:changed.length?'STALE':'CURRENT',changed_sources:changed,
    ready_for_composition:changed.length===0&&plan.data.backend.fidelity!=='unsupported',
    technical_state:technical,editorial_state:editorial,variants,
    complete_real_output_set:OUTPUT_KINDS.every(kind=>realKinds.has(kind)),
    composition_execution_observed:outputs.some(o=>o.data.authority==='semwright-composition'),
    canonical_runtime_authority:false,
    note:'Technical media receipts and editorial quality are independent. Launchwright does not render or reimplement Composition clocks/effects.'
  };
}
