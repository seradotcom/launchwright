#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { NATIVE_PROFILES } from '../src/native-profiles.mjs';
import { OPERATION_SCOPES } from '../src/contracts.mjs';

const MAX_BUNDLE=48*1024,MAX_INPUT=64*1024,FRAME_RESERVE=1024;
const esbuildVersion='0.28.2',terserVersion='5.44.0',npm=process.platform==='win32'?'npm.cmd':'npm';
mkdirSync('dist',{recursive:true});

const declared=Object.keys(OPERATION_SCOPES).sort();
const assigned=Object.values(NATIVE_PROFILES).flatMap(profile=>profile.operations);
const unique=new Set(assigned);
if(unique.size!==assigned.length)throw Error('A Native SDK operation is assigned to more than one profile.');
if(JSON.stringify([...unique].sort())!==JSON.stringify(declared)){
  const missing=declared.filter(operation=>!unique.has(operation));
  const extra=[...unique].filter(operation=>!OPERATION_SCOPES[operation]);
  throw Error('Native profile partition differs from public operation surface: missing='+missing.join(',')+' extra='+extra.join(','));
}

const manifest={
  schema_version:'launchwright-native-bundles/2',
  sdk_sha:'4d291de26724810017ce7b6d185326514cb79fa6',
  native_sdk:'0.9.0-dev.1',
  max_bundle_bytes:MAX_BUNDLE,
  max_combined_stdin_bytes:MAX_INPUT,
  host_accepted:false,
  profiles:{}
};

for(const [name,profile] of Object.entries(NATIVE_PROFILES)){
  const intermediate='dist/'+name+'.esbuild.cjs',output='dist/'+profile.file;
  const build=spawnSync(npm,['exec','--yes','--package',`esbuild@${esbuildVersion}`,'--','esbuild',profile.entry,'--bundle','--platform=node','--format=cjs','--target=node24','--minify','--legal-comments=none',`--outfile=${intermediate}`],{stdio:'inherit',shell:false});
  if(build.status!==0)throw Error('Native profile build failed: '+name);
  const compact=spawnSync(npm,['exec','--yes','--package',`terser@${terserVersion}`,'--','terser',intermediate,'--compress','passes=5,toplevel=true','--mangle','toplevel=true','--toplevel','--ecma','2022','--output',output],{stdio:'inherit',shell:false});
  if(compact.status!==0)throw Error('Native profile compaction failed: '+name);
  unlinkSync(intermediate);
  const bytes=readFileSync(output);
  if(bytes.length>MAX_BUNDLE)throw Error(`Canonical NodeBridge MAX_BUNDLE is 48 KiB; profile ${name} built ${bytes.length} bytes.`);
  const sha256=createHash('sha256').update(bytes).digest('hex');
  manifest.profiles[name]={
    entry:profile.entry,file:profile.file,sha256,bytes:bytes.length,
    remaining_frame_bytes:MAX_INPUT-bytes.length-FRAME_RESERVE,
    operations:[...profile.operations]
  };
  console.log(`${name}: ${bytes.length} bytes ${sha256}`);
}
if(existsSync('dist/launchwright.cjs'))unlinkSync('dist/launchwright.cjs');
writeFileSync('dist/native-bundle.json',JSON.stringify(manifest,null,2)+'\n');
console.log('Native profile partition: '+assigned.length+' operations across '+Object.keys(NATIVE_PROFILES).length+' bundles.');
