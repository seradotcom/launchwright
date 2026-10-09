// SPDX-License-Identifier: AGPL-3.0-only
// R43: fully offline, script-free, keyboard-accessible HTML walkthrough.
// Screenshots come exclusively from operator-specified, Native Media-linked
// SANITIZED_DERIVATIVE evidence. No replay of the original product.
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { requireCondition as ensure } from '@semwright/native-sdk';

const sha=buffer=>createHash('sha256').update(buffer).digest('hex');
const shaBase64=buffer=>createHash('sha256').update(buffer).digest('base64');
const escape=str=>String(str).replace(/[&<>"']/gu,c=>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const styles=[
 ':root{color-scheme:dark;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;background:#0b1726;color:#e7eff6;font-synthesis:none;}',
 '*{box-sizing:border-box}',
 'body{margin:0;min-height:100vh}',
 'main{width:min(1440px,100%);margin:auto;padding:26px clamp(15px,4vw,54px) 42px}',
 '.banner{display:flex;justify-content:space-between;align-items:flex-start;gap:22px;padding-bottom:22px;border-bottom:1px solid #315064}',
 '.eyebrow{text-transform:uppercase;font-size:12px;letter-spacing:.1em;color:#67dccc;font-weight:650}',
 'h1{font-size:clamp(22px,3.2vw,38px);line-height:1.18;margin:9px 0 8px;overflow-wrap:anywhere}',
 '.summary{max-width:70ch;color:#bacddc;line-height:1.55;font-size:15px;margin:0}',
 '.truth{border:1px solid #406178;border-radius:7px;padding:10px 14px;font-size:12px;line-height:1.5;color:#b9ccdc;background:#172d41;max-width:260px}',
 '.truth strong{color:#eaf4fa;display:block;font-size:13px}',
 '.steps-heading{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#9ab4c5;margin:27px 0 13px}',
 '.navigator{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:20px}',
 '.nav-label{display:inline-flex;align-items:center;gap:9px;min-height:44px;font-size:14px;color:#d7e5f0;cursor:pointer;user-select:none;padding:9px 15px;border:1px solid #426177;border-radius:8px;background:#172c40;max-width:100%;overflow-wrap:anywhere}',
 '.nav-label .number{font-size:11px;color:#89c7c3;font-variant-numeric:tabular-nums}',
 '.nav-label:hover{border-color:#80d5c8;background:#234156}',
 '.screen-radio{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;clip-path:inset(50%)}',
 '.screens{border:1px solid #426177;border-radius:11px;background:#162b3d;overflow:hidden;min-width:0}',
 '.frame{display:none}',
 '.frame-heading{margin:0;padding:15px 22px;display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid #315064;font-size:15px;font-weight:640;overflow-wrap:anywhere}',
 '.frame-heading .count{font-size:12px;color:#91b9c0;font-variant-numeric:tabular-nums;flex:none}',
 '.stage{padding:clamp(9px,2vw,22px);background:#0b1622}',
 '.stage img{display:block;width:100%;height:auto;max-height:74vh;object-fit:contain;margin-inline:auto;border:1px solid #3b5266;border-radius:5px;background:#223749}',
 '.provenance{padding:16px 22px 18px;color:#b5c8d6;font-size:12px;line-height:1.55;overflow-wrap:anywhere}',
 '.footer{margin-top:24px;color:#97b2c5;font-size:12px;line-height:1.65;overflow-wrap:anywhere}',
 '.footer strong{color:#dbe7ee}',
 '@media(max-width:710px){.banner{display:block}.truth{margin-top:18px;max-width:none}.frame-heading{padding:13px 15px}.provenance{padding:14px 15px}.navigator{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr))}.nav-label{width:100%}}',
 '@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important}}'
].join('\n');

function htmlDocument(data,plan){
  const radios=data.frames.map((f,i)=>
    '<input class="screen-radio" type="radio" name="demo-step" id="step-'+(i+1)+
    '" aria-label="Step '+(i+1)+': '+escape(f.label)+'"'+(i===0?' checked':'')+'>').join('\n');
  const tabs=data.frames.map((f,i)=>
    '<label class="nav-label" for="step-'+(i+1)+'"><span class="number">'+
    String(i+1).padStart(2,'0')+'</span><span>'+escape(f.label)+'</span></label>').join('\n');
  const frames=data.frames.map((f,i)=>{
    const uri='data:image/png;base64,'+f.png.toString('base64');
    return '<section class="frame" id="frame-'+(i+1)+
      '" aria-label="Step '+(i+1)+': '+escape(f.label)+'">'+
      '<h2 class="frame-heading"><span>'+escape(f.label)+
      '</span><span class="count">'+(i+1)+' / '+data.frames.length+'</span></h2>'+
      '<div class="stage"><img src="'+uri+'" alt="'+escape(f.alt)+
      '" width="'+data.variant.width+'" height="'+data.variant.height+'"></div>'+
      '<p class="provenance">Sanitized derivative declared by source owner · Evidence '+
      escape(f.source_evidence_id)+' · Image SHA-256 '+escape(f.sanitized_png_sha256)+
      '</p></section>';
  }).join('\n');
  const navCss=data.frames.map((f,i)=>{
    const n=i+1;
    return '#step-'+n+':checked ~ .screens #frame-'+n+
      '{display:block}#step-'+n+':checked ~ .navigator label[for="step-'+n+
      '"]{background:#23515a;color:#fff;border-color:#72ddcc}'+
      '#step-'+n+':focus-visible ~ .navigator label[for="step-'+n+
      '"]{outline:3px solid #b7fff0}';
  }).join('');
  const css=styles+navCss;
  const policy="default-src 'none'; base-uri 'none'; form-action 'none'; "+
    "script-src 'none'; connect-src 'none'; img-src data:; "+
    "style-src 'sha256-"+shaBase64(Buffer.from(css))+"'; "+
    "frame-src 'none'; media-src 'none'; font-src 'none'";
  return '<!doctype html>\n<html lang="'+escape(data.variant.locale)+
    '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta http-equiv="Content-Security-Policy" content="'+escape(policy)+'">'+
    '<meta name="referrer" content="no-referrer">'+
    '<title>Private product walkthrough</title><style>'+css+'</style></head><body><main>'+
    '<header class="banner"><div><div class="eyebrow">Offline walkthrough / Private review</div>'+
    '<h1>Private product walkthrough</h1>'+
    '<p class="summary">Explore '+data.frames.length+
    ' owner-selected screenshots from a version-bound Media plan. This is a static representation,'+
    ' not a running application. Use the step controls to navigate.</p></div>'+
    '<div class="truth"><strong>TECHNICAL UNKNOWN</strong>'+
    'Sanitization and privacy are operator-declared, not independently verified.'+
    ' No live actions, accounts or external publication.</div></header>'+
    '<section class="demo-root" aria-label="Demo steps"><p class="steps-heading">Select a captured state</p>'+
    radios+'<nav class="navigator" aria-label="Screen navigation">'+tabs+'</nav>'+
    '<div class="screens">'+frames+'</div></section>'+
    '<footer class="footer"><strong>DRAFT · NOT PUBLISHED · OFFLINE ONLY</strong> — '+
    'Input plan '+escape(plan.media_plan_digest)+
    ' · This ZIP contains no JavaScript, no live source app and no third-party links.'+
    ' Pixels may still contain personal data; obtain independent privacy approval before distribution.'+
    '</footer></main></body></html>\n';
}
export async function renderOfflineDemo(data,plan){
  ensure(Array.isArray(data?.frames)&&data.frames.length===plan?.frame_count,
    'Offline demo frame count differs from exact private plan','Conflict');
  for(let i=0;i<data.frames.length;i++){
    const actual=data.frames[i],expected=plan.frames[i];
    ensure(Buffer.isBuffer(actual.png)&&
      sha(actual.png)===expected.sanitized_png_sha256&&
      actual.shot_id===expected.shot_id&&
      actual.source_evidence_id===expected.source_evidence_id,
      'An embedded sanitized frame differs from its approved source digest',
      'Conflict');
  }
  const html=Buffer.from(htmlDocument(data,plan),'utf8');
  ensure(html.length<=20*1024*1024,
    'Offline demo HTML exceeds 20 MiB budget','ResourceExhausted');
  const manifest={
    schema_version:'launchwright-offline-demo-bundle/1',
    plan_sha256:plan.plan_sha256,
    media_plan_id:plan.media_plan_id,media_plan_digest:plan.media_plan_digest,
    variant_id:plan.variant_id,locale:plan.locale,
    screenshot_width:plan.width,screenshot_height:plan.height,
    screenshots:plan.frames.map(f=>({
      shot_id:f.shot_id,source_evidence_id:f.source_evidence_id,
      source_origin_digest:f.source_origin_digest,
      source_png_sha256:f.screenshot_sha256,
      normalized_png_sha256:f.sanitized_png_sha256,
      label:f.label,alt:f.alt
    })),
    html_sha256:sha(html),
    script_execution_permitted:false,source_app_execution_permitted:false,
    remote_resources_permitted:false,network_access_performed:false,
    pixel_privacy_independently_verified:false,
    technical_state:'UNKNOWN',publication_authority:false,
    platform_authority:false
  };
  const documentation=Buffer.from(
    'LAUNCHWRIGHT / PRIVATE OFFLINE WALKTHROUGH\n'+
    'Open index.html in a modern browser; arrow keys navigate the native step radio buttons.\n'+
    'No scripts, network resources or source application actions are included.\n'+
    'This package is a static owner-declared sanitized derivative, not verified technical evidence.\n'+
    'Visual pixels may still contain sensitive data. Independent review required before any sharing.\n',
    'utf8');
  const files=[
    {name:'index.html',bytes:html},
    {name:'manifest.json',bytes:Buffer.from(JSON.stringify(manifest,null,2)+'\n')},
    {name:'README.txt',bytes:documentation}
  ];
  const zip=new JSZip(),epoch=new Date('2000-01-01T00:00:00.000Z');
  for(const file of files)zip.file(file.name,file.bytes,{
    date:epoch,unixPermissions:'0600'
  });
  const bytes=Buffer.from(await zip.generateAsync({
    type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6},
    platform:'UNIX'
  }));
  ensure(bytes.length<=21*1024*1024,'Offline demo ZIP exceeds 21 MiB','ResourceExhausted');
  const unpacked=await JSZip.loadAsync(bytes,{checkCRC32:true});
  const names=Object.keys(unpacked.files).sort();
  ensure(JSON.stringify(names)===JSON.stringify(files.map(x=>x.name).sort()),
    'Offline ZIP contains unexpected executable or nested content','ProtocolMismatch');
  for(const file of files){
    const observed=await unpacked.file(file.name).async('nodebuffer');
    ensure(observed.equals(file.bytes),'Offline ZIP source bytes changed','Conflict');
  }
  ensure(!/<script\b|<iframe\b|https?:\/\//iu.test(html.toString('utf8')),
    'Offline HTML contains active scripts/frames or external URLs','PolicyDenied');
  return{bytes,manifest,html_sha256:sha(html),
    zip_sha256:sha(bytes),frames:data.frames.length};
}
