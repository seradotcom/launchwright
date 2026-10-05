// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, renameSync, rmSync, rmdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { requireCondition as ensure, validateValue } from '@semwright/native-sdk';
import { APP_VERSION, KINDS, idText, iso, sha, str } from './contracts.mjs';
import { Store } from './store.mjs';
import { createStoredZip, readStoredZip } from './zip.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function exportWorkspace(app) {
  const store=app.store,meta=store.meta();
  const entities=store.db.prepare('SELECT * FROM entities ORDER BY id').all().map(r=>({
    id:r.id,kind:r.kind,generation:r.generation,revision:r.revision,data:JSON.parse(r.data),created:r.created,updated:r.updated,
  }));
  const aliases=store.db.prepare('SELECT * FROM aliases ORDER BY name').all();
  const events=store.db.prepare('SELECT * FROM events ORDER BY seq').all().map(r=>({...r,payload:JSON.parse(r.payload)}));
  const history=store.hasHistory?store.db.prepare('SELECT * FROM entity_history ORDER BY id,CAST(revision AS INTEGER)').all().map(r=>({id:r.id,kind:r.kind,generation:r.generation,revision:r.revision,data:JSON.parse(r.data),created:r.created,updated:r.updated})):[];
  const blobRows=store.db.prepare('SELECT sha256,mime,content FROM blobs ORDER BY sha256').all();
  const blobs=blobRows.map(r=>({sha256:r.sha256,mime:r.mime,size_bytes:r.content.length}));
  const manifest={
    schema_version:'launchwright-portable/1',app_version:APP_VERSION,exported_at:iso(),
    source_workspace_version:store.version(),source_schema_version:meta.schema_version,
    entities,aliases,events,blobs,history,
    history_policy:{installed:store.hasHistory,pre_migration_history:'NOT_RECONSTRUCTED'},
    omissions:{session_token:'excluded',receipts:'excluded-to-prevent-replay',pending_dispatch:'excluded-to-prevent-resend',external_credentials:'never-exported'},
  };
  validateValue(manifest);
  const entries=[{name:'manifest.json',bytes:Buffer.from(JSON.stringify(manifest,null,2)+'\n')}];
  for(const row of blobRows) entries.push({name:`blobs/${row.sha256}.bin`,bytes:Buffer.from(row.content)});
  const bytes=createStoredZip(entries);
  ensure(bytes.length<=16*1024*1024,'Portable workspace exceeds local export budget','ResourceExhausted');
  return {bytes,manifest,sha256:hash(bytes)};
}
export function inspectWorkspaceExport(input) {
  const entries=readStoredZip(input,{maxBytes:16*1024*1024});
  ensure(entries.has('manifest.json'),'Portable manifest missing');
  let manifest;try{manifest=JSON.parse(entries.get('manifest.json').toString('utf8'));}catch{ensure(false,'Portable manifest is invalid JSON');}
  validateValue(manifest);
  ensure(manifest?.schema_version==='launchwright-portable/1','Unsupported portable schema','ProtocolMismatch');
  ensure(manifest.source_schema_version===1,'Unsupported workspace schema','ProtocolMismatch');
  ensure(Array.isArray(manifest.entities)&&Array.isArray(manifest.aliases)&&Array.isArray(manifest.events)&&Array.isArray(manifest.blobs),'Portable manifest collections missing');
  if(manifest.history!==undefined)ensure(Array.isArray(manifest.history),'Portable history must be a list');
  const ids=new Set();
  for(const e of manifest.entities){
    idText(e.id);str(e.kind,64);ensure(KINDS.includes(e.kind),'Unknown entity kind in portable bundle','ProtocolMismatch');
    str(e.generation,128);str(e.revision,64);ensure(/^\d+$/.test(e.revision),'Portable entity revision invalid');validateValue(e.data);str(e.created,64);str(e.updated,64);
    ensure(!ids.has(e.id),'Duplicate portable entity');ids.add(e.id);
  }
  const historyKeys=new Set();
  for(const h of manifest.history??[]){
    idText(h.id);str(h.kind,64);ensure(KINDS.includes(h.kind),'Unknown history kind in portable bundle','ProtocolMismatch');str(h.generation,128);str(h.revision,64);ensure(/^\d+$/.test(h.revision),'Portable history revision invalid');validateValue(h.data);str(h.created,64);str(h.updated,64);const key=`${h.id}\u0000${h.generation}\u0000${h.revision}`;ensure(!historyKeys.has(key),'Duplicate portable history revision');historyKeys.add(key);
  }
  if(manifest.history!==undefined)for(const e of manifest.entities){const key=`${e.id}\u0000${e.generation}\u0000${e.revision}`;ensure(historyKeys.has(key),'Current entity revision missing from portable history','Conflict');}
  const blobSet=new Set();
  for(const b of manifest.blobs){
    sha(b.sha256);str(b.mime,200);ensure(Number.isInteger(b.size_bytes)&&b.size_bytes>=0&&b.size_bytes<=1024*1024,'Portable blob size invalid');
    ensure(!blobSet.has(b.sha256),'Duplicate portable blob');blobSet.add(b.sha256);
    const bytes=entries.get(`blobs/${b.sha256}.bin`);ensure(bytes,'Portable blob bytes missing','Conflict');
    ensure(bytes.length===b.size_bytes&&hash(bytes)===b.sha256,'Portable blob integrity failed','Conflict');
  }
  for(const name of entries.keys()) ensure(name==='manifest.json'||/^blobs\/[a-f0-9]{64}\.bin$/.test(name),'Unexpected portable ZIP entry');
  ensure(entries.size===1+manifest.blobs.length,'Portable ZIP contains undeclared blob entries');
  return {manifest,entries,sha256:hash(Buffer.isBuffer(input)?input:Buffer.from(input))};
}
export function restoreWorkspace(input,targetRoot,{commit=false}={}) {
  const inspected=inspectWorkspaceExport(input),m=inspected.manifest,target=resolve(targetRoot);
  const report={
    schema_version:'launchwright-restore-preview/1',source_workspace_version:m.source_workspace_version,
    entities:m.entities.length,history_revisions:(m.history??[]).length,blobs:m.blobs.length,aliases:m.aliases.length,events:m.events.length,
    history_policy:m.history_policy??{installed:false,pre_migration_history:'NOT_RECONSTRUCTED'},receipts_restored:0,pending_dispatch_restored:0,will_create_new_workspace_generation:true,commit:false,
  };
  if(!commit)return report;
  if(existsSync(target)){
    ensure(!lstatSync(target).isSymbolicLink(),'Restore target cannot be a symlink');
    ensure(readdirSync(target).length===0,'Restore target must be absent or empty','Conflict');
  }
  const temp=join(dirname(target),`.${basename(target)}.restore-${randomUUID()}`);
  let store;
  try{
    store=new Store(temp,{initialize:true});
    store.db.exec('BEGIN IMMEDIATE');
    for(const e of m.entities)store.db.prepare('INSERT INTO entities VALUES(?,?,?,?,?,?,?)').run(e.id,e.kind,e.generation,e.revision,JSON.stringify(e.data),e.created,e.updated);
    store.db.prepare('DELETE FROM entity_history').run();
    const historyRows=m.history??m.entities;
    for(const h of historyRows)store.db.prepare('INSERT INTO entity_history VALUES(?,?,?,?,?,?,?)').run(h.id,h.generation,h.revision,h.kind,JSON.stringify(h.data),h.created,h.updated);
    for(const b of m.blobs){const bytes=inspected.entries.get(`blobs/${b.sha256}.bin`);store.db.prepare('INSERT INTO blobs VALUES(?,?,?)').run(b.sha256,b.mime,bytes);}
    for(const a of m.aliases){
      str(a.name,160);str(a.generation,128);str(a.revision,64);idText(a.candidate_id);ensure(idsHas(m.entities,a.candidate_id),'Portable alias candidate missing','Conflict');
      store.db.prepare('INSERT INTO aliases VALUES(?,?,?,?)').run(a.name,a.generation,a.revision,a.candidate_id);
    }
    for(const e of m.events){
      ensure(Number.isInteger(e.seq)&&e.seq>0,'Portable event sequence invalid');str(e.id,128);str(e.operation,128);str(e.principal,128);if(e.resource)str(e.resource,128);str(e.revision,64);str(e.occurred,64);validateValue(e.payload);
      store.db.prepare('INSERT INTO events(seq,id,operation,principal,resource,revision,occurred,payload) VALUES(?,?,?,?,?,?,?,?)').run(e.seq,e.id,e.operation,e.principal,e.resource??null,e.revision,e.occurred,JSON.stringify(e.payload));
    }
    const nextRevision=(BigInt(m.source_workspace_version.revision)+1n).toString();
    store.db.prepare('UPDATE meta SET revision=?,epoch=0 WHERE singleton=1').run(nextRevision);
    const restoredVersion=store.version();
    store.db.prepare('INSERT INTO events(id,operation,principal,resource,revision,occurred,payload) VALUES(?,?,?,?,?,?,?)').run(
      randomUUID(),'workspace.restore','local-admin',null,nextRevision,iso(),JSON.stringify({source_workspace_version:m.source_workspace_version,portable_sha256:inspected.sha256,receipts_restored:false,pending_dispatch_restored:false})
    );
    store.db.exec('COMMIT');store.close();store=null;
    if(existsSync(target))rmdirSync(target);
    renameSync(temp,target);
    return {...report,commit:true,restored_workspace_version:restoredVersion,portable_sha256:inspected.sha256};
  }catch(err){
    if(store){try{store.db.exec('ROLLBACK');}catch{}try{store.close();}catch{}}
    rmSync(temp,{recursive:true,force:true});
    throw err;
  }
}
function idsHas(entities,id){return entities.some(e=>e.id===id);}
