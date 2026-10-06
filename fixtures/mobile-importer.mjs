#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
let input;
try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{console.error('invalid-json');process.exit(2);}
const exact=(o,allowed)=>Object.keys(o).every(k=>allowed.includes(k))&&allowed.every(k=>Object.hasOwn(o,k));
if(!input||typeof input!=='object'||!exact(input,['schema_version','platform','app_id','build','source_owner','rights','files'])){console.error('invalid-fields');process.exit(2);}
if(input.schema_version!=='launchwright-mobile-bundle/1'||!['android','ios'].includes(input.platform)||!['owned','licensed'].includes(input.rights)){console.error('invalid-contract');process.exit(2);}
if(typeof input.app_id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/.test(input.app_id)||typeof input.build!=='string'||input.build.length>128||typeof input.source_owner!=='string'||input.source_owner.length<1||input.source_owner.length>160){console.error('invalid-identity');process.exit(2);}
if(!Array.isArray(input.files)||input.files.length<1||input.files.length>16){console.error('invalid-files');process.exit(2);}
let total=0;const files=[];
for(const f of input.files){
  if(!f||typeof f!=='object'||!exact(f,['path','mime','content_base64'])){console.error('invalid-file-fields');process.exit(2);}
  if(typeof f.path!=='string'||f.path.length>160||f.path.startsWith('/')||f.path.includes('\\')||f.path.split('/').some(x=>x===''||x==='.'||x==='..')){console.error('unsafe-path');process.exit(2);}
  if(!['image/png','application/json','text/plain'].includes(f.mime)){console.error('unsupported-mime');process.exit(2);}
  if(typeof f.content_base64!=='string'||f.content_base64.length>90000||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(f.content_base64)){console.error('invalid-base64');process.exit(2);}
  const bytes=Buffer.from(f.content_base64,'base64');total+=bytes.length;if(total>65536){console.error('bundle-too-large');process.exit(2);}
  files.push({path:f.path,mime:f.mime,size_bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
process.stdout.write(JSON.stringify({
  schema_version:'launchwright-mobile-import-observation/1',profile:'mobile-import',platform:input.platform,app_id:input.app_id,
  build:input.build,source_owner:input.source_owner,rights:input.rights,total_bytes:total,files,
  capture_authority:'IMPORTED_UNVERIFIED',device_execution_observed:false
})+'\n');
