// SPDX-License-Identifier: AGPL-3.0-only
import { requireCondition as ensure, object } from '@semwright/native-sdk';
import { inputObject, noSecrets, digest } from './contracts.mjs';
import { CANONICAL_GRAPH_ACTIONS, CANONICAL_GRAPH_READ_ACTIONS } from './graph.mjs';

export const PLATFORM_ACTIONS=Object.freeze([
  'recipes.prepare','recipes.execute','jobs.get','jobs.cancel','jobs.reconcile','evidence.get','artifacts.get','graph.observe','graph.observation',
  ...CANONICAL_GRAPH_ACTIONS,
  'publish.preflight','publish.define','publish.version','publish.deploy','publish.invoke','publish.result'
]);
export const PUBLICATION_ACTIONS=Object.freeze(new Set(['publish.define','publish.version','publish.deploy','publish.invoke']));
export const PLATFORM_READ_ACTIONS=Object.freeze(new Set(['jobs.get','evidence.get','artifacts.get','graph.observation',...CANONICAL_GRAPH_READ_ACTIONS,'publish.result']));

function exactArgs(raw,fields){
  object(raw,fields,fields);noSecrets(raw);return raw;
}
function binding(kind,entity,digestValue){
  return{kind,id:entity.id,version:entity.version,digest:digestValue};
}
export function preparePublicationWork(app,action,raw,{allowInvoke=false}={}){
  ensure(typeof action==='string'&&action.startsWith('publish.'),'Not a Platform Publish action');
  if(action==='publish.define'){
    exactArgs(raw,['release_template_id']);const template=app.get(raw.release_template_id,'release_template');ensure(!template.data.import_origin?.reverification_required,'Imported ReleaseTemplate requires local rebind/recheck before publication','PolicyDenied');
    const payload={schema_version:'launchwright-platform-publish/1',release_template_id:template.id,release_template_version:template.version,release_id:template.data.release_id,product_id:template.data.product_id,template_digest:digest('release-template',template.data),contract:template.data};
    noSecrets(payload);return{arguments:payload,publication_binding:binding('release_template',template,payload.template_digest)};
  }
  if(action==='publish.version'){
    exactArgs(raw,['product_version_id']);const version=app.get(raw.product_version_id,'product_version');
    const payload={schema_version:'launchwright-platform-publish/1',product_version_id:version.id,product_version_digest:version.data.product_version_digest,release_template_id:version.data.release_template_id,release_template_version:version.data.release_template_version,release_id:version.data.release_id,product_id:version.data.product_id,version_label:version.data.version_label,contract:version.data.contract,pins:version.data.pins};
    noSecrets(payload);return{arguments:payload,publication_binding:binding('product_version',version,version.data.product_version_digest)};
  }
  if(action==='publish.deploy'){
    exactArgs(raw,['deployment_id']);const deployment=app.get(raw.deployment_id,'publish_deployment');
    ensure(deployment.data.state!=='RETIRED','Retired deployment cannot be published again','Conflict');
    const version=app.get(deployment.data.product_version_id,'product_version');
    const payload={schema_version:'launchwright-platform-publish/1',deployment_id:deployment.id,deployment_digest:deployment.data.deployment_digest,product_version_id:version.id,product_version_digest:version.data.product_version_digest,release_id:deployment.data.release_id,product_id:deployment.data.product_id,audience:version.data.contract.audience,result_retention:deployment.data.result_retention};
    noSecrets(payload);return{arguments:payload,publication_binding:binding('publish_deployment',deployment,deployment.data.deployment_digest)};
  }
  if(action==='publish.invoke'){
    ensure(allowInvoke,'Direct publish.invoke work preparation is forbidden; use the bounded publish.invoke operation','PermissionDenied');
    exactArgs(raw,['invocation_id']);const invocation=app.get(raw.invocation_id,'publish_invocation');
    const payload={schema_version:'launchwright-platform-publish/1',invocation_id:invocation.id,invocation_digest:invocation.data.invocation_digest,deployment_id:invocation.data.deployment_id,product_version_id:invocation.data.product_version_id,release_id:invocation.data.release_id,product_id:invocation.data.product_id,consumer:invocation.data.consumer,parameters:invocation.data.resolved_parameters,requested_outputs:invocation.data.requested_outputs,budget:invocation.data.budget};
    noSecrets(payload);return{arguments:payload,publication_binding:binding('publish_invocation',invocation,invocation.data.invocation_digest)};
  }
  if(action==='publish.preflight'){
    exactArgs(raw,['product_version_id']);const version=app.get(raw.product_version_id,'product_version');
    const payload={schema_version:'launchwright-platform-publish/1',product_version_id:version.id,product_version_digest:version.data.product_version_digest,budget_ceiling:version.data.contract.budget,outputs:version.data.contract.outputs,external_disclosures:version.data.contract.external_disclosures};
    noSecrets(payload);return{arguments:payload,publication_binding:binding('product_version',version,version.data.product_version_digest)};
  }
  if(action==='publish.result'){
    exactArgs(raw,['invocation_id']);const invocation=app.get(raw.invocation_id,'publish_invocation'),works=app.list('work').filter(work=>work.data.publication_binding?.kind==='publish_invocation'&&work.data.publication_binding.id===invocation.id);ensure(works.length===1,'Publish invocation work binding is missing or ambiguous','Conflict');const invokeWork=works[0];
    ensure(invokeWork.data.platform_job_id,'Publish invocation does not yet have a Platform job locator','Conflict');
    const payload={schema_version:'launchwright-platform-publish/1',invocation_id:invocation.id,invocation_digest:invocation.data.invocation_digest,job_id:invokeWork.data.platform_job_id};
    noSecrets(payload);return{arguments:payload,publication_binding:binding('publish_invocation',invocation,invocation.data.invocation_digest)};
  }
  ensure(false,'Unsupported Platform Publish action','Unsupported');
}
export function publicationBindingCurrent(app,work){
  const b=work.data.publication_binding;ensure(b&&typeof b==='object','Publish work is not bound to an application publication entity','PolicyDenied');
  const entity=app.get(b.id,b.kind);ensure(entity.version.generation===b.version.generation&&entity.version.revision===b.version.revision,'Publication entity changed after work preparation','StaleReference');
  const expected=b.kind==='product_version'?entity.data.product_version_digest:b.kind==='publish_deployment'?entity.data.deployment_digest:b.kind==='publish_invocation'?entity.data.invocation_digest:digest('release-template',entity.data);
  ensure(expected===b.digest,'Publication binding digest changed','Conflict');return entity;
}
