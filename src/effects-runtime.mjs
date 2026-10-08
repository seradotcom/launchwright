// SPDX-License-Identifier: AGPL-3.0-only
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {join,sep} from 'node:path';
import {object,requireCondition as ensure,validateValue,integer} from '@semwright/native-sdk';
import {sha,str} from './contracts.mjs';

export const EFFECTS_RUNTIME_SEMWRIGHT_SHA='d2da9a495a53fe279a1ca4de61f0e24646350f22';
export const EFFECTS_RUNTIME_PROVIDER='driver:launchwright-effects';
export const EFFECTS_RUNTIME_PROVIDER_VERSION='0.2.0-dev.1';
export const EFFECTS_RUNTIME_RECEIPT_SCHEMA='launchwright-effects-runtime/1';
export const EFFECTS_DRIVER_RESULT_SCHEMA='launchwright-effects-driver-result/1';
export const EFFECTS_RUNTIME_COMMAND='driver.launchwright-effects.verify';
export const EFFECTS_READER_SOURCE_SHA256='21c04e7ee35f0f77bd1858077a435c2b11e38e21a7e2e48d07c052665e49c530';

const hashBytes=bytes=>createHash('sha256').update(bytes).digest('hex');
const hashText=text=>hashBytes(Buffer.from(text,'utf8'));

function readPinnedReceipt(root,reference){
  ensure(typeof root==='string'&&root.length>0,'Canonical Effects receipt grant is unavailable','PolicyDenied');
  object(reference,['file','sha256'],['file','sha256']);str(reference.file,160);sha(reference.sha256);
  ensure(/^[a-z0-9][a-z0-9._-]{0,127}\.json$/u.test(reference.file),'Effects receipt filename is not a single bounded JSON file');
  const grant=realpathSync(root),path=join(grant,reference.file),meta=lstatSync(path);
  ensure(meta.isFile()&&!meta.isSymbolicLink(),'Effects receipt must be a regular non-symlink file','PermissionDenied');
  ensure(meta.size>0&&meta.size<=512*1024,'Effects receipt exceeds its byte budget','ResourceExhausted');
  const canonical=realpathSync(path);
  ensure(canonical.startsWith(grant.endsWith(sep)?grant:grant+sep),'Effects receipt escapes its owner grant','PermissionDenied');
  const bytes=readFileSync(canonical),observed=hashBytes(bytes);
  ensure(observed===reference.sha256,'Effects receipt digest differs from its pinned bytes','Conflict');
  let receipt;
  try{receipt=JSON.parse(bytes.toString('utf8'));}catch{ensure(false,'Effects receipt is not valid JSON','InvalidArgument');}
  validateValue(receipt);
  return{receipt,receipt_sha256:observed};
}

function parseResult(text){
  ensure(typeof text==='string'&&Buffer.byteLength(text)>0&&Buffer.byteLength(text)<=192000,'Effects result text exceeds runtime admission budget','ResourceExhausted');
  let result;
  try{result=JSON.parse(text);}catch{ensure(false,'Effects runtime result is not valid JSON','InvalidArgument');}
  validateValue(result);
  object(result,[
    'schema_version','spec_sha256','source_digest','runtime_digest',
    'declared_producer_execution_status','context_attestation','inspection_state',
    'scope','execution_authority','evaluation','verdict','private_measurements'
  ],[
    'schema_version','spec_sha256','source_digest','runtime_digest',
    'declared_producer_execution_status','context_attestation','inspection_state',
    'scope','execution_authority','evaluation','verdict','private_measurements'
  ]);
  ensure(result.schema_version==='semwright-native-effects-result/1','Effects runtime result schema is not admitted','Conflict');
  sha(result.spec_sha256);sha(result.source_digest);sha(result.runtime_digest);
  ensure(result.scope==='immutable_native_sdk_artifact_properties_only','Effects runtime result scope is not admitted','PolicyDenied');
  ensure(result.execution_authority===false,'Effects runtime result may not carry execution authority','Conflict');
  ensure(['PASS','FAIL','UNKNOWN'].includes(result.verdict),'Effects runtime verdict is invalid','Conflict');
  ensure(['EVALUATED','INCOMPLETE','ERROR'].includes(result.inspection_state),'Effects runtime inspection state is invalid','Conflict');
  return result;
}

