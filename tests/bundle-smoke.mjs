// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { LaunchwrightApplication } from '../src/application.mjs';

const manifest=JSON.parse(readFileSync('dist/native-bundle.json','utf8'));
const bundleBytes=readFileSync('dist/launchwright.cjs');
const payloadBytes=readFileSync('dist/launchwright.payload.cjs');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(manifest.schema_version,'launchwright-native-bundle/2');
assert.equal(manifest.sha256,sha(bundleBytes));
assert.equal(manifest.payload_sha256,sha(payloadBytes));
assert.equal(manifest.bytes,bundleBytes.length);
assert.equal(manifest.payload_bytes,payloadBytes.length);
assert.ok(bundleBytes.length<=48*1024);
assert.ok(manifest.remaining_frame_bytes>32*1024);

const state=mkdtempSync(join(tmpdir(),'launchwright-bundle-'));
const app=new LaunchwrightApplication(state,{initialize:true});app.close();
const frame={schema_version:'semwright-native-app-bridge/1',id:'bundle-smoke',method:'observe',operation:null,args:{resource:'launchwright:workspace',scope:'all',limit:1},expected:null,runtime:{data_root:state,output_root:null}};
const stdin=bundleBytes.toString('utf8')+'\nvoid module.exports.semwrightNativeBridgeMain(JSON.parse('+JSON.stringify(JSON.stringify(frame))+'));\n';
const r=spawnSync(process.execPath,['--input-type=commonjs','-'],{input:stdin,encoding:'utf8'});
assert.equal(r.status,0,r.stderr);
const reply=JSON.parse(r.stdout);assert.equal(reply.ok,true);assert.equal(reply.data.complete,true);
mkdirSync('evidence/native',{recursive:true});
writeFileSync('evidence/native/bundle-smoke.json',JSON.stringify({
  passed:true,
  source_sha:process.env.GITHUB_SHA??null,
  wrapper_sha256:manifest.sha256,
  wrapper_bytes:manifest.bytes,
  payload_sha256:manifest.payload_sha256,
  payload_bytes:manifest.payload_bytes,
  packaging:manifest.packaging,
  remaining_frame_bytes:manifest.remaining_frame_bytes,
  bundle_loaded:true,
  canonical_bridge_reply:reply.schema_version,
  driver_host_isolation_accepted:false,
},null,2)+'\n');
rmSync(state,{recursive:true,force:true});
