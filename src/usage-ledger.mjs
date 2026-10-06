// SPDX-License-Identifier: AGPL-3.0-only
import { requireCondition as ensure, object, integer } from '@semwright/native-sdk';
import { inputObject, str, choice, sha, noSecrets, array, digest, iso } from './contracts.mjs';

const COMPUTE_ORIGINS=Object.freeze(['platform-managed','byo','unknown']);
const MEASUREMENT_KINDS=Object.freeze(['estimated','measured']);

function timestamp(value,label){str(value,64);ensure(Number.isFinite(Date.parse(value)),label+' must be an ISO timestamp');return value;}
function byKey(app,kind,field,value){return app.list(kind).find(entity=>entity.data[field]===value)??null;}
function cost(raw,{measurement=false}={}){
  const fields=measurement
    ? ['kind','total_microunits','own_compute_microunits','service_microunits','currency','runtime_ms','storage_bytes','egress_bytes']
    : ['total_microunits','own_compute_microunits','service_microunits','currency'];
  object(raw,fields,fields);
  if(measurement)choice(raw.kind,MEASUREMENT_KINDS);
  integer(raw.total_microunits,0,1000000000);
  integer(raw.own_compute_microunits,0,1000000000);
  integer(raw.service_microunits,0,1000000000);
  str(raw.currency,8);
  ensure(raw.total_microunits===raw.own_compute_microunits+raw.service_microunits,'Cost total must equal own-compute plus service components');
  if(measurement){
    integer(raw.runtime_ms,0,86400000);
    integer(raw.storage_bytes,0,Number.MAX_SAFE_INTEGER);
    integer(raw.egress_bytes,0,Number.MAX_SAFE_INTEGER);
  }
  return structuredClone(raw);
}
function assertOriginCost(origin,record){
  choice(origin,COMPUTE_ORIGINS);
  if(origin!=='platform-managed')ensure(record.own_compute_microunits===0,'BYO/unknown compute cannot be charged as Platform-owned compute','PolicyDenied');
}
function reservationDigest(data){return digest('usage-reservation',data);}
function receiptDigest(data){return digest('usage-receipt',data);}
function adjustmentDigest(data){return digest('usage-adjustment',data);}
function callbackDigest(data){return digest('billing-test-callback',data);}

export function reserveUsage(app,input){
  inputObject(input,['work_id','reservation_key','compute_origin','reserved_microunits','estimate'],['work_id','reservation_key','compute_origin','reserved_microunits','estimate']);
  const work=app.get(input.work_id,'work'),key=str(input.reservation_key,128);
  ensure(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key),'Invalid reservation key');
  const origin=choice(input.compute_origin,COMPUTE_ORIGINS),estimate=cost(input.estimate);
  assertOriginCost(origin,estimate);
  ensure(estimate.currency===work.data.budget.currency,'Reservation currency differs from work budget','Conflict');
  const reserved=integer(input.reserved_microunits,0,1000000000);
  ensure(reserved>=estimate.total_microunits,'Reservation cannot be below the declared estimate','PolicyDenied');
  ensure(reserved<=work.data.budget.max_cost_microunits,'Reservation exceeds work budget ceiling','PolicyDenied');
  const normalized={
    release_id:work.data.release_id,work_id:work.id,reservation_key:key,compute_origin:origin,
    reserved_microunits:reserved,estimate,budget_ceiling:structuredClone(work.data.budget),
    billing_authority:false,platform_authority:'EXTERNAL'
  };
  const reservation_sha256=reservationDigest(normalized),existing=byKey(app,'usage_reservation','reservation_key',key);
  if(existing){
    ensure(existing.data.reservation_sha256===reservation_sha256,'Reservation key was already bound to another intent','Conflict');
    return{entity:existing,duplicate:true,ledger_entry_created:false};
  }
  return{entity:app.store.create('usage_reservation',{...normalized,reservation_sha256,created_at:iso()}),duplicate:false,ledger_entry_created:true};
}

