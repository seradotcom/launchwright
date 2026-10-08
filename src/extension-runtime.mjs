// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { object, integer, requireCondition as ensure, validateValue } from '@semwright/native-sdk';
import { sha, str, lines } from './contracts.mjs';
import { digest } from './base.mjs';

export const EXTENSION_RUNTIME_SEMWRIGHT_SHA='d2da9a495a53fe279a1ca4de61f0e24646350f22';
export const EXTENSION_RUNTIME_PROVIDER='driver:launchwright-extension';
export const EXTENSION_RUNTIME_PROVIDER_VERSION='0.2.0-dev.1';
export const EXTENSION_RUNTIME_SCHEMA='launchwright-extension-runtime/1';

const same=(a,b)=>digest('extension-runtime-compare',a)===digest('extension-runtime-compare',b);

function readPinnedReceipt(root,reference){
  ensure(typeof root==='string'&&root.length>0,'Canonical extension receipt grant is unavailable','PolicyDenied');
  object(reference,['file','sha256'],['file','sha256']);str(reference.file,160);sha(reference.sha256);
  ensure(/^[a-z0-9][a-z0-9._-]{0,127}\.json$/u.test(reference.file),'Extension receipt filename is not a single bounded JSON file');
  const grant=realpathSync(root),path=join(grant,reference.file),meta=lstatSync(path);
  ensure(meta.isFile()&&!meta.isSymbolicLink(),'Extension receipt must be a regular non-symlink file','PermissionDenied');
  ensure(meta.size>0&&meta.size<=256*1024,'Extension receipt exceeds its byte budget','ResourceExhausted');
  const canonical=realpathSync(path);
  ensure(canonical.startsWith(grant.endsWith(sep)?grant:grant+sep),'Extension receipt escapes its owner grant','PermissionDenied');
  const bytes=readFileSync(canonical),observed=createHash('sha256').update(bytes).digest('hex');
  ensure(observed===reference.sha256,'Extension receipt digest differs from its pinned bytes','Conflict');
  let receipt;try{receipt=JSON.parse(bytes.toString('utf8'));}catch{ensure(false,'Extension receipt is not valid JSON','InvalidArgument');}
  validateValue(receipt);return{receipt,receipt_sha256:observed};
}

function validateEnvelope(receipt,data,expectedCommand){
  object(receipt,
    ['schema_version','observed_at','semwright_sha','provider','provider_version','provider_generation','descriptor_sha256','executable_sha256','command','broker_policy_path_observed','driver_host_isolation_accepted','platform_execution_authority','external_customer_acceptance','report'],
    ['schema_version','observed_at','semwright_sha','provider','provider_version','provider_generation','descriptor_sha256','executable_sha256','command','broker_policy_path_observed','driver_host_isolation_accepted','platform_execution_authority','external_customer_acceptance','report']);
  ensure(receipt.schema_version===EXTENSION_RUNTIME_SCHEMA,'Extension runtime receipt schema is not admitted','Conflict');
  str(receipt.observed_at,64);ensure(Number.isFinite(Date.parse(receipt.observed_at)),'Extension receipt observed_at is invalid');
  ensure(receipt.semwright_sha===EXTENSION_RUNTIME_SEMWRIGHT_SHA,'Extension receipt comes from another Semwright source revision','Conflict');
  ensure(receipt.provider===EXTENSION_RUNTIME_PROVIDER,'Extension receipt provider is not admitted','PermissionDenied');
  ensure(receipt.provider_version===EXTENSION_RUNTIME_PROVIDER_VERSION,'Extension receipt provider version is not admitted','Conflict');integer(receipt.provider_generation,0,Number.MAX_SAFE_INTEGER);
  sha(receipt.descriptor_sha256);sha(receipt.executable_sha256);str(receipt.command,160);
  ensure(receipt.command===expectedCommand,'Extension receipt command is not admitted','PermissionDenied');
  ensure(receipt.observed_at===data.finished_at,'Extension receipt observed_at differs from the recorded completion time','Conflict');
  ensure(receipt.broker_policy_path_observed===true&&receipt.driver_host_isolation_accepted===true,'Extension receipt did not establish Broker/Driver Host execution','PolicyDenied');
  ensure(receipt.platform_execution_authority===false&&receipt.external_customer_acceptance===false,'Extension receipt may not manufacture external authority','Conflict');
  ensure(data.runtime_receipt!==undefined,'Canonical extension admission requires a pinned runtime receipt','InvalidArgument');
  return receipt.report;
}

