// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../src/server.mjs';
import { LaunchwrightClient } from '../client/index.mjs';
import { setup } from './helpers.mjs';

async function server(t){
  const {app}=setup(t);
  const service=createAppServer(app,{port:0,token:'synthetic-api-events-token'});
  const baseUrl=await service.listen();
  t.after(()=>service.close());
  return{app,service,client:new LaunchwrightClient({baseUrl,token:service.token})};
}

test('authenticated discovery describes the public contract without claiming external authority',async t=>{
  const {client}=await server(t);
  const d=await client.discovery();
  assert.equal(d.schema_version,'launchwright-http-discovery/1');
  assert.equal(d.native_sdk,'0.9.0-dev.1');
  assert.equal(d.observation.resource,'launchwright:workspace');
  assert.equal(d.observation.snapshot_bound,true);
  assert.equal(d.events.snapshot_watermark,true);
  assert.equal(d.authority.native_host_acceptance,false);
  assert.equal(d.authority.platform_execution,false);
  assert.ok(d.operations.some(op=>op.name==='events.list'&&op.read_only));
  assert.equal(d.routes.events,'/api/v1/events');
  assert.equal(Object.hasOwn(d,'token'),false);
});

test('event pagination is frozen to its first durable watermark',async t=>{
  const {client}=await server(t);
  await client.mutate('entity.create',{kind:'product',data:{name:'Event one'}});
  await client.mutate('entity.create',{kind:'product',data:{name:'Event two'}});

  const first=await client.events({after:0,limit:1});
  assert.equal(first.schema_version,'launchwright-event-page/2');
  assert.equal(first.items.length,1);
  assert.equal(first.watermark,2);
  assert.equal(first.complete,false);
  assert.equal(first.items[0].schema_version,'launchwright-event/2');
  assert.equal(first.items[0].source,'launchwright-application');
  assert.ok(first.items[0].workspace_generation);
  assert.match(first.items[0].cause.request_sha256,/^[a-f0-9]{64}$/);

  await client.mutate('entity.create',{kind:'product',data:{name:'Event three'}});

  const second=await client.events({after:first.next_after,limit:8,watermark:first.watermark});
  assert.equal(second.watermark,2);
  assert.equal(second.complete,true);
  assert.deepEqual(second.items.map(e=>e.seq),[2]);

  const fresh=await client.events({after:first.watermark,limit:8});
  assert.equal(fresh.watermark,3);
  assert.deepEqual(fresh.items.map(e=>e.seq),[3]);
});

test('public eventPages preserves one snapshot while new commits continue',async t=>{
  const {client}=await server(t);
  await client.mutate('entity.create',{kind:'product',data:{name:'Page one'}});
  await client.mutate('entity.create',{kind:'product',data:{name:'Page two'}});
  const pages=client.eventPages({limit:1});
  const first=await pages.next();
  assert.equal(first.done,false);
  const watermark=first.value.watermark;

  await client.mutate('entity.create',{kind:'product',data:{name:'Later commit'}});

  const second=await pages.next();
  assert.equal(second.value.watermark,watermark);
  assert.deepEqual(second.value.items.map(e=>e.seq),[2]);
  assert.equal(second.value.complete,true);
  assert.equal((await pages.next()).done,true);
});

test('duplicate request identity creates one durable event and one domain mutation',async t=>{
  const {client,app}=await server(t);
  const prepared=await client.prepare('entity.create',{kind:'product',data:{name:'Exactly once'}},{key:'api-event-idempotency'});
  const a=await client.sendPrepared(prepared);
  const b=await client.sendPrepared(prepared);
  assert.equal(a.entity.id,b.entity.id);
  assert.equal(app.list('product').length,1);
  const events=await client.events({after:0,limit:128});
  assert.equal(events.items.length,1);
  assert.equal(events.items[0].cause.request_key,'api-event-idempotency');
});

test('invalid event snapshots fail closed and deep links carry only explicit resource IDs',async t=>{
  const {client}=await server(t);
  await client.mutate('entity.create',{kind:'product',data:{name:'Snapshot guard'}});
  await assert.rejects(client.events({after:0,limit:10,watermark:2}),{code:'StaleReference'});
  await assert.rejects(client.events({after:2,limit:10,watermark:1}),{code:'StaleReference'});
  const link=client.deepLink('review','candidate_example');
  assert.ok(link.endsWith('/#review/candidate_example'));
  assert.throws(()=>client.deepLink('../admin'),{code:'InvalidArgument'});
});