export function recordUsage(app,input){
  inputObject(input,['reservation_id','source','provider_event_id','observed_at','compute_origin','measurement','correlation'],
    ['reservation_id','source','provider_event_id','observed_at','compute_origin','measurement','correlation']);
  const reservation=app.get(input.reservation_id,'usage_reservation'),work=app.get(reservation.data.work_id,'work');
  const source=choice(input.source,['semwright-platform','test-fixture']),eventId=str(input.provider_event_id,160);
  ensure(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(eventId),'Invalid provider event ID');
  const observedAt=timestamp(input.observed_at,'Usage observed_at');
  const origin=choice(input.compute_origin,COMPUTE_ORIGINS);
  ensure(origin===reservation.data.compute_origin,'Usage compute origin differs from its reservation','Conflict');
  const measurement=cost(input.measurement,{measurement:true});assertOriginCost(origin,measurement);
  ensure(measurement.currency===reservation.data.estimate.currency,'Usage currency differs from reservation','Conflict');
  // Observed external overages are retained instead of suppressed. Enforcement belongs to the executor/Platform.
  object(input.correlation,['platform_job_id','native_receipt_sha256','artifact_id'],[]);
  noSecrets(input.correlation);
  const correlation={platform_job_id:null,native_receipt_sha256:null,artifact_id:null,artifact_sha256:null};
  if(input.correlation.platform_job_id!==undefined){
    correlation.platform_job_id=str(input.correlation.platform_job_id,96);
    ensure(work.data.platform_job_id&&work.data.platform_job_id===correlation.platform_job_id,'Platform job correlation does not match recorded work','Conflict');
  }
  if(input.correlation.native_receipt_sha256!==undefined)correlation.native_receipt_sha256=sha(input.correlation.native_receipt_sha256);
  if(input.correlation.artifact_id!==undefined){
    const artifact=app.get(input.correlation.artifact_id,'artifact');
    ensure(artifact.data.release_id===reservation.data.release_id,'Usage artifact belongs to another release','PermissionDenied');
    correlation.artifact_id=artifact.id;correlation.artifact_sha256=artifact.data.sha256;
  }
  const normalized={
    release_id:reservation.data.release_id,work_id:work.id,reservation_id:reservation.id,source,
    provider_event_id:eventId,observed_at:observedAt,compute_origin:origin,measurement,correlation,
    billing_authority:false,technical_evidence_admitted:false
  };
  noSecrets(normalized);
  const event_sha256=receiptDigest(normalized);
  const existing=app.list('usage_receipt').find(entity=>entity.data.source===source&&entity.data.provider_event_id===eventId)??null;
  if(existing){
    ensure(existing.data.event_sha256===event_sha256,'Provider event ID was replayed with different usage data','Conflict');
    return{entity:existing,duplicate:true,logical_usage_entries:1,ledger_entry_created:false};
  }
  return{entity:app.store.create('usage_receipt',{...normalized,event_sha256,created_at:iso()}),duplicate:false,logical_usage_entries:1,ledger_entry_created:true};
}

function reservationReceipts(app,reservationId){return app.list('usage_receipt').filter(entity=>entity.data.reservation_id===reservationId);}
function reservationAdjustments(app,reservationId){return app.list('usage_adjustment').filter(entity=>entity.data.reservation_id===reservationId).sort((a,b)=>a.data.accounting_sequence-b.data.accounting_sequence);}
function basisCharge(app,reservation,ids){
  array(ids,128).forEach(strId=>str(strId,96));
  ensure(ids.length>0&&new Set(ids).size===ids.length,'Adjustment requires unique measured receipt IDs');
  let total=0;
  for(const id of ids){
    const receipt=app.get(id,'usage_receipt');
    ensure(receipt.data.reservation_id===reservation.id,'Adjustment receipt belongs to another reservation','Conflict');
    ensure(receipt.data.measurement.kind==='measured','Final accounting can only use measured receipts','PolicyDenied');
    total+=receipt.data.measurement.total_microunits;
    ensure(Number.isSafeInteger(total),'Usage total exceeds exact integer range','ResourceExhausted');
  }
  return total;
}

export function adjustUsage(app,input){
  inputObject(input,['reservation_id','adjustment_key','receipt_ids','replaces_adjustment_id','reason'],
    ['reservation_id','adjustment_key','receipt_ids','reason']);
  const reservation=app.get(input.reservation_id,'usage_reservation'),work=app.get(reservation.data.work_id,'work');
  const key=str(input.adjustment_key,128);ensure(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key),'Invalid adjustment key');
  const reason=str(input.reason,1000);ensure(reason.trim().length>=3,'Adjustment reason is required');
  const receipts=[...input.receipt_ids].sort(),charge=basisCharge(app,reservation,receipts);
  // This ledger records the measured accounting projection even if an external executor exceeded the requested ceiling.
  const replaces=input.replaces_adjustment_id??null,existing=byKey(app,'usage_adjustment','adjustment_key',key);
  if(existing){
    ensure(existing.data.reservation_id===reservation.id&&existing.data.reason===reason&&existing.data.replaces_adjustment_id===replaces&&
      existing.data.charge_microunits===charge&&JSON.stringify(existing.data.receipt_ids)===JSON.stringify(receipts),
      'Adjustment key was already bound to another accounting state','Conflict');
    return{entity:existing,duplicate:true,ledger_entry_created:false};
  }
  const prior=reservationAdjustments(app,reservation.id),latest=prior.at(-1)??null,accountingSequence=prior.length+1;
  if(latest)ensure(replaces===latest.id,'Correction must replace the latest accounting adjustment','StaleReference');
  else ensure(replaces===null,'Initial finalization cannot replace another adjustment','Conflict');
  const normalized={
    release_id:reservation.data.release_id,work_id:work.id,reservation_id:reservation.id,adjustment_key:key,
    accounting_sequence:accountingSequence,kind:latest?'correction':'finalize',receipt_ids:receipts,replaces_adjustment_id:replaces,
    charge_microunits:charge,currency:reservation.data.estimate.currency,reason,
    billing_authority:false,platform_authority:'EXTERNAL'
  };
  const adjustment_sha256=adjustmentDigest(normalized);
  return{entity:app.store.create('usage_adjustment',{...normalized,adjustment_sha256,created_at:iso()}),duplicate:false,ledger_entry_created:true};
}

