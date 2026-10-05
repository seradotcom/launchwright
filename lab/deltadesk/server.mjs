// SPDX-License-Identifier: AGPL-3.0-only
import http from 'node:http';
import { readFileSync } from 'node:fs';

export const LAB_MANIFEST=Object.freeze(JSON.parse(readFileSync(new URL('./manifest.json',import.meta.url),'utf8')));
export const BUILD_IDS=Object.freeze({
  a:LAB_MANIFEST.builds.a.id,
  b:LAB_MANIFEST.builds.b.id
});

const tickets=Object.freeze([
  {id:'REQ-104',title:'Add export columns',owner:'Mina Park',status:'Open',priority:'High'},
  {id:'REQ-108',title:'Clarify billing copy',owner:'Diego Luna',status:'In review',priority:'Normal'},
  {id:'REQ-113',title:'Fix CSV encoding',owner:'Alex Chen',status:'Open',priority:'Normal'}
]);

function esc(value){
  return String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function localeText(locale,en,es){return locale==='es-MX'?es:en;}
function context(url){
  const role=['operator','viewer'].includes(url.searchParams.get('role'))?url.searchParams.get('role'):'viewer';
  const plan=['basic','pro'].includes(url.searchParams.get('plan'))?url.searchParams.get('plan'):'basic';
  const locale=['en-US','es-MX'].includes(url.searchParams.get('locale'))?url.searchParams.get('locale'):'en-US';
  return{role,plan,locale};
}
function query(ctx){return new URLSearchParams(ctx).toString();}
function page(build,title,ctx,body){
  const id=BUILD_IDS[build],label=build.toUpperCase(),q=query(ctx);
  return `<!doctype html>
<html lang="${ctx.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="deltadesk-build" content="${esc(id)}">
<title>${esc(title)} · DeltaDesk</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172033;background:#f4f7fb}
*{box-sizing:border-box}body{margin:0}.shell{max-width:1080px;margin:auto;padding:28px}.top{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:28px}.brand{font-weight:800;letter-spacing:-.03em;font-size:20px}.badge{font-size:12px;background:#e8eef9;border-radius:999px;padding:7px 10px}.nav{display:flex;gap:10px;flex-wrap:wrap}.nav a{color:#29425f;text-decoration:none;padding:8px 11px;border-radius:8px;background:#fff;border:1px solid #dce5f0}.card{background:#fff;border:1px solid #dce5f0;border-radius:16px;padding:22px;box-shadow:0 8px 24px rgba(38,54,74,.05)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}.ticket{padding:16px;border:1px solid #e3e9f2;border-radius:12px}.muted{color:#637083}.feature{display:inline-block;margin:10px 0;padding:8px 10px;border-radius:8px;background:#f0f4fb}.danger{background:#fff4f3;color:#93261f}.ok{background:#eef8f0;color:#245a31}.stack{display:grid;gap:14px;max-width:520px}.row{display:grid;gap:7px}label{font-weight:650}select,input,button{font:inherit;border-radius:9px;border:1px solid #c9d4e2;padding:10px 12px;background:#fff}button{cursor:pointer;background:#1f5eff;color:#fff;border-color:#1f5eff;font-weight:700}.secondary{background:#fff;color:#1f5eff}.checkout{display:grid;gap:16px;max-width:560px}.cta{padding:14px 18px;font-size:16px}.meta{font-size:12px;color:#6b7685;margin-top:22px}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.table{width:100%;border-collapse:collapse}.table td,.table th{padding:11px;border-bottom:1px solid #e8edf4;text-align:left}
</style>
</head>
<body><main class="shell" data-build="${esc(id)}">
<header class="top"><div><div class="brand">DeltaDesk</div><div class="muted">${localeText(ctx.locale,'Owned release laboratory','Laboratorio propio de releases')}</div></div><span class="badge">Build ${label} · ${esc(id)}</span></header>
<nav class="nav" aria-label="Primary">
<a href="/build-${build}/dashboard?${q}">${localeText(ctx.locale,'Requests','Solicitudes')}</a>
<a href="/build-${build}/request/REQ-104?${q}">${localeText(ctx.locale,'Request detail','Detalle')}</a>
<a href="/build-${build}/checkout?${q}">${localeText(ctx.locale,'Checkout','Suscripción')}</a>
<a href="/build-${build}/login?locale=${encodeURIComponent(ctx.locale)}">${localeText(ctx.locale,'Switch demo identity','Cambiar identidad demo')}</a>
</nav>
<section class="card" style="margin-top:18px">${body}</section>
<p class="meta">Synthetic fixture · role=<span class="mono">${ctx.role}</span> · plan=<span class="mono">${ctx.plan}</span> · locale=<span class="mono">${ctx.locale}</span></p>
</main></body></html>`;
}
function login(build,ctx){
  const action=`/build-${build}/dashboard`;
  return page(build,localeText(ctx.locale,'Sign in','Iniciar sesión'),ctx,`
<h1>${localeText(ctx.locale,'Sign in to DeltaDesk','Inicia sesión en DeltaDesk')}</h1>
<p class="muted">${localeText(ctx.locale,'Choose a synthetic role and plan. No real account exists.','Elige un rol y plan sintéticos. No existe una cuenta real.')}</p>
<form class="stack" method="get" action="${action}">
<div class="row"><label for="role">Role</label><select id="role" name="role"><option value="viewer">viewer</option><option value="operator">operator</option></select></div>
<div class="row"><label for="plan">Plan</label><select id="plan" name="plan"><option value="basic">basic</option><option value="pro">pro</option></select></div>
<input type="hidden" name="locale" value="${esc(ctx.locale)}">
<button type="submit">Open DeltaDesk</button>
</form>`);
}
function advancedAvailable(build,ctx){
  return build==='a'?ctx.role==='operator':ctx.role==='operator'&&ctx.plan==='pro';
}
function dashboard(build,ctx){
  const available=advancedAvailable(build,ctx);
  return page(build,localeText(ctx.locale,'Requests','Solicitudes'),ctx,`
<h1>${localeText(ctx.locale,'Requests','Solicitudes')}</h1>
<p class="muted">${localeText(ctx.locale,'Synthetic queue for release acceptance.','Cola sintética para aceptación del release.')}</p>
<p class="feature ${available?'ok':'danger'}">Advanced export: ${available?'available':'unavailable'}</p>
<table class="table"><thead><tr><th>ID</th><th>${localeText(ctx.locale,'Request','Solicitud')}</th><th>${localeText(ctx.locale,'Owner','Responsable')}</th><th>Status</th></tr></thead>
<tbody>${tickets.map(t=>`<tr><td><a href="/build-${build}/request/${t.id}?${query(ctx)}">${t.id}</a></td><td>${esc(t.title)}</td><td>${esc(t.owner)}</td><td>${esc(t.status)}</td></tr>`).join('')}</tbody></table>`);
}
function requestDetail(build,ctx,id){
  const ticket=tickets.find(t=>t.id===id)??tickets[0];
  return page(build,localeText(ctx.locale,'Request detail','Detalle de solicitud'),ctx,`
<h1>${esc(ticket.id)} · ${esc(ticket.title)}</h1>
<div class="grid"><div class="ticket"><strong>${localeText(ctx.locale,'Owner','Responsable')}</strong><p>${esc(ticket.owner)}</p></div><div class="ticket"><strong>Status</strong><p>${esc(ticket.status)}</p></div><div class="ticket"><strong>Priority</strong><p>${esc(ticket.priority)}</p></div></div>
<p class="muted">${localeText(ctx.locale,'This surface is intentionally unchanged between A and B apart from the build identity wrapper.','Esta superficie permanece intencionalmente igual entre A y B salvo la identidad del build.')}</p>`);
}
function planSelector(){return '<div class="row" data-checkout-selector><label for="checkout-plan">Plan</label><select id="checkout-plan" name="checkout-plan"><option>Basic</option><option selected>Pro</option></select></div>';}
function checkout(build,ctx){
  const cta=LAB_MANIFEST.builds[build].checkout_cta;
  const selector=planSelector();
  const button=`<button class="cta" type="button">${esc(cta)}</button>`;
  const ordered=build==='a'?`${selector}${button}`:`${button}${selector}`;
  return page(build,localeText(ctx.locale,'Choose your plan','Elige tu plan'),ctx,`
<h1>${localeText(ctx.locale,'Choose your plan','Elige tu plan')}</h1>
<p class="muted">${localeText(ctx.locale,'No payment is processed. This checkout is a release fixture only.','No se procesa ningún pago. Este checkout sólo es un fixture de release.')}</p>
<div class="checkout">${ordered}</div>`);
}
export function renderDeltaDesk(urlLike){
  const url=urlLike instanceof URL?urlLike:new URL(urlLike,'http://127.0.0.1');
  const match=url.pathname.match(/^\/build-(a|b)\/(login|dashboard|checkout|request\/([^/]+))\/?$/);
  if(!match)return null;
  const [,build,surface,requestId]=match,ctx=context(url);
  if(surface==='login')return login(build,ctx);
  if(surface==='dashboard')return dashboard(build,ctx);
  if(surface==='checkout')return checkout(build,ctx);
  return requestDetail(build,ctx,requestId);
}
export function createDeltaDeskServer({host='127.0.0.1',port=0}={}){
  let resets=0;
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url??'/','http://127.0.0.1');
    if(url.pathname==='/health'){
      res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
      return res.end(JSON.stringify({status:'ok',schema_version:LAB_MANIFEST.schema_version,builds:BUILD_IDS,resets}));
    }
    if(url.pathname==='/lab/reset'){
      if(req.method!=='POST'){res.writeHead(405,{'allow':'POST'});return res.end('method not allowed');}
      resets+=1;res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
      return res.end(JSON.stringify({status:'reset',resets}));
    }
    const html=renderDeltaDesk(url);
    if(!html){res.writeHead(404,{'content-type':'text/plain; charset=utf-8'});return res.end('not found');}
    const build=url.pathname.startsWith('/build-a/')?'a':'b';
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-deltadesk-build':BUILD_IDS[build]});
    res.end(html);
  });
  return{
    async listen(){
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
      const address=server.address();
      if(!address||typeof address==='string')throw new Error('DeltaDesk server did not bind a TCP port');
      return`http://${host}:${address.port}`;
    },
    async close(){if(server.listening)await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));}
  };
}

if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
  const requested=Number.parseInt(process.env.PORT??process.argv[2]??'4399',10);
  const fixture=createDeltaDeskServer({port:Number.isFinite(requested)?requested:4399});
  const origin=await fixture.listen();
  process.stdout.write(`DELTADESK_READY ${origin}\n`);
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await fixture.close();process.exit(0);});
}
