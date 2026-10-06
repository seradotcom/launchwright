// SPDX-License-Identifier: AGPL-3.0-only
import { requireCondition as ensure, object, integer } from '@semwright/native-sdk';
import { inputObject, idText, str, choice, array, sha, noSecrets, digest } from './contracts.mjs';
import { iso } from './base.mjs';

const COMPUTE_SOURCES=Object.freeze(['platform-managed','byo','none']);
const CATEGORIES=Object.freeze(['admission','compute','storage','egress','service','render','other']);
const OUTCOMES=Object.freeze(['SUCCEEDED','FAILED','CANCELLED','OUTCOME_UNKNOWN']);
const PERF_SOURCES=Object.freeze(['local-lab','supported-ci','external-observed']);
const safeAdd=(a,b)=>{const n=a+b;ensure(Number.isSafeInteger(n),'Usage aggregate exceeds integer range','ResourceExhausted');return n;};
const sameVersion=(a,b)=>!!a&&!!b&&a.generation===b.generation&&a.revision===b.revision;

function timestamp(value,label){
  str(value,64);
  ensure(Number.isFinite(Date.parse(value)),label+' must be an ISO timestamp');
}
function budget(raw){
  object(raw,['max_cost_microunits','currency','max_runtime_seconds','max_storage_bytes','max_egress_bytes'],
    ['max_cost_microunits','currency','max_runtime_seconds','max_storage_bytes','max_egress_bytes']);
  integer(raw.max_cost_microunits,0,1000000000);
  str(raw.currency,8);
  ensure(/^[A-Z]{3,8}$/.test(raw.currency),'Invalid budget currency');
  integer(raw.max_runtime_seconds,1,86400);
  integer(raw.max_storage_bytes,0,1099511627776);
  integer(raw.max_egress_bytes,0,1099511627776);
  return structuredClone(raw);
}
function estimate(raw){
  object(raw,['billable_microunits','runtime_seconds','storage_bytes','egress_bytes','confidence'],
    ['billable_microunits','runtime_seconds','storage_bytes','egress_bytes','confidence']);
  integer(raw.billable_microunits,0,1000000000);
  integer(raw.runtime_seconds,0,86400);
  integer(raw.storage_bytes,0,1099511627776);
  integer(raw.egress_bytes,0,1099511627776);
  choice(raw.confidence,['exact','bounded','unknown']);
  return structuredClone(raw);
}
function measurement(raw){
  object(raw,['billable_microunits','managed_compute_microunits','runtime_seconds','storage_bytes','egress_bytes'],
    ['billable_microunits','managed_compute_microunits','runtime_seconds','storage_bytes','egress_bytes']);
  integer(raw.billable_microunits,0,1000000000);
  integer(raw.managed_compute_microunits,0,1000000000);
  integer(raw.runtime_seconds,0,86400);
  integer(raw.storage_bytes,0,1099511627776);
  integer(raw.egress_bytes,0,1099511627776);
  ensure(raw.managed_compute_microunits<=raw.billable_microunits,'Managed compute cannot exceed billable usage');
  return structuredClone(raw);
}
function totalsFor(app,reservationId){
  const receipts=app.list('usage_receipt').filter(row=>row.data.reservation_id===reservationId);
  const totals={billable_microunits:0,managed_compute_microunits:0,runtime_seconds:0,storage_bytes:0,egress_bytes:0};
  for(const row of receipts)for(const key of Object.keys(totals))totals[key]=safeAdd(totals[key],row.data.measured[key]);
  return{receipts,totals};
}
function breaches(b,t){
  const out=[];
  if(t.billable_microunits>b.max_cost_microunits)out.push('cost');
  if(t.runtime_seconds>b.max_runtime_seconds)out.push('runtime');
  if(t.storage_bytes>b.max_storage_bytes)out.push('storage');
  if(t.egress_bytes>b.max_egress_bytes)out.push('egress');
  return out;
}
function releaseFor(app,reservation){
  const release=app.get(reservation.data.release_id,'release');
  return{release,product_id:release.data.product_id};
}

