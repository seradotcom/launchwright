// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { integer, object, requireCondition as ensure, validateValue } from '@semwright/native-sdk';
import { array, choice, idText, sha, str } from './contracts.mjs';
import { digest } from './base.mjs';

export const PINNED_SEMWRIGHT_SHA='8fa191250ae68274182570c65f067f7a60f85625';
export const VERIFIER_PROVIDER='driver:launchwright-verifier';
export const VERIFIER_ID='launchwright-verifier';
export const VERIFIER_RECEIPT_SCHEMA='launchwright-canonical-verifier-runtime/1';
export const VERIFIER_RESULT_SCHEMA='launchwright-verifier-result/1';

const deepDigest=(domain,value)=>digest(domain,value);
const same=(a,b)=>deepDigest('verifier-compare',a)===deepDigest('verifier-compare',b);

export const candidateManifestDigest=candidate=>digest('candidate-manifest',candidate.data.manifest);

function readPinnedReceipt(root,reference){
  ensure(typeof root==='string'&&root.length>0,'Canonical verifier receipt grant is unavailable','PolicyDenied');
  object(reference,['file','sha256'],['file','sha256']);
  str(reference.file,160);sha(reference.sha256);
  ensure(/^[a-z0-9][a-z0-9._-]{0,127}\.json$/u.test(reference.file),'Verifier receipt filename is not a single bounded JSON file');
  const grant=realpathSync(root),path=join(grant,reference.file),meta=lstatSync(path);
  ensure(meta.isFile()&&!meta.isSymbolicLink(),'Verifier receipt must be a regular non-symlink file','PermissionDenied');
  ensure(meta.size>0&&meta.size<=256*1024,'Verifier receipt exceeds its byte budget','ResourceExhausted');
  const canonical=realpathSync(path);
  ensure(canonical.startsWith(grant.endsWith(sep)?grant:grant+sep),'Verifier receipt escapes its owner grant','PermissionDenied');
  const bytes=readFileSync(canonical);
  const observed=createHash('sha256').update(bytes).digest('hex');
  ensure(observed===reference.sha256,'Verifier receipt digest differs from its pinned bytes','Conflict');
  let receipt;
  try{receipt=JSON.parse(bytes.toString('utf8'));}catch{ensure(false,'Verifier receipt is not valid JSON','InvalidArgument');}
  validateValue(receipt);
  return{receipt,receipt_sha256:observed};
}

function validateReport(report,candidate,data){
  object(report,
    ['schema_version','state','candidate_id','candidate_sha256','candidate_manifest_sha256','dimension','coverage','artifact_bindings','findings'],
    ['schema_version','state','candidate_id','candidate_sha256','candidate_manifest_sha256','dimension','coverage','artifact_bindings','findings']);
  ensure(report.schema_version===VERIFIER_RESULT_SCHEMA,'Verifier result schema is not admitted','Conflict');
  choice(report.state,['PASS','FAIL']);
  idText(report.candidate_id);sha(report.candidate_sha256);sha(report.candidate_manifest_sha256);
  ensure(report.dimension==='format','Canonical Launchwright verifier is admitted only for format','PolicyDenied');
  ensure(report.candidate_id===candidate.id,'Verifier receipt belongs to another candidate','PermissionDenied');
  ensure(report.candidate_sha256===candidate.data.candidate_sha256,'Verifier receipt candidate digest is stale','StaleReference');
  ensure(report.candidate_manifest_sha256===candidateManifestDigest(candidate),'Verifier receipt manifest digest is stale','StaleReference');
  ensure(data.dimension===report.dimension&&data.state===report.state,'Verification record differs from the Host verifier result','Conflict');
  ensure(data.target_id===undefined,'Candidate-wide format verifier cannot be narrowed to one target','InvalidArgument');

  object(report.coverage,['checked','total'],['checked','total']);
  integer(report.coverage.checked,0,1000000);integer(report.coverage.total,0,1000000);
  ensure(report.coverage.checked===report.coverage.total&&report.coverage.total>0,'Canonical format verification requires exhaustive artifact coverage','PolicyDenied');
  ensure(same(data.coverage,report.coverage),'Recorded verification coverage differs from Host output','Conflict');
  ensure(Array.isArray(data.omissions)&&data.omissions.length===0,'Canonical format verification cannot omit candidate artifacts','PolicyDenied');
  ensure(same(data.findings,report.findings),'Recorded verification findings differ from Host output','Conflict');

  const manifestArtifacts=candidate.data.manifest?.artifacts;
  ensure(candidate.data.manifest?.schema_version==='launchwright-candidate/2'&&Array.isArray(manifestArtifacts),'Canonical verification requires a v2 frozen candidate','PolicyDenied');
  const expected=[...manifestArtifacts].sort((a,b)=>a.id.localeCompare(b.id));
  const requested=[...data.artifact_ids].sort();
  ensure(requested.length===expected.length&&requested.every((id,index)=>id===expected[index].id),'Canonical verification must cover every frozen candidate artifact','PolicyDenied');

  const bindings=array(report.artifact_bindings,128);
  ensure(bindings.length===expected.length,'Verifier receipt artifact cardinality differs from the candidate','Conflict');
  const seen=new Set();
  for(const binding of bindings){
    object(binding,['id','sha256','bytes','mime','result'],['id','sha256','bytes','mime','result']);
    idText(binding.id);sha(binding.sha256);integer(binding.bytes,0,16*1024*1024);str(binding.mime,128);choice(binding.result,['PASS','FAIL']);
    ensure(!seen.has(binding.id),'Verifier receipt contains duplicate artifact bindings','Conflict');seen.add(binding.id);
    const frozen=expected.find(artifact=>artifact.id===binding.id);
    ensure(!!frozen,'Verifier receipt contains an artifact outside the candidate','PermissionDenied');
    ensure(binding.sha256===frozen.sha256&&binding.bytes===frozen.bytes&&binding.mime===frozen.mime,'Verifier receipt artifact binding differs from frozen candidate bytes','Conflict');
    if(report.state==='PASS')ensure(binding.result==='PASS','PASS verifier receipt contains a failing artifact','Conflict');
  }
  array(report.findings,128).forEach(finding=>{
    object(finding,['code','severity','message','resource_id'],['code','severity','message','resource_id']);
    str(finding.code,96);choice(finding.severity,['info','warning','error','blocker']);str(finding.message,4000);idText(finding.resource_id);
    ensure(seen.has(finding.resource_id),'Verifier finding references an artifact outside the candidate','PermissionDenied');
  });
  if(report.state==='PASS')ensure(report.findings.every(f=>!['error','blocker'].includes(f.severity)),'PASS verifier receipt contains blocking findings','Conflict');
  return report;
}

