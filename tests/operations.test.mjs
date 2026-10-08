// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectDoctor } from '../src/doctor.mjs';
import { baseline } from './helpers.mjs';
import { setup } from './helpers.mjs';

const repoRoot=dirname(dirname(fileURLToPath(import.meta.url)));

test('RS-OPS-07 doctor diagnoses an initialized workspace without mutating domain state',async t=>{
  const{app,root}=setup(t);await baseline(app);
  const before={version:app.store.version(),entities:app.store.db.prepare('SELECT count(*) AS n FROM entities').get().n,
    history:app.store.db.prepare('SELECT count(*) AS n FROM entity_history').get().n,
    events:app.store.db.prepare('SELECT count(*) AS n FROM events').get().n,
    receipts:app.store.db.prepare('SELECT count(*) AS n FROM receipts').get().n};
  const report=inspectDoctor(root,repoRoot,{nodeVersion:'24.21.0',env:{}});
  const after={version:app.store.version(),entities:app.store.db.prepare('SELECT count(*) AS n FROM entities').get().n,
    history:app.store.db.prepare('SELECT count(*) AS n FROM entity_history').get().n,
    events:app.store.db.prepare('SELECT count(*) AS n FROM events').get().n,
    receipts:app.store.db.prepare('SELECT count(*) AS n FROM receipts').get().n};
  assert.deepEqual(after,before);
  assert.equal(report.mutations_performed,0);
  assert.equal(report.canonical_sdk_engine_supported,true);
  assert.equal(report.source_lock.integrity,'MATCH');
  assert.ok(report.source_lock.files_checked>0);
  assert.equal(report.workspace.entities,before.entities);
  assert.equal(report.workspace.events,before.events);
  assert.equal(report.workspace.history_rows,before.history);
});

test('RS-OPS-07 doctor does not initialize or repair an empty state path',t=>{
  const parent=mkdtempSync(join(tmpdir(),'launchwright-doctor-empty-')),root=join(parent,'not-created');
  t.after(()=>rmSync(parent,{recursive:true,force:true}));
  assert.equal(existsSync(root),false);
  const report=inspectDoctor(root,repoRoot,{nodeVersion:'24.21.0',env:{}});
  assert.equal(existsSync(root),false);
  assert.equal(report.state_initialized,false);
  assert.equal(report.mutations_performed,0);
  assert.ok(report.recommendations.some(v=>v.includes('init')));
});

test('RS-OPS-07 doctor reports unsafe local permissions but does not repair them',async t=>{
  const{app,root}=setup(t);await baseline(app);
  if(process.platform==='win32')return;
  const db=join(root,'launchwright.sqlite3');chmodSync(db,0o644);
  const report=inspectDoctor(root,repoRoot,{nodeVersion:'24.21.0',env:{}});
  assert.ok(report.issues.some(issue=>issue.code==='DATABASE_MODE'));
  assert.equal(statSync(db).mode&0o777,0o644);
  assert.equal(report.mutations_performed,0);
});

test('doctor reports unsupported local engines as diagnostic rather than acceptance',()=>{
  const root=mkdtempSync(join(tmpdir(),'launchwright-doctor-engine-'));
  try{
    const report=inspectDoctor(root,repoRoot,{nodeVersion:'22.22.0',env:{},
      capacityReader:()=>({bsize:4096n,bavail:1048576n})});
    assert.equal(report.canonical_sdk_engine_supported,false);
    assert.equal(report.state,'ATTENTION');
    assert.ok(report.issues.some(issue=>issue.code==='NODE_UNSUPPORTED'));
    assert.deepEqual(readdirSync(root),[]);
  }finally{rmSync(root,{recursive:true,force:true});}
});
