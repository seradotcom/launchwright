#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const lock=JSON.parse(readFileSync('SOURCE_LOCK.json','utf8'));let count=0;
for(const[path,expected]of Object.entries(lock.native_sdk.files)){
 const bytes=readFileSync(join('vendor/semwright-native-sdk',path));if(createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('Canonical Native SDK bytes changed: '+path);
}
function walk(dir){for(const name of readdirSync(dir)){if(['node_modules','.git','.state','.ci-tools','target','dist','private-reference'].includes(name)||name.startsWith('.state-'))continue;const path=join(dir,name),st=lstatSync(path);if(st.isSymbolicLink())throw Error('Unexpected repository symlink');if(st.isDirectory())walk(path);else if(path.endsWith('.mjs')){const result=spawnSync(process.execPath,['--check',path],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr);count++;}}}
walk('.');
if(!readFileSync('LICENSE','utf8').includes('GNU AFFERO GENERAL PUBLIC LICENSE'))throw Error('Full AGPL license missing');
console.log(JSON.stringify({verified:true,native_sdk_sha:lock.native_sdk.sha,javascript_modules_checked:count,host_acceptance:false}));