export function admitCanonicalVerifierRuntime(app,candidate,data){
  ensure(data.verifier.authority==='canonical','Canonical runtime admission requires canonical verifier authority','InvalidArgument');
  const {receipt,receipt_sha256}=readPinnedReceipt(app.verificationReceiptRoot,data.runtime_receipt);
  object(receipt,
    ['schema_version','observed_at','semwright_sha','provider','provider_version','provider_generation','descriptor_sha256','executable_sha256','broker_policy_path_observed','driver_host_isolation_accepted','platform_execution_authority','external_customer_acceptance','report'],
    ['schema_version','observed_at','semwright_sha','provider','provider_version','provider_generation','descriptor_sha256','executable_sha256','broker_policy_path_observed','driver_host_isolation_accepted','platform_execution_authority','external_customer_acceptance','report']);
  ensure(receipt.schema_version===VERIFIER_RECEIPT_SCHEMA,'Verifier runtime receipt schema is not admitted','Conflict');
  str(receipt.observed_at,64);ensure(Number.isFinite(Date.parse(receipt.observed_at)),'Verifier receipt observed_at is invalid');
  ensure(receipt.observed_at===data.observed_at,'Verification observed_at differs from its Host receipt','Conflict');
  ensure(receipt.semwright_sha===PINNED_SEMWRIGHT_SHA,'Verifier receipt comes from another Semwright source revision','Conflict');
  ensure(receipt.provider===VERIFIER_PROVIDER,'Verifier receipt provider is not admitted','PermissionDenied');
  str(receipt.provider_version,96);integer(receipt.provider_generation,0,Number.MAX_SAFE_INTEGER);
  sha(receipt.descriptor_sha256);sha(receipt.executable_sha256);
  ensure(receipt.broker_policy_path_observed===true&&receipt.driver_host_isolation_accepted===true,'Verifier receipt did not establish Broker/Driver Host execution','PolicyDenied');
  ensure(receipt.platform_execution_authority===false&&receipt.external_customer_acceptance===false,'Verifier receipt may not manufacture external authority','Conflict');
  ensure(data.verifier.id===VERIFIER_ID&&data.verifier.version===receipt.provider_version&&data.verifier.digest===receipt.executable_sha256,'Verifier identity differs from the admitted Host executable','Conflict');
  const report=validateReport(receipt.report,candidate,data);
  return{receipt_sha256,provider:receipt.provider,provider_version:receipt.provider_version,provider_generation:receipt.provider_generation,descriptor_sha256:receipt.descriptor_sha256,executable_sha256:receipt.executable_sha256,semwright_sha:receipt.semwright_sha,broker_policy_path_observed:true,driver_host_isolation_accepted:true,platform_execution_authority:false,external_customer_acceptance:false,scope:'owner-granted-driver-host-format-only',report};
}