export function recordUsageReservation(app,input){
  inputObject(input,['work_id','name','reservation_key','platform_reservation_id','reservation_receipt_sha256','reserved_cost_microunits','compute_source','budget','estimate'],
    ['work_id','name','reservation_key','platform_reservation_id','reservation_receipt_sha256','reserved_cost_microunits','compute_source','budget','estimate']);
  noSecrets(input);
  idText(input.work_id);
  str(input.name,160);
  str(input.reservation_key,128);
  str(input.platform_reservation_id,160);
  sha(input.reservation_receipt_sha256);
  ensure(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(input.reservation_key),'Invalid reservation key');
  const work=app.get(input.work_id,'work');
  ensure(work.data.state==='PREPARED','Usage reservation must bind unsent prepared work','Conflict');
  const b=budget(input.budget),e=estimate(input.estimate);
  choice(input.compute_source,COMPUTE_SOURCES);
  integer(input.reserved_cost_microunits,0,1000000000);
  ensure(input.reserved_cost_microunits<=b.max_cost_microunits,'Reserved cost exceeds work budget','PolicyDenied');
  ensure(work.data.budget.currency===b.currency&&work.data.budget.max_cost_microunits===b.max_cost_microunits&&work.data.budget.max_runtime_seconds===b.max_runtime_seconds,
    'Usage reservation budget differs from prepared work','Conflict');
  ensure(e.billable_microunits<=b.max_cost_microunits&&e.runtime_seconds<=b.max_runtime_seconds&&e.storage_bytes<=b.max_storage_bytes&&e.egress_bytes<=b.max_egress_bytes,
    'Estimate exceeds reservation budget','PolicyDenied');
  const body={release_id:work.data.release_id,work_id:work.id,name:input.name,reservation_key:input.reservation_key,
    platform_reservation_id:input.platform_reservation_id,reservation_receipt_sha256:input.reservation_receipt_sha256,
    reserved_cost_microunits:input.reserved_cost_microunits,compute_source:input.compute_source,budget:b,estimate:e};
  const reservation_digest=digest('usage-reservation',body);
  const matches=app.list('usage_reservation').filter(row=>row.data.reservation_key===input.reservation_key||row.data.platform_reservation_id===input.platform_reservation_id);
  if(matches.length){
    ensure(matches.length===1&&matches[0].data.reservation_digest===reservation_digest,'Reservation identity was reused with different content','Conflict');
    return{entity:matches[0],deduplicated:true};
  }
  ensure(!app.list('usage_reservation').some(row=>row.data.work_id===work.id&&['RESERVED','RECONCILIATION_REQUIRED'].includes(row.data.state)),
    'Prepared work already has an active usage reservation','Conflict');
  return{entity:app.store.create('usage_reservation',{...body,reservation_digest,state:'RESERVED',authority:'platform-reservation-receipt',
    execution_authority:false,billing_authority:false,created_by:app.principal,created_at:iso()}),deduplicated:false};
}

