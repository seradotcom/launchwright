// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectStorageCapacity, inspectDoctor } from '../src/doctor.mjs';
import { setup } from './helpers.mjs';

const repoRoot=resolve(fileURLToPath(new URL('../',import.meta.url)));
const gib=262144n; // 262144 filesystem blocks at 4 KiB = 1 GiB
const capacity=(blocks)=>({bsize:4096n,bavail:blocks});

test('R36 zero free temporary space is BLOCKED without deleting files or confusing workspace capacity',t=>{
  const {root,app}=setup(t);
  const before=app.store.version();
  const report=inspectDoctor(root,repoRoot,{
    nodeVersion:'24.21.0',env:{},temporaryDirectory:repoRoot,
    capacityReader:path=>path===repoRoot?capacity(0n):capacity(gib)
  });
  assert.equal(report.state,'BLOCKED');
  assert.equal(report.storage.temporary.state,'EXHAUSTED');
  assert.equal(report.storage.temporary.available_mib,0);
  assert.equal(report.storage.workspace.state,'OK');
  assert.ok(report.issues.some(x=>x.code==='TEMP_SPACE_EXHAUSTED'));
  assert.ok(!report.issues.some(x=>x.code==='STATE_SPACE_EXHAUSTED'));
  assert.ok(report.recommendations.some(x=>x.includes('TMPDIR')));
  assert.equal(report.mutations_performed,0);
  assert.equal(report.storage.no_cleanups_performed,true);
  assert.deepEqual(app.store.version(),before);
});

test('R36 workspace exhaustion and temporary-space exhaustion are separate root causes',t=>{
  const {root}=setup(t);
  const check=inspectDoctor(root,repoRoot,{
    nodeVersion:'24.21.0',env:{},temporaryDirectory:repoRoot,
    capacityReader:path=>path===repoRoot?capacity(gib):capacity(0n)
  });
  assert.equal(check.state,'BLOCKED');
  assert.equal(check.storage.workspace.available_mib,0);
  assert.equal(check.storage.temporary.state,'OK');
  assert.ok(check.issues.some(x=>x.code==='STATE_SPACE_EXHAUSTED'));
  assert.ok(check.recommendations.some(x=>x.includes('back up existing state')));
});

test('R36 low and unknown space generate diagnostics rather than assumed ACCEPTED runtime',t=>{
  const {root}=setup(t);
  const low=inspectDoctor(root,repoRoot,{
    nodeVersion:'24.21.0',env:{},temporaryDirectory:repoRoot,
    capacityReader:()=>capacity(16384n) // 64 MiB
  });
  assert.equal(low.state,'ATTENTION');
  assert.equal(low.storage.workspace.state,'LOW');
  assert.equal(low.storage.temporary.state,'LOW');
  assert.ok(low.issues.some(x=>x.code==='TEMP_SPACE_LOW'));
  const unknown=inspectDoctor(root,repoRoot,{
    nodeVersion:'24.21.0',env:{},temporaryDirectory:repoRoot,
    capacityReader:()=>{throw Error('Unsupported statfs platform');}
  });
  assert.equal(unknown.storage.workspace.state,'UNKNOWN');
  assert.equal(unknown.state,'ATTENTION');
  assert.ok(unknown.issues.some(x=>x.code==='STATE_CAPACITY_UNKNOWN'));
  assert.equal(unknown.mutations_performed,0);
});

test('R36 probe returns bounded portable MiB and never creates a missing state directory',()=>{
  const missing=join(repoRoot,'__r36_doctor_storage_missing__');
  assert.equal(existsSync(missing),false);
  const before=readdirSync(repoRoot).length;
  const report=inspectStorageCapacity(missing,{
    temporaryDirectory:repoRoot,capacityReader:()=>({
      bsize:4096n,bavail:BigInt(Number.MAX_SAFE_INTEGER)*1024n
    })
  });
  assert.equal(report.temporary.available_mib,Number.MAX_SAFE_INTEGER);
  assert.equal(report.workspace.available_mib,Number.MAX_SAFE_INTEGER);
  assert.equal(report.mutations_performed,0);
  assert.equal(existsSync(missing),false);
  assert.equal(readdirSync(repoRoot).length,before);
});

test('R36 negative and inconsistent filesystem reports never produce a false OK',t=>{
  const {root}=setup(t);
  for(const report of [
    {bsize:0n,bavail:1n},
    {bsize:4096n,bavail:-1n},
    {bsize:'unexpected',bavail:1n}
  ]){
    const x=inspectStorageCapacity(root,{
      temporaryDirectory:repoRoot,capacityReader:()=>report
    });
    assert.equal(x.temporary.state,'UNKNOWN');
    assert.equal(x.workspace.state,'UNKNOWN');
    assert.equal(x.no_cleanups_performed,true);
  }
});
