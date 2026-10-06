#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
let input;
try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{console.error('invalid-json');process.exit(2);}
const keys=Object.keys(input).sort();
if(JSON.stringify(keys)!==JSON.stringify(['body','schema_version','title'])){console.error('invalid-fields');process.exit(2);}
if(input.schema_version!=='deltarender-request/1'||typeof input.title!=='string'||typeof input.body!=='string'){console.error('invalid-contract');process.exit(2);}
if(input.title.length<1||input.title.length>120||input.body.length>4000||/[<>]/.test(input.title+input.body)){console.error('unsafe-content');process.exit(2);}
const text='# '+input.title.trim()+'\n\n'+input.body.trim()+'\n';
process.stdout.write(JSON.stringify({
  schema_version:'deltarender-output/1',format:'markdown',text,
  fidelity:{structure:'exact',interactive_content:false},rights:'owned',renderer:'deltarender-fixture/1'
})+'\n');