export function recordUsageReceipt(app,input){
  inputObject(input,['reservation_id','receipt_id','platform_ledger_id','platform_job_id','native_receipt_sha256','artifact_ids','category','compute_source','measured','observed_at'],
    ['reservation_id','receipt_id','platform_ledger_id','platform_job_id','artifact_ids','category','compute_source','measured','observed_at']);
  noSecrets(input);
  idText(input.reservation_id);
  str(input.receipt_id,160);
  str(input.platform_ledger_id,160);
  str(input.platform_job_id,160);
  if(input.native_receipt_sha256!==undefined)sha(input.native_receipt_sha256);
  array(input.artifact_ids,32).forEach(idText);
  ensure(new Set(input.artifact_ids).size===input.artifact_ids.length,'Duplicate usage artifact');
  choice(input.category,CATEGORIES);
  choice(input.compute_source,COMPUTE_SOURCES);
  timestamp(input.observed_at,'Usage observed_at');
  const measured=measurement(input.measured);
  const reservation=app.get(input.reservation_id,'usage_reservation');
  ensure(input.compute_source===reservation.data.compute_source,'Usage compute source differs from reservation','Conflict');
  if(input.compute_source==='byo'&&input.category==='compute')
    ensure(measured.billable_microunits===0&&measured.managed_compute_microunits===0,'BYO compute cannot be billed as managed GPU/compute','PolicyDenied');
  const{release,product_id}=releaseFor(app,reservation),work=app.get(reservation.data.work_id,'work');
  if(work.data.platform_job_id)ensure(input.platform_job_id===work.data.platform_job_id,'Usage receipt Platform job differs from work result','Conflict');
  for(const id of input.artifact_ids){
    const artifact=app.get(id,'artifact');
    ensure(app.productOf(artifact)===product_id,'Usage artifact belongs to another product','PermissionDenied');
  }
  const body={reservation_id:reservation.id,release_id:release.id,work_id:work.id,receipt_id:input.receipt_id,
    platform_ledger_id:input.platform_ledger_id,platform_job_id:input.platform_job_id,native_receipt_sha256:input.native_receipt_sha256??null,
    artifact_ids:[...input.artifact_ids].sort(),category:input.category,compute_source:input.compute_source,measured,observed_at:input.observed_at};
  const receipt_digest=digest('usage-receipt',body);
  const matches=app.list('usage_receipt').filter(row=>row.data.receipt_id===input.receipt_id||row.data.platform_ledger_id===input.platform_ledger_id);
  if(matches.length){
    ensure(matches.length===1&&matches[0].data.receipt_digest===receipt_digest,'Usage receipt identity was reused with different content','Conflict');
    return{entity:matches[0],deduplicated:true};
  }
  ensure(['RESERVED','RECONCILIATION_REQUIRED'].includes(reservation.data.state),'Usage reservation is already final','Conflict');
  return{entity:app.store.create('usage_receipt',{...body,receipt_digest,authority:'platform-ledger-receipt',billing_effect:false,
    recorded_by:app.principal,recorded_at:iso()}),deduplicated:false};
}

export function finalizeUsage(app,input){
  inputObject(input,['id','expected','outcome','platform_adjustment_id','adjustment_receipt_sha256','uncertainty_note'],['id','expected','outcome']);
  idText(input.id);
  object(input.expected,['resource','generation','revision'],['resource','generation','revision']);
  choice(input.outcome,OUTCOMES);
  if(input.platform_adjustment_id!==undefined)str(input.platform_adjustment_id,160);
  if(input.adjustment_receipt_sha256!==undefined)sha(input.adjustment_receipt_sha256);
  if(input.uncertainty_note!==undefined)str(input.uncertainty_note,2000);
  const reservation=app.get(input.id,'usage_reservation');
  const finalizationInput={outcome:input.outcome,platform_adjustment_id:input.platform_adjustment_id??null,
    adjustment_receipt_sha256:input.adjustment_receipt_sha256??null,uncertainty_note:input.uncertainty_note??null};
  const finalization_digest=digest('usage-finalization',finalizationInput);
  if(reservation.data.state==='FINALIZED'&&reservation.data.finalization_digest){
    ensure(reservation.data.finalization_digest===finalization_digest,'Usage finalization already recorded with different content','Conflict');
    return{entity:reservation,deduplicated:true};
  }
  if(reservation.data.state==='RECONCILIATION_REQUIRED'&&input.outcome==='OUTCOME_UNKNOWN'&&reservation.data.finalization_digest){
    ensure(reservation.data.finalization_digest===finalization_digest,'Usage uncertainty record differs from the prior reconciliation state','Conflict');
    return{entity:reservation,deduplicated:true};
  }
  ensure(sameVersion(reservation.version,input.expected),'Usage reservation revision changed','StaleReference');
  ensure(['RESERVED','RECONCILIATION_REQUIRED'].includes(reservation.data.state),'Usage reservation is already final','Conflict');
  const{totals}=totalsFor(app,reservation.id),limit_breaches=breaches(reservation.data.budget,totals);
  if(input.outcome==='OUTCOME_UNKNOWN'){
    ensure(input.uncertainty_note,'Unknown outcome requires an uncertainty note');
    return{entity:app.store.update(reservation.id,{...reservation.data,state:'RECONCILIATION_REQUIRED',outcome:input.outcome,measured:totals,limit_breaches,
      released_cost_microunits:0,billing_ready:false,uncertainty_note:input.uncertainty_note,finalization_digest,last_reconciled_at:iso()}),deduplicated:false};
  }
  ensure(input.platform_adjustment_id&&input.adjustment_receipt_sha256,'Known finalization requires a Platform adjustment receipt','InvalidArgument');
  const released_cost_microunits=Math.max(0,reservation.data.reserved_cost_microunits-totals.billable_microunits);
  const overrun_microunits=Math.max(0,totals.billable_microunits-reservation.data.reserved_cost_microunits);
  return{entity:app.store.update(reservation.id,{...reservation.data,state:'FINALIZED',outcome:input.outcome,measured:totals,limit_breaches,
    platform_adjustment_id:input.platform_adjustment_id,adjustment_receipt_sha256:input.adjustment_receipt_sha256,
    released_cost_microunits,overrun_microunits,budget_exceeded:limit_breaches.length>0,billing_ready:true,
    uncertainty_note:input.uncertainty_note??null,finalization_digest,finalized_by:app.principal,finalized_at:iso()}),deduplicated:false};
}

