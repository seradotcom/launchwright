// SPDX-License-Identifier: AGPL-3.0-only
import { object, sameVersion, requireCondition as ensure } from '@semwright/native-sdk';
import { inputObject, idText, lines, choice, digest, validateEntity, iso, sha } from './contracts.mjs';

const CHANGEABLE=new Set(['copy_block','deliverable']);
const ORIGINS=['human','managed','imported','generator'];

function changedFields(before,after){
  const keys=[...new Set([...Object.keys(before),...Object.keys(after)])].sort();
  return keys.filter(key=>digest('change-field',{value:before[key]??null})!==digest('change-field',{value:after[key]??null}));
}
function proposalApplications(app,id){
  return app.store.all('change_application').filter(item=>item.data.proposal_id===id).sort((a,b)=>a.created.localeCompare(b.created));
}
function requiresHumanAck(resource){
  return resource.kind!=='copy_block'||resource.data.owner==='human';
}
function validateProposalData(app,resource,raw){
  ensure(CHANGEABLE.has(resource.kind),'Change proposals currently support CopyBlocks and deliverables only','Unsupported');
  const data=validateEntity(resource.kind,raw);
  for(const parent of ['product_id','release_id'])if(resource.data[parent]!==undefined)ensure(resource.data[parent]===data[parent],'Change proposal cannot move a resource to another parent','Conflict');
  if(resource.kind==='copy_block')ensure(resource.data.owner===data.owner,'CopyBlock ownership cannot be changed through a proposal','Conflict');
  app.assertReferences(resource.kind,data);
  return data;
}

export function proposeChange(app,input){
  inputObject(input,['resource_id','base_version','proposed_data','reason','origin']);
  idText(input.resource_id);object(input.base_version,['resource','generation','revision'],['resource','generation','revision']);lines(input.reason,8000);choice(input.origin,ORIGINS);
  const resource=app.get(input.resource_id);
  ensure(CHANGEABLE.has(resource.kind),'Change proposals currently support CopyBlocks and deliverables only','Unsupported');
  ensure(sameVersion(resource.version,input.base_version),'Proposal base revision changed; observe again before proposing','StaleReference');
  const proposedData=validateProposalData(app,resource,input.proposed_data);
  const fields=changedFields(resource.data,proposedData);ensure(fields.length>0,'Proposal does not change any fields','InvalidArgument');
  const baseDataSha256=digest('change-base',resource.data),proposedDataSha256=digest('change-data',proposedData);
  const binding={resource_id:resource.id,resource_kind:resource.kind,base_version:resource.version,base_data_sha256:baseDataSha256,proposed_data_sha256:proposedDataSha256,changed_fields:fields,reason:input.reason,origin:input.origin};
  const proposalSha256=digest('change-proposal',binding);
  return{entity:app.store.create('change_proposal',{
    release_id:resource.data.release_id,name:`Change proposal · ${resource.data.name}`,
    ...binding,proposal_sha256:proposalSha256,proposed_data:proposedData,
    requires_human_ack:requiresHumanAck(resource),proposer:app.principal,created_at:iso(),
    authority:'launchwright-application-proposal',automatic_apply:false
  })};
}

export function inspectChange(app,id){
  const proposal=app.get(id,'change_proposal'),applications=proposalApplications(app,proposal.id);
  let resource=null,currentState='MISSING';
  try{
    resource=app.get(proposal.data.resource_id);
    currentState=sameVersion(resource.version,proposal.data.base_version)?'READY_TO_APPLY':'STALE_BASE';
  }catch{}
  if(applications.length)currentState='APPLIED';
  return{
    proposal,state:currentState,current_resource:resource,
    applications,requires_human_ack:proposal.data.requires_human_ack,
    safe_to_apply:currentState==='READY_TO_APPLY',
    canonical_changes_authority:false
  };
}

export function applyChange(app,input){
  inputObject(input,['id','proposal_sha256','acknowledge_human']);
  idText(input.id);sha(input.proposal_sha256);ensure(typeof input.acknowledge_human==='boolean','acknowledge_human must be boolean');
  const proposal=app.get(input.id,'change_proposal');
  ensure(proposal.data.proposal_sha256===input.proposal_sha256,'Change proposal digest differs','Conflict');
  ensure(proposalApplications(app,proposal.id).length===0,'Change proposal was already applied','Conflict');
  const resource=app.get(proposal.data.resource_id);
  ensure(resource.kind===proposal.data.resource_kind,'Change proposal resource kind changed','Conflict');
  ensure(sameVersion(resource.version,proposal.data.base_version),'Proposal base changed; create a new proposal instead of overwriting newer work','StaleReference');
  ensure(digest('change-base',resource.data)===proposal.data.base_data_sha256,'Proposal base content changed','StaleReference');
  const proposedData=validateProposalData(app,resource,proposal.data.proposed_data);
  ensure(digest('change-data',proposedData)===proposal.data.proposed_data_sha256,'Proposal payload integrity check failed','Conflict');
  if(proposal.data.requires_human_ack)ensure(input.acknowledge_human===true,'Human-owned or whole-document content requires explicit apply acknowledgment','ConsentRequired');
  const fromVersion=resource.version;
  const updateData=resource.data.template_origin?{...proposedData,template_origin:resource.data.template_origin}:proposedData;
  const updated=app.store.update(resource.id,updateData);
  const application=app.store.create('change_application',{
    release_id:resource.data.release_id,name:`Applied · ${resource.data.name}`,
    proposal_id:proposal.id,proposal_sha256:proposal.data.proposal_sha256,resource_id:resource.id,
    from_version:fromVersion,to_version:updated.version,changed_fields:proposal.data.changed_fields,
    explicit_human_ack:input.acknowledge_human,applied_by:app.principal,applied_at:iso(),
    authority:'launchwright-application-change',canonical_changes_authority:false
  });
  return{entity:updated,application};
}
