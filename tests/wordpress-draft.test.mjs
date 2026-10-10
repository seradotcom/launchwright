// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, chmodSync, lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { execute } from '../src/application.mjs';
import { setup,baseline } from './helpers.mjs';
import {
  prepareWordPressDraft,verifyWordPressDraft,sendWordPressDraft,
  wordpressHttpTransport,wordpressOrigin,readPrivateWordPressCredentials
} from '../src/wordpress-draft.mjs';
const worktree=fileURLToPath(new URL('../',import.meta.url));
const USER='owned-fixture-operator',PASSWORD='owned-synthetic-wordpress-app-password';
const json=res=>res.setHeader('content-type','application/json; charset=utf-8');
const respond=(res,code,body)=>{res.statusCode=code;json(res);res.end(JSON.stringify(body));};
async function cms(t){
  const rows=new Map(),events=[];
  let nextId=41,loseAck=false,alterReply=null,redirect=false;
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    const auth='Basic '+Buffer.from(USER+':'+PASSWORD).toString('base64');
    events.push({method:req.method,path:url.pathname,search:url.search,has_auth:req.headers.authorization===auth});
    if(req.headers.authorization!==auth){
      respond(res,401,{code:'rest_not_logged_in'});return;
    }
    if(redirect){res.statusCode=302;res.setHeader('location','https://evil.example.invalid/steal');res.end();return;}
    if(req.method==='GET'&&url.pathname==='/wp-json/wp/v2/posts'){
      if(url.searchParams.get('context')!=='edit'||
        url.searchParams.get('status')!=='any'||
        url.searchParams.get('per_page')!=='2'){
        respond(res,400,{code:'bad_query'});return;
      }
      const slug=url.searchParams.get('slug');
      const found=[...rows.values()].filter(row=>row.slug===slug);
      respond(res,200,found.map(row=>structuredClone(alterReply?.(row)??row)));return;
    }
    const m=/^\/wp-json\/wp\/v2\/posts\/(\d+)$/u.exec(url.pathname);
    if(req.method==='GET'&&m){
      if(url.searchParams.get('context')!=='edit'){
        respond(res,400,{code:'raw_not_available'});return;
      }
      const row=rows.get(Number(m[1]));
      respond(res,row?200:404,row?(alterReply?.(row)??row):{code:'rest_post_invalid_id'});
      return;
    }
    if(req.method==='POST'&&url.pathname==='/wp-json/wp/v2/posts'){
      let input='';
      for await(const part of req){input+=part.toString('utf8');if(input.length>40000){respond(res,413,{code:'too_big'});return;}}
      const data=JSON.parse(input);
      if(data.status!=='draft'||data.comment_status!=='closed'||data.ping_status!=='closed'){
        respond(res,403,{code:'refuse_not_draft'});return;
      }
      if([...rows.values()].some(row=>row.slug===data.slug)){
        respond(res,409,{code:'duplicate_slug'});return;
      }
      const row={id:nextId++,type:'post',slug:data.slug,status:'draft',
        title:{raw:data.title},content:{raw:data.content},
        comment_status:data.comment_status,ping_status:data.ping_status,
        link:'http://127.0.0.1/owned-fixture-post'};
      rows.set(row.id,row);
      if(loseAck){loseAck=false;req.socket.destroy();return;}
      respond(res,201,row);return;
    }
    respond(res,404,{code:'unsupported_path'});
  });
  await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',err=>err?reject(err):resolve()));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return {
    origin:'http://127.0.0.1:'+server.address().port,
    rows,events,loseNextAck(){loseAck=true;},
    changePost(fn){for(const row of rows.values())fn(row);},
    alterReads(fn){alterReply=fn;},
    redirectOn(){redirect=true;},
    server
  };
}
async function fixture(t,{approve=true,rights='owned'}={}){
  const remote=await cms(t),{app,root}=setup(t),b=await baseline(app);
  const profile=await b.create('channel_profile',{
    product_id:b.product.id,name:'Operator-owned WordPress drafts',
    channel:'wordpress-post-draft',profile_version:'wp/v2/r47',
    destination_class:'external-draft',
    requirements:{format:'markdown'},
    source:'wordpress-draft:'+remote.origin,
    effective_at:'2026-10-09T00:00:00.000Z',idempotency:'recover-first'
  });
  const artifact=(await execute(app,'deliverable.render',{id:b.deliverable.id})).entity;
  const candidate=(await execute(app,'candidate.freeze',{
    release_id:b.release.id,name:'Frozen WordPress editorial notes',
    artifact_ids:[artifact.id],destination:'private-wordpress-draft',
    channel_profile_ids:[profile.id],
    contract:{version:'r47',required_reviewers:1,require_claims_verified:false}
  })).entity;
  if(approve)await execute(app,'candidate.review',{
    id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,
    decision:'approve-editorial',comment:'Synthetic editorial fixture'
  });
  const delivery=(await execute(app,'channel.package',{
    candidate_id:candidate.id,profile_id:profile.id,
    participant:'owner',locale:'en-US',allow_partial:false,omissions:[]
  })).entity;
  const input={delivery_id:delivery.id,origin:remote.origin,
    title:'Owned WordPress Release Draft',notes_artifact_id:artifact.id,
    acknowledge_draft_only:true,acknowledge_unverified:true,
    acknowledge_site_control:true,acknowledge_source_rights:true};
  const confirmation=intent=>({
    confirm_origin:intent.origin,confirm_candidate_sha256:intent.candidate_sha256,
    confirm_intent_sha256:intent.intent_sha256,
    acknowledge_first_send:true
  });
  const transport=()=>wordpressHttpTransport(remote.origin,{
    username:USER,application_password:PASSWORD
  });
  return{app,root,b,remote,profile,artifact,candidate,delivery,input,confirmation,transport};
}
function assertError(result,code){assert.equal(result?.code,code);}