export function recordBillingEvent(app,input){
  inputObject(input,['id','event_id','invoice_id','mode','status','amount_microunits','currency','platform_receipt_sha256','received_at'],
    ['id','event_id','invoice_id','mode','status','amount_microunits','currency','platform_receipt_sha256','received_at']);
  noSecrets(input);
  idText(input.id);
  str(input.event_id,160);
  str(input.invoice_id,160);
  choice(input.mode,['test']);
  choice(input.status,['SETTLED','FAILED','ADJUSTED']);
  integer(input.amount_microunits,0,1000000000);
  str(input.currency,8);
  sha(input.platform_receipt_sha256);
  timestamp(input.received_at,'Billing received_at');
  const body={reservation_id:input.id,event_id:input.event_id,invoice_id:input.invoice_id,mode:input.mode,status:input.status,
    amount_microunits:input.amount_microunits,currency:input.currency,platform_receipt_sha256:input.platform_receipt_sha256,received_at:input.received_at};
  const event_digest=digest('billing-event',body);
  const matches=app.list('billing_event').filter(row=>row.data.event_id===input.event_id);
  if(matches.length){
    ensure(matches.length===1&&matches[0].data.event_digest===event_digest,'Billing event ID was reused with different content','Conflict');
    return{entity:matches[0],deduplicated:true};
  }
  const reservation=app.get(input.id,'usage_reservation');
  ensure(reservation.data.state==='FINALIZED'&&reservation.data.billing_ready===true,'Usage must be finalized before billing callback custody','Conflict');
  ensure(input.currency===reservation.data.budget.currency,'Billing currency differs from reservation','Conflict');
  ensure(input.amount_microunits===reservation.data.measured.billable_microunits,'Test invoice amount differs from finalized measured billable usage','Conflict');
  return{entity:app.store.create('billing_event',{...body,event_digest,release_id:reservation.data.release_id,work_id:reservation.data.work_id,
    live_charge:false,execution_retriggered:false,evidence_changed:false,authority:'platform-test-billing-receipt',
    recorded_by:app.principal,recorded_at:iso()}),deduplicated:false};
}

