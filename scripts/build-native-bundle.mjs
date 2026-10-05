#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

mkdirSync('dist',{recursive:true});
const version='0.28.2';
const npm=process.platform==='win32'?'npm.cmd':'npm';
const args=['exec','--yes','--package',`esbuild@${version}`,'--','esbuild','src/native-entry.mjs','--bundle','--platform=node','--format=cjs','--target=node24','--minify','--legal-comments=none','--outfile=dist/launchwright.cjs'];
const result=spawnSync(npm,args,{stdio:'inherit',shell:false});
if(result.status!==0)throw Error('Native bundle build failed. Run this dependency/build step in the heavy GitHub Actions lane.');
const bytes=readFileSync('dist/launchwright.cjs');
if(bytes.length>48*1024)throw Error(`Canonical NodeBridge MAX_BUNDLE is 48 KiB; built ${bytes.length} bytes. Do not raise upstream bounds silently.`);
const sha=createHash('sha256').update(bytes).digest('hex');
writeFileSync('dist/native-bundle.json',JSON.stringify({schema_version:'launchwright-native-bundle/1',sha256:sha,bytes:bytes.length,sdk_sha:'4d291de26724810017ce7b6d185326514cb79fa6',max_combined_stdin_bytes:65536,remaining_frame_bytes:65536-bytes.length-1024,host_accepted:false},null,2)+'\n');
console.log(`LAUNCHWRIGHT_NATIVE_BUNDLE_SHA256=${sha}`);