function validateCommonReport(report,kind,extras=[]){
  const fields=['schema_version','kind','fixture_sha256','exit_code','stdout','stderr','stdout_sha256','stderr_sha256',...extras];
  object(report,fields,fields);
  ensure(report.schema_version==='launchwright-extension-driver-result/1','Extension driver result schema is not admitted','Conflict');
  ensure(report.kind===kind,'Extension receipt kind differs from the recorded operation','Conflict');
  sha(report.fixture_sha256);integer(report.exit_code,0,65535);lines(report.stdout,65536);lines(report.stderr,16384);
  sha(report.stdout_sha256);sha(report.stderr_sha256);
  ensure(createHash('sha256').update(Buffer.from(report.stdout,'utf8')).digest('hex')===report.stdout_sha256,'Extension receipt stdout digest differs from bytes','Conflict');
  ensure(createHash('sha256').update(Buffer.from(report.stderr,'utf8')).digest('hex')===report.stderr_sha256,'Extension receipt stderr digest differs from bytes','Conflict');
  ensure(report.exit_code===0,'Canonical extension execution did not succeed','Conflict');
  return report;
}

export function admitRendererRuntime(app,data){
  const prep=app.get(data.preparation_id,'extension_preparation'),ext=app.get(prep.data.extension_id,'extension_package');
  const {receipt,receipt_sha256}=readPinnedReceipt(app.extensionReceiptRoot,data.runtime_receipt);
  const report=validateCommonReport(validateEnvelope(receipt,data,'driver.launchwright-extension.render'),'renderer',['input_sha256','output_type','output']);
  sha(report.input_sha256);str(report.output_type,160);validateValue(report.output);
  ensure(report.fixture_sha256===ext.data.digest,'Renderer receipt executable source differs from registered extension digest','Conflict');
  ensure(report.input_sha256===data.input_sha256,'Renderer receipt input digest differs from recorded input','Conflict');
  ensure(report.output_type===data.output_type&&report.output_type===prep.data.output_type,'Renderer receipt output type differs from preparation','Conflict');
  let parsedOutput;try{parsedOutput=JSON.parse(report.stdout);}catch{ensure(false,'Renderer receipt stdout is not valid JSON','Conflict');}
  ensure(same(parsedOutput,report.output)&&same(report.output,data.output),'Renderer receipt stdout/output differs from recorded output','Conflict');
  ensure(data.outcome==='SUCCESS','Canonical renderer receipt cannot admit a failed process outcome','Conflict');
  return{receipt_sha256,provider:receipt.provider,provider_version:receipt.provider_version,provider_generation:receipt.provider_generation,
    descriptor_sha256:receipt.descriptor_sha256,executable_sha256:receipt.executable_sha256,semwright_sha:receipt.semwright_sha,
    broker_policy_path_observed:true,driver_host_isolation_accepted:true,platform_execution_authority:false,external_customer_acceptance:false,
    scope:'owned-deltarender-driver-host-only',report};
}

export function admitCliRuntime(app,data){
  const source=app.get(data.source_id,'source'),target=app.get(data.target_id,'target');
  const release=app.get(target.data.release_id,'release');
  const extension=data.extension_id?app.get(data.extension_id,'extension_package'):null;
  const {receipt,receipt_sha256}=readPinnedReceipt(app.extensionReceiptRoot,data.runtime_receipt);
  const report=validateCommonReport(validateEnvelope(receipt,data,'driver.launchwright-extension.cli-status'),'cli',['observed_build','facts']);
  str(report.observed_build,256);validateValue(report.facts);
  ensure(extension&&report.fixture_sha256===extension.data.digest,'CLI receipt executable source differs from registered adapter digest','Conflict');
  ensure(source.data.build===release.data.build&&report.observed_build===data.observed_build&&data.observed_build===source.data.build,'CLI receipt build binding is stale','StaleReference');
  ensure(data.command==='driver.launchwright-extension.cli-status'&&same(data.args,['status','--json']),'Canonical CLI admission requires the fixed status operation','PermissionDenied');
  let parsedFacts;try{parsedFacts=JSON.parse(report.stdout);}catch{ensure(false,'CLI receipt stdout is not valid JSON','Conflict');}
  ensure(same(parsedFacts,report.facts),'CLI receipt facts differ from stdout bytes','Conflict');
  ensure(report.stdout===data.stdout&&report.stderr===(data.stderr??'')&&report.exit_code===data.exit_code,'CLI receipt process bytes differ from recorded observation','Conflict');
  return{receipt_sha256,provider:receipt.provider,provider_version:receipt.provider_version,provider_generation:receipt.provider_generation,
    descriptor_sha256:receipt.descriptor_sha256,executable_sha256:receipt.executable_sha256,semwright_sha:receipt.semwright_sha,
    broker_policy_path_observed:true,driver_host_isolation_accepted:true,platform_execution_authority:false,external_customer_acceptance:false,
    scope:'owned-deltacli-status-driver-host-only',report};
}
