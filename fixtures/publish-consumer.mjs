#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import { LaunchwrightClient } from '../client/index.mjs';

const required=name=>{const value=process.env[name];if(!value)throw new Error(`missing-${name.toLowerCase()}`);return value;};
const client=new LaunchwrightClient({baseUrl:required('LAUNCHWRIGHT_URL'),token:required('LAUNCHWRIGHT_CONSUMER_TOKEN')});
const deploymentId=required('LAUNCHWRIGHT_DEPLOYMENT_ID');
const ownerResourceId=required('LAUNCHWRIGHT_OWNER_RESOURCE_ID');
const invocationKey=process.env.LAUNCHWRIGHT_INVOCATION_KEY??'external-consumer-attempt';

const deployment=await client.publishInspect({deployment_id:deploymentId});
let ownerReadDenied=false;
try{await client.get(ownerResourceId);}catch(err){ownerReadDenied=err?.code==='PermissionDenied';if(!ownerReadDenied)throw err;}
const input={
  deployment_id:deploymentId,invocation_key:invocationKey,
  parameters:{brand:'External consumer',flow:'primary',locale:'en-US'},
  budget:{max_cost_microunits:1000,currency:'USD',max_runtime_seconds:60},requested_outputs:['artifact']
};
const first=await client.mutate('publish.invoke_prepare',input);
const second=await client.mutate('publish.invoke_prepare',input);
const inspected=await client.publishInspect({invocation_id:first.entity.id});
process.stdout.write(JSON.stringify({
  deployment_id:deployment.deployment.id,owner_resources_exposed:deployment.owner_resources_exposed,
  owner_read_denied:ownerReadDenied,consumer:first.entity.data.consumer,invocation_id:first.entity.id,
  invocation_digest:inspected.invocation.invocation_digest,deduplicated_second:second.deduplicated,
  same_invocation:second.entity.id===first.entity.id,same_work:second.work.id===first.work.id
})+'\n');