export function admitEffectsRuntime(app,input){
  ensure(input.admit===true,'Effects runtime admission requires explicit admit=true','InvalidArgument');
  ensure(input.runtime_receipt,'Effects runtime admission requires a pinned receipt','InvalidArgument');
  const {receipt,receipt_sha256}=readPinnedReceipt(app.effectsReceiptRoot,input.runtime_receipt);
  object(receipt,
    ['schema_version','observed_at','semwright_sha','provider','provider_version','provider_generation','descriptor_sha256','provider_executable_sha256','evaluator_executable_sha256','command','broker_policy_path_observed','driver_host_isolation_accepted','evaluator_driver_host_isolated','platform_execution_authority','external_customer_acceptance','report'],
    ['schema_version','observed_at','semwright_sha','provider','provider_version','provider_generation','descriptor_sha256','provider_executable_sha256','evaluator_executable_sha256','command','broker_policy_path_observed','driver_host_isolation_accepted','evaluator_driver_host_isolated','platform_execution_authority','external_customer_acceptance','report']);
  ensure(receipt.schema_version===EFFECTS_RUNTIME_RECEIPT_SCHEMA,'Effects runtime receipt schema is not admitted','Conflict');
  str(receipt.observed_at,64);ensure(Number.isFinite(Date.parse(receipt.observed_at)),'Effects runtime observed_at is invalid');
  ensure(receipt.semwright_sha===EFFECTS_RUNTIME_SEMWRIGHT_SHA,'Effects runtime receipt comes from another Semwright revision','Conflict');
  ensure(receipt.provider===EFFECTS_RUNTIME_PROVIDER,'Effects runtime provider is not admitted','PermissionDenied');
  ensure(receipt.provider_version===EFFECTS_RUNTIME_PROVIDER_VERSION,'Effects runtime provider version is not admitted','Conflict');
  integer(receipt.provider_generation,0,Number.MAX_SAFE_INTEGER);
  sha(receipt.descriptor_sha256);sha(receipt.provider_executable_sha256);sha(receipt.evaluator_executable_sha256);
  ensure(receipt.evaluator_executable_sha256===receipt.provider_executable_sha256,'Effects evaluator identity differs from the Driver Host provider binary','Conflict');
  ensure(receipt.command===EFFECTS_RUNTIME_COMMAND,'Effects runtime command is not admitted','PermissionDenied');
  ensure(receipt.broker_policy_path_observed===true&&receipt.driver_host_isolation_accepted===true&&receipt.evaluator_driver_host_isolated===true,'Effects runtime receipt did not establish Driver Host evaluator execution','PolicyDenied');
  ensure(receipt.platform_execution_authority===false&&receipt.external_customer_acceptance===false,'Effects runtime receipt may not manufacture external authority','Conflict');

  object(receipt.report,
    ['schema_version','spec_sha256','result_sha256','result_text','verdict','inspection_state','scope','runtime_digest','source_digest','execution_authority'],
    ['schema_version','spec_sha256','result_sha256','result_text','verdict','inspection_state','scope','runtime_digest','source_digest','execution_authority']);
  ensure(receipt.report.schema_version===EFFECTS_DRIVER_RESULT_SCHEMA,'Effects driver result schema is not admitted','Conflict');
  sha(receipt.report.spec_sha256);sha(receipt.report.result_sha256);sha(receipt.report.runtime_digest);sha(receipt.report.source_digest);
  str(receipt.report.result_text,192000);
  ensure(receipt.report.execution_authority===false,'Effects driver report may not carry execution authority','Conflict');
  ensure(receipt.report.spec_sha256===hashText(input.spec_text),'Effects Host receipt is bound to another protected spec','Conflict');
  ensure(receipt.report.result_sha256===hashText(input.result_text)&&receipt.report.result_text===input.result_text,'Effects Host receipt is bound to different result bytes','Conflict');

  const result=parseResult(input.result_text);
  ensure(result.spec_sha256===receipt.report.spec_sha256,'Effects result/spec binding differs from Host report','Conflict');
  ensure(result.runtime_digest===receipt.evaluator_executable_sha256&&receipt.report.runtime_digest===receipt.evaluator_executable_sha256,'Effects evaluator digest differs from the protected spec/result runtime binding','Conflict');
  ensure(result.source_digest===receipt.report.source_digest,'Effects source digest differs from Driver Host report','Conflict');
  ensure(result.source_digest===EFFECTS_READER_SOURCE_SHA256,'Effects result comes from another canonical reader source','Conflict');
  ensure(result.verdict===receipt.report.verdict&&result.inspection_state===receipt.report.inspection_state&&result.scope===receipt.report.scope,'Effects Host report differs from canonical result','Conflict');

  return{
    receipt_sha256,
    provider:receipt.provider,
    provider_version:receipt.provider_version,
    provider_generation:receipt.provider_generation,
    descriptor_sha256:receipt.descriptor_sha256,
    provider_executable_sha256:receipt.provider_executable_sha256,
    evaluator_executable_sha256:receipt.evaluator_executable_sha256,
    semwright_sha:receipt.semwright_sha,
    broker_policy_path_observed:true,
    driver_host_isolation_accepted:true,
    evaluator_driver_host_isolated:true,
    platform_execution_authority:false,
    external_customer_acceptance:false,
    scope:'immutable-native-effects-reader-only'
  };
}
