// SPDX-License-Identifier: AGPL-3.0-only
import { integer, requireCondition as ensure } from '@semwright/native-sdk';
import { inputObject } from './contracts.mjs';

const MAX_EVENT_SEQUENCE=Number.MAX_SAFE_INTEGER;

function decodeEvent(row,generation){
  const payload=JSON.parse(row.payload);
  return{
    schema_version:'launchwright-event/2',
    id:row.id,
    seq:row.seq,
    source:'launchwright-application',
    workspace_generation:generation,
    operation:row.operation,
    principal:row.principal,
    resource:row.resource,
    revision:row.revision,
    occurred:row.occurred,
    occurred_at:row.occurred,
    cause:{
      request_key:payload.request_key??null,
      request_sha256:payload.request_sha256??null
    },
    payload
  };
}

export function listEvents(app,input={}){
  inputObject(input,['after','limit','watermark'],[]);
  const after=integer(input.after??0,0,MAX_EVENT_SEQUENCE);
  const limit=integer(input.limit??50,1,128);
  const current=app.store.db.prepare('SELECT coalesce(max(seq),0) AS n FROM events').get().n;
  const watermark=input.watermark===undefined?current:integer(input.watermark,0,MAX_EVENT_SEQUENCE);
  ensure(watermark<=current,'Event watermark is ahead of the durable journal; restart from a fresh discovery point','StaleReference');
  ensure(after<=watermark,'Event cursor is beyond its snapshot watermark; restart from a fresh event page','StaleReference');
  const rows=app.store.db.prepare('SELECT * FROM events WHERE seq>? AND seq<=? ORDER BY seq LIMIT ?').all(after,watermark,limit+1);
  const more=rows.length>limit;
  const generation=app.store.meta().generation;
  const items=rows.slice(0,limit).map(row=>decodeEvent(row,generation));
  return{
    schema_version:'launchwright-event-page/2',
    items,
    next_after:more?items.at(-1).seq:null,
    watermark,
    complete:!more,
    snapshot:{workspace_generation:generation,event_watermark:watermark}
  };
}
