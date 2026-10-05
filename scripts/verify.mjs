#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { NATIVE_PROFILES } from '../src/native-profiles.mjs';
import { APP_VERSION } from '../src/base.mjs';
const lock=JSON.parse(readFileSync('SOURCE_LOCK.json','utf8'));let count=0;
for(const[path,expected]of Object.entries(lock.native_sdk.files)){
 const bytes=readFileSync(join('vendor/semwright-native-sdk',path));if(createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('Canonical Native SDK bytes changed: '+path);
}
function walk(dir){for(const name of readdirSync(dir)){if(['node_modules','.git','.state','.ci-tools','target','dist','private-reference'].includes(name)||name.startsWith('.state-'))continue;const path=join(dir,name),st=lstatSync(path);if(st.isSymbolicLink())throw Error('Unexpected repository symlink');if(st.isDirectory())walk(path);else if(path.endsWith('.mjs')){const result=spawnSync(process.execPath,['--check',path],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr);count++;}}}
walk('.');
const rootPackage=JSON.parse(readFileSync('package.json','utf8'));
const publicClient=JSON.parse(readFileSync('client/package.json','utf8'));
if(rootPackage.version!==APP_VERSION||publicClient.name!=='@launchwright/client'||publicClient.version!==APP_VERSION)throw Error('Application/public client package metadata is inconsistent');
const publicClientSource=readFileSync('client/index.mjs','utf8');
if(/(?:from|import\()\s*['\"]\.\.\//.test(publicClientSource))throw Error('Public client imports private repository modules');
if(!readFileSync('LICENSE','utf8').includes('GNU AFFERO GENERAL PUBLIC LICENSE'))throw Error('Full AGPL license missing');
const expected=new Map();
for(const [profile,meta] of Object.entries(NATIVE_PROFILES))for(const operation of meta.operations)expected.set(operation.replaceAll('.','-'),profile);
const rust=readFileSync('crates/launchwright-native/src/main.rs','utf8'),observed=new Map();
for(const match of rust.matchAll(/Operation\s*\{\s*suffix:\s*"([^"]+)"[\s\S]*?profile:\s*Profile::(\w+),\s*\}/g))observed.set(match[1],match[2].toLowerCase());
const missing=[...expected].filter(([suffix])=>!observed.has(suffix)).map(([suffix])=>suffix);
const extra=[...observed].filter(([suffix])=>!expected.has(suffix)).map(([suffix])=>suffix);
const misplaced=[...expected].filter(([suffix,profile])=>observed.has(suffix)&&observed.get(suffix)!==profile).map(([suffix,profile])=>({suffix,expected:profile,observed:observed.get(suffix)}));
if(missing.length||extra.length||misplaced.length)throw Error('Rust NativeDriver surface differs from JS profiles: '+JSON.stringify({missing,extra,misplaced}));
console.log(JSON.stringify({verified:true,native_sdk_sha:lock.native_sdk.sha,javascript_modules_checked:count,native_driver_operations_checked:expected.size,host_acceptance:false}));
