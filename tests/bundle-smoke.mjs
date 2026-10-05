// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { LaunchwrightApplication } from '../src/application.mjs';
const state=mkdtempSync(join(tmpdir(),'launchwright-bundle-'));const app=new LaunchwrightApplication(state,{initialize:true});app.close();
const frame={schema_version:'semwright-native-app-bridge/1',id:'bundle-smoke',method:'observe',operation:null,args:{resource:'launchwright:workspace',scope:'all',limit:1},expected:null,runtime:{data_root:state,output_root:null}};
const bundle=readFileSync('dist/launchwright.cjs','utf8');const stdin=bundle+'\nvoid module.exports.semwrightNativeBridgeMain(JSON.parse('+JSON.stringify(JSON.stringify(frame))+'));\n';
const r=spawnSync(process.execPath,['--input-type=commonjs','-'],{input:stdin,encoding:'utf8'});assert.equal(r.status,0,r.stderr);const reply=JSON.parse(r.stdout);assert.equal(reply.ok,true);assert.equal(reply.data.complete,true);
mkdirSync('evidence/native',{recursive:true});writeFileSync('evidence/native/bundle-smoke.json',JSON.stringify({passed:true,source_sha:process.env.GITHUB_SHA??null,bundle_loaded:true,canonical_bridge_reply:reply.schema_version,driver_host_isolation_accepted:false},null,2)+'\n');rmSync(state,{recursive:true,force:true});
