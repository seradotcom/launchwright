// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { githubCliTransport } from '../src/github-release-draft.mjs';

const tag='v9.8.7';
const repo='seradotcom/owned-fixture';
const sha='a'.repeat(40);
const hash=b=>createHash('sha256').update(b).digest('hex');

test('R31 gh CLI adapter verifies annotated tag, creates DRAFT only, and re-downloads exact asset',async()=>{
  const calls=[];
  let remote=null;
  let data=null;
  const executor=(args,options={})=>{
    calls.push(args.map(String));
    if(args[0]==='api' && args[1]==='repos/'+repo+'/git/ref/tags/'+tag)
      return JSON.stringify({ref:'refs/tags/'+tag,object:{type:'tag',sha:'b'.repeat(40)}});
    if(args[0]==='api' && args[1]==='repos/'+repo+'/git/tags/'+'b'.repeat(40))
      return JSON.stringify({object:{type:'commit',sha}});
    if(args[0]==='api' && args[1]==='repos/'+repo+'/releases/tags/'+tag)
      return remote?JSON.stringify(remote):null;
    if(args[0]==='release'&&args[1]==='create'){
      const f=args[args.indexOf('--notes-file')+1];
      const notes=readFileSync(f,'utf8');
      assert.ok(notes.includes('Pinned fixture release'));
      assert.ok(args.includes('--verify-tag'));
      assert.ok(args.includes('--draft'));
      assert.ok(!args.includes('--generate-notes'));
      assert.ok(!args.includes('--target'));
      assert.ok(!args.includes('--clobber'));
      remote={id:555,draft:true,tag_name:tag,body:notes,assets:[]};
      return '';
    }
    if(args[0]==='release'&&args[1]==='upload'){
      assert.equal(args[args.indexOf('--repo')+1],repo);
      assert.ok(!args.includes('--clobber'));
      data=readFileSync(args[3]);
      remote.assets=[{name:'launchwright-fixture.zip',size:data.length,digest:'sha256:'+hash(data)}];
      return '';
    }
    if(args[0]==='release'&&args[1]==='download'){
      assert.equal(args[args.indexOf('--repo')+1],repo);
      const dest=args[args.indexOf('--dir')+1];
      assert.equal(args[args.indexOf('--pattern')+1],'launchwright-fixture.zip');
      writeFileSync(join(dest,'launchwright-fixture.zip'),data);
      return '';
    }
    throw Error('Unexpected gh invocation: '+JSON.stringify(args));
  };
  const client=githubCliTransport(executor);
  assert.equal(await client.getTagCommit(repo,tag),sha);
  assert.equal(await client.getRelease(repo,tag),null);
  await client.createDraft(repo,tag,'Fixture title','Pinned fixture release');
  const asset=Buffer.from('deterministic fixture zip bytes');
  await client.uploadAsset(repo,tag,'launchwright-fixture.zip',asset);
  const fetched=await client.downloadAsset(repo,tag,'launchwright-fixture.zip');
  assert.equal(hash(fetched),hash(asset));
  assert.equal((await client.getRelease(repo,tag)).draft,true);
  assert.deepEqual(calls.filter(args=>args[0]==='release').map(args=>args[1]),
    ['create','upload','download']);
});

test('R31 CLI documents explicit two-phase dry plan/send/read-only recovery',()=>{
  const cli=spawnSync(process.execPath,['src/main.mjs','help'],{
    encoding:'utf8',cwd:fileURLToPath(new URL('../',import.meta.url))
  });
  assert.equal(cli.status,0,cli.stderr);
  for(const op of ['github-draft-plan','github-draft-send','github-draft-recover','--confirm-repo','--confirm-tag','--confirm-candidate'])
    assert.ok(cli.stdout.includes(op),op);
});

test('R31 the GitHub transport cannot use arbitrary tag objects as commits',async()=>{
  const client=githubCliTransport((args)=>JSON.stringify({
    ref:'refs/tags/'+tag,object:{type:'blob',sha:'a'.repeat(40)}
  }));
  await assert.rejects(client.getTagCommit(repo,tag),{code:'Conflict'});
});

test('R31 repeated annotated tags are bounded before untrusted API calls',async()=>{
  let n=0;
  const client=githubCliTransport((args)=>{
    n++;
    if(args[1].includes('/git/ref/'))return JSON.stringify({ref:'refs/tags/'+tag,object:{type:'tag',sha:'b'.repeat(40)}});
    return JSON.stringify({object:{type:'tag',sha:'b'.repeat(40)}});
  });
  await assert.rejects(client.getTagCommit(repo,tag),{code:'Conflict'});
  assert.equal(n,5);
});