test('R47 deterministic local plan pins real Native candidate, channel profile and immutable Markdown without contacting WordPress',async t=>{
  const f=await fixture(t);
  const before=f.remote.events.length;
  const first=prepareWordPressDraft(f.app,f.input);
  const second=prepareWordPressDraft(f.app,f.input);
  assert.deepEqual(first,second);
  assert.equal(verifyWordPressDraft(f.app,first).intent.intent_sha256,first.intent_sha256);
  assert.equal(first.candidate_sha256,f.candidate.data.candidate_sha256);
  assert.equal(first.profile_id,f.profile.id);
  assert.equal(first.origin,f.remote.origin);
  assert.equal(first.status,'draft');
  assert.equal(first.platform_authority,false);
  assert.equal(first.external_publication,false);
  assert.match(first.slug,/^launchwright-[0-9a-f]{24}$/u);
  assert.equal(f.remote.events.length,before,'Planning must not open a CMS network connection');
  assert.equal(f.app.list('channel_delivery').length,1);
  assert.ok(!JSON.stringify(first).includes(PASSWORD));
});
test('R47 actual authenticated REST HTTP round-trip creates WordPress DRAFT only, validates exact remote bytes and records native receipt',async t=>{
  const f=await fixture(t),intent=prepareWordPressDraft(f.app,f.input);
  const result=await sendWordPressDraft(f.app,intent,f.transport(),f.confirmation(intent));
  assert.equal(result.proof.post_status,'draft');
  assert.equal(result.proof.published,false);
  assert.equal(result.proof.platform_authority,false);
  assert.equal(result.external_send_performed,true);
  assert.equal(result.recovered,false);
  assert.equal(f.remote.rows.size,1);
  const row=[...f.remote.rows.values()][0];
  assert.equal(row.status,'draft');
  assert.equal(row.slug,intent.slug);
  assert.equal(row.title.raw,intent.title);
  assert.ok(row.content.raw.includes('Owned synthetic editorial copy.'));
  assert.ok(row.content.raw.includes(intent.notes_sha256));
  assert.equal(row.comment_status,'closed');
  assert.equal(row.ping_status,'closed');
  assert.equal(f.remote.events.filter(e=>e.method==='POST').length,1);
  const native=result.record;
  assert.equal(native.data.external_state,'DRAFT_CREATED');
  assert.equal(native.data.external_id,'wordpress:'+intent.origin+':post/'+row.id);
  assert.equal(native.data.root_delivery_id,f.delivery.id);
  assert.equal(native.data.receipt_digest.length,64);
});
test('R47 repeated send reuses exact WordPress draft and Native channel receipt without a second POST',async t=>{
  const f=await fixture(t),intent=prepareWordPressDraft(f.app,f.input);
  const once=await sendWordPressDraft(f.app,intent,f.transport(),f.confirmation(intent));
  const again=await sendWordPressDraft(f.app,intent,f.transport(),f.confirmation(intent));
  assert.equal(once.proof.post_id,again.proof.post_id);
  assert.equal(again.recovered,true);
  assert.equal(again.external_send_performed,false);
  assert.equal(again.record.id,once.record.id);
  assert.equal(f.remote.events.filter(e=>e.method==='POST').length,1);
  assert.equal(f.app.list('channel_delivery').length,2);
});
test('R47 ambiguous remote POST response never causes automatic re-send; recover-only finds exact historical slug',async t=>{
  const f=await fixture(t),intent=prepareWordPressDraft(f.app,f.input);
  f.remote.loseNextAck();
  await assert.rejects(sendWordPressDraft(f.app,intent,f.transport(),f.confirmation(intent)),
    {code:'Unavailable',outcomeKnown:false});
  assert.equal(f.remote.rows.size,1);
  assert.equal(f.app.list('channel_delivery').length,1,'No local success before independent readback');
  const recovered=await sendWordPressDraft(f.app,intent,f.transport(),{
    ...f.confirmation(intent),acknowledge_first_send:false,recover_only:true
  });
  assert.equal(recovered.proof.post_id,41);
  assert.equal(recovered.external_send_performed,false);
  assert.equal(f.remote.events.filter(e=>e.method==='POST').length,1);
});
test('R47 absent draft in recover-only and missing operator consent do not POST or record fabricated success',async t=>{
  const f=await fixture(t),intent=prepareWordPressDraft(f.app,f.input);
  await assert.rejects(sendWordPressDraft(f.app,intent,f.transport(),{
    ...f.confirmation(intent),recover_only:true
  }),{code:'NotFound'});
  await assert.rejects(sendWordPressDraft(f.app,intent,f.transport(),{
    ...f.confirmation(intent),acknowledge_first_send:false
  }),{code:'ConsentRequired'});
  await assert.rejects(sendWordPressDraft(f.app,intent,f.transport(),{
    ...f.confirmation(intent),confirm_origin:'https://evil.example.invalid'
  }),{code:'ConsentRequired'});
  assert.equal(f.remote.events.filter(e=>e.method==='POST').length,0);
  assert.equal(f.app.list('channel_delivery').length,1);
});
test('R47 published/edited title, body, slug, status, comments or forged raw content fail closed with zero mutations',async t=>{
  const f=await fixture(t),intent=prepareWordPressDraft(f.app,f.input);
  await sendWordPressDraft(f.app,intent,f.transport(),f.confirmation(intent));
  const original=structuredClone([...f.remote.rows.values()][0]);
  for(const bad of [
    row=>{row.status='publish';},row=>{row.content.raw+=' attacker changed';},
    row=>{row.title.raw='different title';},row=>{row.comment_status='open';},
    row=>{row.slug='wrong-slug';}
  ]){
    f.remote.alterReads(row=>{const copy=structuredClone(row);bad(copy);return copy;});
    await assert.rejects(sendWordPressDraft(f.app,intent,f.transport(),{
      ...f.confirmation(intent),recover_only:true
    }));
    assert.equal(f.remote.events.filter(e=>e.method==='POST').length,1);
  }
  f.remote.alterReads(null);
  f.remote.changePost(row=>Object.assign(row,original));
  assert.equal(f.remote.rows.size,1);
});
test('R47 source drift/tampered digest and unauthorized destination profile reject before network',async t=>{
  const f=await fixture(t),intent=prepareWordPressDraft(f.app,f.input);
  const before=f.remote.events.length;
  await assert.rejects(sendWordPressDraft(f.app,{
    ...intent,notes_sha256:'f'.repeat(64)
  },f.transport(),f.confirmation(intent)),{code:'Conflict'});
  assert.equal(f.remote.events.length,before);
  await execute(f.app,'entity.update',{
    id:f.b.deliverable.id,expected:f.b.deliverable.version,
    data:{...f.b.deliverable.data,content:'Human edited source'}
  });
  await assert.rejects(sendWordPressDraft(f.app,intent,f.transport(),f.confirmation(intent)));
  assert.equal(f.remote.events.length,before);
  const f2=await fixture(t);
  assert.throws(()=>prepareWordPressDraft(f2.app,{
    ...f2.input,origin:'https://unapproved.example.invalid'
  }),{code:'PermissionDenied'});
});
test('R47 secure WordPress origin restrictions reject URL credentials, redirects and remote HTTP origins',async t=>{
  const f=await fixture(t);
  for(const origin of [
    'http://example.com','https://example.com/blog','https://user:password@example.com',
    'https://example.com?token=secret','https://example.com/#foo',
    'http://0.0.0.0:5555','https://localhost:8443','ftp://example.com'
  ])assert.throws(()=>wordpressOrigin(origin),'Unsafe URL was admitted: '+origin);
  assert.equal(wordpressOrigin(f.remote.origin),f.remote.origin);
  const intent=prepareWordPressDraft(f.app,f.input);
  f.remote.redirectOn();
  await assert.rejects(sendWordPressDraft(f.app,intent,f.transport(),f.confirmation(intent)),
    {code:'Unavailable'});
  assert.equal(f.remote.events.filter(e=>e.method==='POST').length,0);
});
test('R47 private 0600 application password file is required, no credentials leaked to local plan',async t=>{
  const f=await fixture(t),cred=join(f.root,'private-wp-creds.json');
  writeFileSync(cred,JSON.stringify({username:USER,application_password:PASSWORD}),
    {flag:'wx',mode:0o600});
  const loaded=readPrivateWordPressCredentials(cred);
  assert.equal(loaded.username,USER);
  assert.equal(loaded.application_password,PASSWORD);
  const intent=prepareWordPressDraft(f.app,f.input);
  assert.ok(!JSON.stringify(intent).includes(USER));
  assert.ok(!JSON.stringify(intent).includes(PASSWORD));
  if(process.platform!=='win32'){
    chmodSync(cred,0o644);
    assert.throws(()=>readPrivateWordPressCredentials(cred),{code:'PermissionDenied'});
  }
});
async function runCli(args){
  return new Promise((resolve,reject)=>{
    const cp=spawn(process.execPath,['scripts/wordpress-draft.mjs',...args],{
      cwd:worktree,env:{...process.env},stdio:['ignore','pipe','pipe']
    });
    let stdout='',stderr='';
    cp.stdout.on('data',v=>stdout+=v.toString('utf8'));
    cp.stderr.on('data',v=>stderr+=v.toString('utf8'));
    cp.once('error',reject);
    cp.once('close',status=>resolve({status,stdout,stderr}));
  });
}
test('R47 actual CLI two-phase private plan and owner-only credential file against a live local WordPress REST server',async t=>{
  const f=await fixture(t),planFile=join(f.root,'private-wp-plan.json'),
    credsFile=join(f.root,'private-wp-credentials.json');
  writeFileSync(credsFile,JSON.stringify({username:USER,application_password:PASSWORD}),
    {flag:'wx',mode:0o600});
  const planned=await runCli(['plan','--state',f.root,'--delivery',f.delivery.id,
    '--origin',f.remote.origin,'--title',f.input.title,
    '--notes-artifact',f.artifact.id,'--out',planFile,
    '--acknowledge-draft','--acknowledge-unverified',
    '--acknowledge-site-control','--acknowledge-source-rights']);
  assert.equal(planned.status,0,planned.stdout+planned.stderr);
  const intent=JSON.parse((await import('node:fs')).readFileSync(planFile,'utf8'));
  assert.equal(intent.intent_sha256,prepareWordPressDraft(f.app,f.input).intent_sha256);
  assert.equal(f.remote.events.length,0);
  const first=await runCli(['send','--state',f.root,'--intent',planFile,
    '--credentials',credsFile,'--confirm-origin',intent.origin,
    '--confirm-candidate',intent.candidate_sha256,
    '--confirm-intent',intent.intent_sha256,'--acknowledge-send']);
  assert.equal(first.status,0,first.stdout+first.stderr);
  const response=JSON.parse(first.stdout);
  assert.equal(response.proof.post_status,'draft');
  const recovered=await runCli(['recover','--state',f.root,'--intent',planFile,
    '--credentials',credsFile,'--confirm-origin',intent.origin,
    '--confirm-candidate',intent.candidate_sha256,
    '--confirm-intent',intent.intent_sha256]);
  assert.equal(recovered.status,0,recovered.stdout+recovered.stderr);
  assert.equal(JSON.parse(recovered.stdout).recovered,true);
  assert.equal(f.remote.events.filter(v=>v.method==='POST').length,1);
});