export function recordPerformanceSample(app,input){
  inputObject(input,['reservation_id','sample_id','environment','phases','measured_at','evidence_refs'],
    ['reservation_id','sample_id','environment','phases','measured_at']);
  noSecrets(input);
  idText(input.reservation_id);
  str(input.sample_id,160);
  object(input.environment,['source','name','runner','code_sha'],['source','name','runner','code_sha']);
  choice(input.environment.source,PERF_SOURCES);
  str(input.environment.name,160);
  str(input.environment.runner,160);
  sha(input.environment.code_sha);
  object(input.phases,['query_ms','admission_ms','queue_ms','render_ms'],['query_ms','admission_ms','queue_ms','render_ms']);
  for(const value of Object.values(input.phases))integer(value,0,86400000);
  timestamp(input.measured_at,'Performance measured_at');
  const refs=input.evidence_refs??[];
  array(refs,32).forEach(v=>str(v,256));
  const reservation=app.get(input.reservation_id,'usage_reservation');
  const body={reservation_id:reservation.id,release_id:reservation.data.release_id,work_id:reservation.data.work_id,
    sample_id:input.sample_id,environment:structuredClone(input.environment),phases:structuredClone(input.phases),
    measured_at:input.measured_at,evidence_refs:[...refs]};
  const sample_digest=digest('performance-sample',body);
  const matches=app.list('performance_sample').filter(row=>row.data.sample_id===input.sample_id);
  if(matches.length){
    ensure(matches.length===1&&matches[0].data.sample_digest===sample_digest,'Performance sample ID was reused with different content','Conflict');
    return{entity:matches[0],deduplicated:true};
  }
  return{entity:app.store.create('performance_sample',{...body,sample_digest,production_slo_claim:false,
    percentile_claim_allowed:input.environment.source==='external-observed',recorded_by:app.principal,recorded_at:iso()}),deduplicated:false};
}

export function inspectUsage(app,input){
  inputObject(input,['id']);
  idText(input.id);
  const reservation=app.get(input.id,'usage_reservation');
  const{receipts,totals}=totalsFor(app,reservation.id);
  const billing=app.list('billing_event').filter(row=>row.data.reservation_id===reservation.id);
  const performance=app.list('performance_sample').filter(row=>row.data.reservation_id===reservation.id);
  const work=app.get(reservation.data.work_id,'work');
  const artifact_ids=[...new Set(receipts.flatMap(row=>row.data.artifact_ids))].sort();
  return{schema_version:'launchwright-usage-ledger/1',reservation,receipts,billing_events:billing,performance_samples:performance,
    estimate_vs_measured:{estimate:reservation.data.estimate,measured:totals,
      billable_variance_microunits:totals.billable_microunits-reservation.data.estimate.billable_microunits},
    correlation:{release_id:reservation.data.release_id,work_id:work.id,platform_job_id:work.data.platform_job_id??null,
      platform_reservation_id:reservation.data.platform_reservation_id,
      platform_ledger_ids:[...new Set(receipts.map(row=>row.data.platform_ledger_id))].sort(),
      native_receipt_sha256:[...new Set(receipts.map(row=>row.data.native_receipt_sha256).filter(Boolean))].sort(),artifact_ids},
    limits:{budget:reservation.data.budget,breaches:breaches(reservation.data.budget,totals),enforcement:'platform-external-required'},
    billing:{test_only:true,live_charge_performed:false,events:billing.length},compute_source:reservation.data.compute_source,
    byo_managed_compute_billed:reservation.data.compute_source==='byo'&&totals.managed_compute_microunits>0,
    performance_policy:{phases_separate:true,production_slo_claim:false,environment_required:true}};
}

export function requirePreparedUsageReservation(app,work){
  if(work.data.budget.max_cost_microunits===0&&!['recipes.prepare','recipes.execute'].includes(work.data.action))return null;
  const rows=app.list('usage_reservation').filter(row=>row.data.work_id===work.id&&row.data.state==='RESERVED');
  ensure(rows.length===1,'Cost-bearing work requires exactly one recorded Platform budget reservation before send','PolicyDenied');
  const row=rows[0],b=row.data.budget;
  ensure(work.data.budget.currency===b.currency&&work.data.budget.max_cost_microunits===b.max_cost_microunits&&work.data.budget.max_runtime_seconds===b.max_runtime_seconds,
    'Recorded Platform reservation no longer matches prepared work budget','Conflict');
  ensure(row.data.platform_reservation_id&&row.data.reservation_receipt_sha256,'Platform reservation receipt is incomplete','Conflict');
  return row;
}
