// SPDX-License-Identifier: AGPL-3.0-only
import { requireCondition as ensure } from '@semwright/native-sdk';
import { digest } from './base.mjs';
import { validateCapture } from './records.mjs';

const OBSERVED_CLASSES = new Set(['CAPTURED_ACTUAL','CAPTURED_DEMO_DATA']);

export function recordCapture(app, raw) {
  const data=validateCapture(raw);
  const release=app.get(data.release_id,'release');
  const target=app.get(data.target_id,'target');
  const source=app.get(data.source_id,'source');
  const scenario=app.get(data.scenario_id,'scenario');

  ensure(target.data.release_id===release.id&&scenario.data.release_id===release.id,'Capture target or scenario belongs to another release','PermissionDenied');
  ensure(source.data.product_id===release.data.product_id&&scenario.data.source_id===source.id&&scenario.data.target_id===target.id,'Capture source/scenario binding mismatch','PermissionDenied');
  ensure(source.data.approval==='approved','Capture source is not approved for execution','PermissionDenied');
  ensure(data.build===release.data.build,'Capture build differs from the release build','Conflict');

  for(const field of ['build_observation','build_before','build_after']){
    if(data.receipt[field]!==undefined) ensure(data.receipt[field]===data.build,'Capture receipt observed another build','Conflict');
  }
  if(data.receipt.build_before!==undefined||data.receipt.build_after!==undefined){
    ensure(data.receipt.build_before!==undefined&&data.receipt.build_after!==undefined,'Build drift observation requires both before and after values','InvalidArgument');
  }

  const captureClass=data.provenance.capture_class;
  if(captureClass==='CAPTURED_ACTUAL'){
    ensure(data.classification==='actual','Actual capture must use actual classification','InvalidArgument');
    ensure(data.provenance.synthetic===false,'Actual capture cannot be marked synthetic','InvalidArgument');
  }
  if(captureClass==='CAPTURED_DEMO_DATA'){
    ensure(data.classification==='demo','Demo-data capture must use demo classification','InvalidArgument');
    ensure(data.provenance.synthetic===true,'Demo-data capture must remain explicitly synthetic','InvalidArgument');
  }
  if(captureClass==='SANITIZED_DERIVATIVE') ensure(data.classification==='sanitized','Sanitized derivative must use sanitized classification','InvalidArgument');
  if(captureClass==='EDITORIAL_COMPOSITION') ensure(data.classification==='editorial','Editorial composition must use editorial classification','InvalidArgument');
  if(captureClass==='GENERATED_ILLUSTRATION') ensure(data.classification==='generated','Generated illustration must use generated classification','InvalidArgument');
  if(captureClass==='IMPORTED_UNVERIFIED') ensure(data.classification==='imported','Imported unverified material must use imported classification','InvalidArgument');

  const isObserved=OBSERVED_CLASSES.has(captureClass);
  if(isObserved){
    ensure(data.receipt.authority!=='imported','Observed capture requires an authorized Semwright execution receipt','PermissionDenied');
    ensure(!!data.receipt.platform_job_id,'Observed capture must correlate to a Platform job','InvalidArgument');
    ensure(!!data.receipt.native_receipt_sha256,'Observed capture must preserve the native receipt digest','InvalidArgument');
  }
  if(captureClass==='IMPORTED_UNVERIFIED') ensure(data.receipt.authority==='imported','Imported-unverified material must not claim Semwright execution authority','InvalidArgument');

  const succeeded=data.receipt.outcome==='SUCCEEDED';
  if(isObserved&&succeeded){
    ensure(data.readiness.state==='READY','Successful observed capture requires READY state','Conflict');
    ensure(data.readiness.checks.length>0&&data.readiness.checks.every(check=>check.state==='PASS'),'Successful observed capture requires all readiness checks to PASS','Conflict');

    const expected=new Map(scenario.data.anchors.map(anchor=>[anchor.name,anchor.expected_count]));
    ensure(data.anchors.length===expected.size,'Successful observed capture must account for every scenario anchor','Conflict');
    for(const observation of data.anchors){
      ensure(expected.has(observation.name),'Capture contains an anchor outside the scenario','Conflict');
      ensure(observation.observed_matches===expected.get(observation.name),'Ambiguous or missing anchor blocks observed capture','Conflict');
    }

    const requiresIsolation=(scenario.data.effects?.length??0)>0||['isolated-context','fixture-reset'].includes(scenario.data.reset_strategy);
    if(requiresIsolation){
      ensure(['run-scoped','fixture-scoped'].includes(data.isolation.auth_scope),'Mutable capture requires run- or fixture-scoped authentication','PermissionDenied');
      ensure(data.isolation.context_id.length>0,'Mutable capture requires an isolated execution context','InvalidArgument');
    }
  }

  let parent=null;
  let observedStateEligible=isObserved&&succeeded;
  if(captureClass==='SANITIZED_DERIVATIVE'){
    ensure(!!data.provenance.parent_evidence_id,'Sanitized derivative requires its source capture','InvalidArgument');
    ensure(data.provenance.transformations.length>0,'Sanitized derivative must enumerate transformations','InvalidArgument');
    parent=app.get(data.provenance.parent_evidence_id,'evidence');
    ensure(parent.data.release_id===release.id&&parent.data.evidence_type==='capture','Sanitized derivative parent is not a capture from this release','PermissionDenied');
    ensure(parent.data.build===data.build,'Sanitized derivative parent belongs to another build','Conflict');
    observedStateEligible=parent.data.observed_state_eligible===true&&data.provenance.transformations.every(t=>t.semantic_effect==='preserves-observed-state');
  } else {
    ensure(data.provenance.parent_evidence_id===undefined,'Only sanitized derivatives may name a parent capture','InvalidArgument');
  }

  if(['EDITORIAL_COMPOSITION','GENERATED_ILLUSTRATION','IMPORTED_UNVERIFIED'].includes(captureClass)) observedStateEligible=false;

  const admission=captureClass==='SANITIZED_DERIVATIVE'
    ? 'derived-provenance-recorded'
    : observedStateEligible
      ? 'semwright-receipt-recorded'
      : captureClass==='IMPORTED_UNVERIFIED'
        ? 'imported-declaration'
        : 'editorial-not-observed';

  return {
    entity:app.store.create('evidence',{
      release_id:release.id,target_id:target.id,source_id:source.id,scenario_id:scenario.id,
      name:data.name,build:data.build,classification:data.classification,rights:data.rights,
      description:'Capture contract for '+scenario.data.name,
      origin_digest:digest('capture-contract-v2',{receipt:data.receipt,readiness:data.readiness,anchors:data.anchors,isolation:data.isolation,cleanup:data.cleanup,provenance:data.provenance}),
      evidence_type:'capture',capture_contract:'launchwright-capture/2',capture_state:data.receipt.outcome,
      receipt:data.receipt,readiness:data.readiness,anchors:data.anchors,isolation:data.isolation,cleanup:data.cleanup,provenance:data.provenance,
      observations:data.observations,segments:data.segments??[],parent_evidence_id:parent?.id??null,
      observed_state_eligible:observedStateEligible,
      target_version:target.version,source_version:source.version,scenario_version:scenario.version,
      admission,technical:'UNKNOWN',host_acceptance:'NOT_ESTABLISHED',rights_basis:'operator-declaration',
      started_at:data.started_at,finished_at:data.finished_at,observed_at:data.finished_at
    })
  };
}
