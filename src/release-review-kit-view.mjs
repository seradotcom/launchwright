// SPDX-License-Identifier: AGPL-3.0-only
// R64 script-free offline release-review index. No external network or runtime.
import {createHash} from 'node:crypto';
import {requireCondition as ensure} from '@semwright/native-sdk';

const escape=v=>String(v??'').replace(/[&<>"']/gu,ch=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[ch]);
const css=[
 ':root{color-scheme:dark;font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;background:#0b1828;color:#e6f1f8}',
 '*{box-sizing:border-box}body{margin:0}',
 'main{max-width:1240px;margin:0 auto;padding:40px clamp(16px,4vw,54px) 50px}',
 '.skip{position:absolute;top:-100px;left:12px;background:#e4fff9;color:#14364a;padding:10px;z-index:2}',
 '.skip:focus{top:12px}',
 '.eyebrow{font-size:12px;font-weight:750;letter-spacing:.13em;text-transform:uppercase;color:#64d8c6}',
 'h1{font-size:clamp(27px,4.1vw,47px);letter-spacing:-.033em;line-height:1.12;margin:13px 0}',
 'p{color:#b6cbd9;margin:12px 0;max-width:78ch}',
 '.hero{padding-bottom:30px;border-bottom:1px solid #335167}',
 '.warning{border-left:4px solid #f0c581;padding:16px 20px;margin-top:25px;background:#203242;color:#f3e2c2}',
 '.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:15px;margin-top:25px}',
 '.card{border:1px solid #37546a;background:#172b3e;border-radius:9px;padding:21px;min-width:0;display:flex;flex-direction:column}',
 '.card h2{font-size:21px;margin:4px 0 12px}',
 '.card p{font-size:14px;margin:0 0 20px;flex:1}',
 '.tag{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:#85d8c9;font-weight:700}',
 '.card a{display:inline-flex;align-items:center;justify-content:center;padding:12px 17px;text-decoration:none;color:#0b2531;background:#83e7d9;font-weight:700;border-radius:6px;min-height:44px}',
 'a:hover{filter:brightness(1.12)}a:focus-visible{outline:3px solid #fff;outline-offset:3px}',
 '.codes{margin:28px 0;border:1px solid #345166;border-radius:8px;padding:19px;min-width:0}',
 '.codes dl{display:grid;grid-template-columns:130px minmax(0,1fr);gap:10px 14px}',
 '.codes dt{font-size:12px;color:#98b3c5}.codes dd{margin:0;overflow-wrap:anywhere}',
 'code{font:12px/1.65 ui-monospace,Consolas,monospace;color:#d0f4ea;overflow-wrap:anywhere}',
 'footer{padding:25px 0;color:#a1b8cb;font-size:12px;border-top:1px solid #345166}',
 '@media(max-width:790px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}',
 '@media(max-width:560px){main{padding-top:20px}.grid{grid-template-columns:1fr}.codes dl{grid-template-columns:1fr}.codes{padding:13px}}'
].join('\n');
export function renderReviewKit(plan){
  ensure(plan?.schema_version==='launchwright-release-review-kit/1'&&
    plan.private_only===true&&plan.technical_state==='UNKNOWN'&&
    plan.published===false&&plan.platform_authority===false,
    'Offline release kit view requires UNKNOWN private authority');
  const cards=[
    ['Documentation','HTML / Offline','Browse exact, release-bound editorial documentation with verified internal links.','docs/index.html','Open documentation'],
    ['Presentation','PPTX / Editable','Edit a real PowerPoint derived from the frozen source. Design and accessibility review remain separate.','deck/release-deck.pptx','Open PowerPoint'],
    ['Presentation','PDF / Review','Read the matching PDF generated from the same frozen source and slide count.','deck/release-deck.pdf','Open PDF'],
    ...(plan.demo_plan_sha256?[[
      'Interactive demo','Masked / Offline','Browse operator-linked masked screenshots without running the source application. Privacy outside masks is UNKNOWN.',
      'demo/index.html','Open offline demo'
    ]]:[])
  ];
  const sections=cards.map(c=>
    '<article class="card"><div class="tag">'+escape(c[1])+'</div>'+
    '<h2>'+escape(c[0])+'</h2><p>'+escape(c[2])+'</p>'+
    '<a href="./'+c[3]+'">'+escape(c[4])+'</a></article>'
  ).join('\n');
  const hash=createHash('sha256').update(css).digest('base64');
  const policy="default-src 'none'; base-uri 'none'; form-action 'none'; "+
    "script-src 'none'; connect-src 'none'; img-src 'none'; "+
    "style-src 'sha256-"+hash+"'; font-src 'none'; frame-src 'none'";
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta name="referrer" content="no-referrer">'+
    '<meta http-equiv="Content-Security-Policy" content="'+escape(policy)+'">'+
    '<title>Launchwright private release kit</title><style>'+css+'</style></head>'+
    '<body><a class="skip" href="#main">Skip to release materials</a><main id="main">'+
    '<header class="hero"><div class="eyebrow">Launchwright / Private release review</div>'+
    '<h1>Release review kit</h1>'+
    '<p>One frozen editorial candidate, one build, several genuine export formats. '+
    'This static package can be inspected without the original product, network accounts or runtime.</p>'+
    '<div class="warning"><strong>TECHNICAL UNKNOWN — NOT PUBLISHED.</strong> '+
    'This package verifies file identities and locally declared source lineage, not customer '+
    'behavior, privacy outside selected masks, rights certification, accessibility or editorial quality.</div></header>'+
    '<section aria-label="Release outputs"><div class="grid">'+sections+'</div></section>'+
    '<section class="codes" aria-labelledby="identity"><h2 id="identity">Source identity</h2>'+
    '<dl><dt>Build</dt><dd><code>'+escape(plan.release_build)+'</code></dd>'+
    '<dt>Release</dt><dd><code>'+escape(plan.release_id)+'</code></dd>'+
    '<dt>Candidate SHA-256</dt><dd><code>'+escape(plan.candidate_sha256)+'</code></dd>'+
    '<dt>Kit plan SHA-256</dt><dd><code>'+escape(plan.plan_sha256)+'</code></dd></dl></section>'+
    '<footer>Owner-approved private review only. No external links, source application scripts, '+
    'automatic publishing or Platform authority. Refer to manifest.json for complete per-file hashes.</footer>'+
    '</main></body></html>\n';
}