export function inspectUsage(app,input){
  inputObject(input,['reservation_id']);const reservation=app.get(input.reservation_id,'usage_reservation');
  const work=app.get(reservation.data.work_id,'work'),receipts=reservationReceipts(app,reservation.id),adjustments=reservationAdjustments(app,reservation.id);
  const measured=receipts.filter(r=>r.data.measurement.kind==='measured').reduce((n,r)=>n+r.data.measurement.total_microunits,0);
  const estimatedObserved=receipts.filter(r=>r.data.measurement.kind==='estimated').reduce((n,r)=>n+r.data.measurement.total_microunits,0);
  const latest=adjustments.at(-1)??null,charge=latest?.data.charge_microunits??null;
  const maxRuntimeMs=receipts.reduce((n,r)=>Math.max(n,r.data.measurement.runtime_ms),0);
  const budgetOverage=charge===null?null:Math.max(0,charge-work.data.budget.max_cost_microunits);
  return{
    schema_version:'launchwright-usage-ledger/1',reservation,receipts,adjustments,
    accounting:{
      estimate_microunits:reservation.data.estimate.total_microunits,
      observed_estimated_microunits:estimatedObserved,observed_measured_microunits:measured,
      reserved_microunits:reservation.data.reserved_microunits,
      accounted_charge_microunits:charge,
      released_microunits:charge===null?null:Math.max(0,reservation.data.reserved_microunits-charge),
      reservation_overage_microunits:charge===null?null:Math.max(0,charge-reservation.data.reserved_microunits),
      work_budget_overage_microunits:budgetOverage,
      currency:reservation.data.estimate.currency,finalized:latest!==null
    },
    compute:{origin:reservation.data.compute_origin,own_compute_charge_forbidden:reservation.data.compute_origin!=='platform-managed'},
    limits:{cost_ceiling_microunits:work.data.budget.max_cost_microunits,cost_ceiling_exceeded:budgetOverage===null?null:budgetOverage>0,runtime_ceiling_seconds:work.data.budget.max_runtime_seconds,max_observed_runtime_ms:maxRuntimeMs,runtime_ceiling_exceeded:maxRuntimeMs>work.data.budget.max_runtime_seconds*1000,runtime_stop_authority:false,executor_enforcement:'external-platform-required'},
    authority:{billing:false,platform_ledger:false,native_execution:false},
    note:'Launchwright preserves an application-side projection; Semwright Platform remains authoritative for admission, metering, billing and executor-enforced limits.'
  };
}

export function recordBillingTestCallback(app,input){
  inputObject(input,['adjustment_id','callback_id','state','observed_at'],['adjustment_id','callback_id','state','observed_at']);
  const adjustment=app.get(input.adjustment_id,'usage_adjustment'),reservation=app.get(adjustment.data.reservation_id,'usage_reservation');
  const callbackId=str(input.callback_id,160);ensure(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(callbackId),'Invalid callback ID');
  const state=choice(input.state,['accepted','failed']),observedAt=timestamp(input.observed_at,'Billing callback observed_at');
  const normalized={
    release_id:adjustment.data.release_id,work_id:adjustment.data.work_id,reservation_id:reservation.id,
    adjustment_id:adjustment.id,callback_id:callbackId,state,observed_at:observedAt,mode:'test',
    external_charge:false,render_retry_triggered:false,evidence_mutated:false,billing_authority:false
  };
  const callback_sha256=callbackDigest(normalized),existing=byKey(app,'billing_test_receipt','callback_id',callbackId);
  if(existing){
    ensure(existing.data.callback_sha256===callback_sha256,'Billing test callback ID was replayed with different data','Conflict');
    return{entity:existing,duplicate:true,ledger_entry_created:false};
  }
  return{entity:app.store.create('billing_test_receipt',{...normalized,callback_sha256,created_at:iso()}),duplicate:false,ledger_entry_created:true};
}