test('R47 frozen HTML-like Markdown is escaped as inert WordPress DRAFT text, without executable markup',async t=>{
  const f=await fixture(t);
  const raw='<script>alert(1)</script> & <img src=x onerror=alert(2)>';
  const earlier=f.app.get(f.b.deliverable.id,'deliverable');
  const changed=(await execute(f.app,'entity.update',{
    id:earlier.id,expected:earlier.version,
    data:{...earlier.data,content:raw}
  })).entity;
  const artifact=(await execute(f.app,'deliverable.render',{id:changed.id})).entity;
  const candidate=(await execute(f.app,'candidate.freeze',{
    release_id:f.b.release.id,name:'Owned HTML escape fixture',
    artifact_ids:[artifact.id],destination:'private-wordpress-draft',
    channel_profile_ids:[f.profile.id],
    contract:{version:'r47',required_reviewers:1,require_claims_verified:false}
  })).entity;
  await execute(f.app,'candidate.review',{
    id:candidate.id,candidate_sha256:candidate.data.candidate_sha256,
    decision:'approve-editorial',comment:'Owned frozen sanitization fixture'
  });
  const delivery=(await execute(f.app,'channel.package',{
    candidate_id:candidate.id,profile_id:f.profile.id,
    participant:'owner',locale:'en-US',allow_partial:false,omissions:[]
  })).entity;
  const input={...f.input,delivery_id:delivery.id,notes_artifact_id:artifact.id};
  const intent=prepareWordPressDraft(f.app,input);
  await sendWordPressDraft(f.app,intent,f.transport(),f.confirmation(intent));
  const content=[...f.remote.rows.values()][0].content.raw;
  assert.ok(content.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(content.includes('&amp; &lt;img src=x onerror=alert(2)&gt;'));
  assert.ok(!content.includes('<script>')&&!content.includes('<img '));
  assert.equal(f.remote.events.filter(e=>e.method==='POST').length,1);
});

test('R47 oversize WordPress REST body and wrong Application Password reject before treating a post as confirmed',async t=>{
  const f=await fixture(t),intent=prepareWordPressDraft(f.app,f.input);
  const invalid=wordpressHttpTransport(f.remote.origin,{
    username:USER,application_password:'incorrect-secret-credential'
  });
  await assert.rejects(sendWordPressDraft(f.app,intent,invalid,f.confirmation(intent)),
    {code:'Unavailable'});
  assert.equal(f.remote.events.filter(x=>x.method==='POST').length,0);
  f.remote.rows.set(77,{
    id:77,type:'post',slug:intent.slug,status:'draft',
    title:{raw:intent.title},
    content:{raw:'Z'.repeat(70000)},
    comment_status:'closed',ping_status:'closed'
  });
  await assert.rejects(sendWordPressDraft(f.app,intent,f.transport(),f.confirmation(intent)),
    {code:'ResourceExhausted'});
  assert.equal(f.remote.events.filter(x=>x.method==='POST').length,0);
  assert.equal(f.app.list('channel_delivery').length,1);
});

test('R47 separate operator site authorization and source rights consents are indispensable',async t=>{
  const f=await fixture(t);
  assert.throws(()=>prepareWordPressDraft(f.app,{
    ...f.input,acknowledge_site_control:false
  }),{code:'ConsentRequired'});
  assert.throws(()=>prepareWordPressDraft(f.app,{
    ...f.input,acknowledge_source_rights:false
  }),{code:'ConsentRequired'});
  assert.equal(f.remote.events.length,0);
});
