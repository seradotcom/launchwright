#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';
import { spawnSync } from 'node:child_process';

mkdirSync('dist',{recursive:true});
const esbuildVersion='0.28.2',terserVersion='5.44.0';
const npm=process.platform==='win32'?'npm.cmd':'npm';
const intermediate='dist/launchwright.esbuild.cjs',payloadPath='dist/launchwright.payload.cjs',output='dist/launchwright.cjs';
const args=['exec','--yes','--package',`esbuild@${esbuildVersion}`,'--','esbuild','src/native-entry.mjs','--bundle','--platform=node','--format=cjs','--target=node24','--minify','--legal-comments=none',`--outfile=${intermediate}`];
const result=spawnSync(npm,args,{stdio:'inherit',shell:false});
if(result.status!==0)throw Error('Native bundle build failed. Run this dependency/build step in the heavy GitHub Actions lane.');
const compact=spawnSync(npm,['exec','--yes','--package',`terser@${terserVersion}`,'--','terser',intermediate,'--compress','passes=5,toplevel=true','--mangle','toplevel=true','--toplevel','--ecma','2022','--output',payloadPath],{stdio:'inherit',shell:false});
if(compact.status!==0)throw Error('Native bundle compaction failed.');
unlinkSync(intermediate);

const payload=readFileSync(payloadPath);
const payloadSha=createHash('sha256').update(payload).digest('hex');
const packed=brotliCompressSync(payload,{params:{
  [zlibConstants.BROTLI_PARAM_QUALITY]:11,
  [zlibConstants.BROTLI_PARAM_MODE]:zlibConstants.BROTLI_MODE_TEXT,
}});
const wrapper=`// Launchwright deterministic native payload wrapper.
const _z=require("node:zlib"),_c=require("node:crypto"),_b=_z.brotliDecompressSync(Buffer.from("${packed.toString('base64')}","base64"));if(_c.createHash("sha256").update(_b).digest("hex")!=="${payloadSha}")throw Error("Native payload digest mismatch");Function("require","module","exports","__filename","__dirname",_b.toString("utf8"))(require,module,exports,__filename,__dirname);
`;
writeFileSync(output,wrapper);
const bytes=readFileSync(output);
if(bytes.length>48*1024)throw Error(`Canonical NodeBridge MAX_BUNDLE is 48 KiB; built ${bytes.length} bytes. Do not raise upstream bounds silently.`);
const sha=createHash('sha256').update(bytes).digest('hex');
writeFileSync('dist/native-bundle.json',JSON.stringify({
  schema_version:'launchwright-native-bundle/2',
  sha256:sha,
  bytes:bytes.length,
  payload_sha256:payloadSha,
  payload_bytes:payload.length,
  packed_bytes:packed.length,
  packaging:'brotli-q11-owner-pinned-wrapper',
  sdk_sha:'4d291de26724810017ce7b6d185326514cb79fa6',
  max_bundle_bytes:48*1024,
  max_combined_stdin_bytes:65536,
  remaining_frame_bytes:65536-bytes.length-1024,
  host_accepted:false,
},null,2)+'\n');
console.log(`LAUNCHWRIGHT_NATIVE_BUNDLE_SHA256=${sha}`);
console.log(`LAUNCHWRIGHT_NATIVE_PAYLOAD_SHA256=${payloadSha}`);
console.log(`LAUNCHWRIGHT_NATIVE_BUNDLE_BYTES=${bytes.length}`);
