// SPDX-License-Identifier: AGPL-3.0-only
import { integer, requireCondition as ensure } from '@semwright/native-sdk';
import { inputObject, idText, str } from './contracts.mjs';

function historyContext(app,input){
  idText(input.id);ensure(app.store.hasHistory,'Workspace history is not installed; run migrate-history first','ProtocolMismatch');
  const current=app.get(input.id),generation=input.generation??current.version.generation;
  if(input.generation!==undefined)str(input.generation,128);
  return{current,generation};
}

export function getHistory(app,input){
  inputObject(input,['id','revision','generation'],['id','revision']);
  str(input.revision,64);ensure(/^\d+$/.test(input.revision),'Invalid revision');
  const{generation}=historyContext(app,input);
  const row=app.store.db.prepare('SELECT * FROM entity_history WHERE id=? AND generation=? AND revision=?').get(input.id,generation,input.revision);
  ensure(row,'Historical revision not found','NotFound');
  return{entity:app.store.decode(row),archived_at:row.archived,pre_migration_history:'NOT_INFERRED'};
}

export function listHistory(app,input){
  inputObject(input,['id','generation','after_revision','limit'],['id']);
  const{current,generation}=historyContext(app,input),after=input.after_revision??'0';
  str(after,64);ensure(/^\d+$/.test(after),'Invalid historical cursor');
  const limit=integer(input.limit??32,1,64);
  const rows=app.store.db.prepare('SELECT * FROM entity_history WHERE id=? AND generation=? AND CAST(revision AS INTEGER)>CAST(? AS INTEGER) ORDER BY CAST(revision AS INTEGER) LIMIT ?').all(input.id,generation,after,limit+1);
  const more=rows.length>limit,items=rows.slice(0,limit).map(row=>({entity:app.store.decode(row),archived_at:row.archived}));
  return{id:input.id,generation,current_version:current.version,items,next_after:more?items.at(-1).entity.version.revision:null,complete:!more,pre_migration_history:'NOT_INFERRED'};
}

export function diffHistory(app,input){
  inputObject(input,['id','generation','from_revision','to_revision'],['id','from_revision','to_revision']);
  for(const key of ['from_revision','to_revision']){str(input[key],64);ensure(/^\d+$/.test(input[key]),'Invalid revision');}
  const{generation}=historyContext(app,input);
  const get=revision=>{
    const row=app.store.db.prepare('SELECT * FROM entity_history WHERE id=? AND generation=? AND revision=?').get(input.id,generation,revision);
    ensure(row,'Historical revision not found','NotFound');return app.store.decode(row);
  };
  const before=get(input.from_revision),after=get(input.to_revision);
  const keys=[...new Set([...Object.keys(before.data),...Object.keys(after.data)])].sort();
  const changed_fields=keys.filter(key=>JSON.stringify(before.data[key])!==JSON.stringify(after.data[key]));
  return{id:input.id,generation,from:before.version,to:after.version,kind_before:before.kind,kind_after:after.kind,changed_fields,before:before.data,after:after.data};
}
