// SPDX-License-Identifier: AGPL-3.0-only
// CSS :target click-through on exact R59 masked screenshots. No JavaScript,
// remote links, source app interactions, or asynchronous authoring runtime.
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { requireCondition as ensure } from '@semwright/native-sdk';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const base64hash=text=>createHash('sha256').update(Buffer.from(text)).digest('base64');
const escape=value=>String(value).replace(/[&<>"']/gu,
  ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const percent=(pixels,dimension)=>(pixels*100/dimension).toFixed(6)+'%';

function buildHtml(source,plan,masked){
  const width=plan.width,height=plan.height;
  const ratio=(width/height).toFixed(8);
  const baseCss=[
    ':root{color-scheme:dark;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#0b1726;color:#e7eff6;font-synthesis:none}',
    '*{box-sizing:border-box}body{margin:0;min-height:100vh}main{width:min(1440px,100%);margin:auto;padding:24px clamp(14px,4vw,48px) 40px}',
    '.eyebrow{text-transform:uppercase;font-size:12px;letter-spacing:.1em;color:#6ae5cf;font-weight:700}',
    'h1{font-size:clamp(23px,3.3vw,37px);line-height:1.2;margin:10px 0}',
    '.banner{border-bottom:1px solid #36536a;padding-bottom:22px}',
    '.description{font-size:14px;line-height:1.6;max-width:74ch;color:#c0d1e0}',
    '.warning{background:#19334a;border:1px solid #466982;border-radius:8px;padding:12px 15px;font-size:12px;line-height:1.5;color:#c9d9e5}',
    '.warning strong{display:block;color:#fff;font-size:14px}',
    '.steps{display:flex;flex-wrap:wrap;gap:8px;padding:18px 0 22px}',
    '.step-link{display:inline-flex;align-items:center;min-height:44px;padding:8px 16px;background:#173044;border:1px solid #476779;border-radius:8px;color:#e5f2fc;text-decoration:none;font-size:13px;overflow-wrap:anywhere}',
    '.step-link:hover,.step-link:focus-visible{background:#245462;border-color:#61d6c8}',
    '.frames{min-width:0;border:1px solid #426177;background:#152b3e;border-radius:12px;overflow:hidden}',
    '.frame{display:none;min-width:0;scroll-margin-top:18px}',
    '.frame:first-child{display:block}',
    '.frames:has(.frame:target)>.frame:first-child:not(:target){display:none}',
    '.frames>.frame:target{display:block}',
    '.title-row{margin:0;padding:15px 19px;font-size:17px;display:flex;gap:14px;justify-content:space-between;flex-wrap:wrap;border-bottom:1px solid #304e63}',
    '.title-row small{color:#99c5c7;font-size:12px}',
    '.stage{padding:clamp(8px,2.3vw,24px);background:#0a1523}',
    '.surface{position:relative;width:100%;max-width:calc(74vh * '+ratio+');aspect-ratio:'+width+'/'+height+';margin:0 auto}',
    '.surface>img{display:block;width:100%;height:100%;object-fit:fill;border:1px solid #466278;border-radius:4px}',
    '.hotspot{position:absolute;border:2px solid #62e5d3;border-radius:8px;background:rgba(18,106,114,.24);display:grid;place-items:center;text-decoration:none;overflow:hidden;min-width:1px;min-height:1px}',
    '.hotspot:hover,.hotspot:focus-visible{background:rgba(44,149,157,.48);outline:3px solid #e2fff5;outline-offset:2px}',
    '.hotspot-marker{background:#12344c;color:#f4ffff;border:1px solid #77e9db;border-radius:7px;padding:2px 7px;font-weight:800;line-height:1.2;font-size:clamp(14px,2vw,21px)}',
    '.provenance{padding:12px 19px;color:#bdd2e0;font-size:12px;line-height:1.5;overflow-wrap:anywhere}',
    '.prev-next{display:flex;justify-content:space-between;gap:12px;padding:15px 19px;border-top:1px solid #315168}',
    '.prev-next a{color:#a2eee0;min-height:44px;display:flex;align-items:center;text-decoration:none;font-size:13px}',
    '.prev-next a:hover,.prev-next a:focus-visible{text-decoration:underline}',
    '.footer{margin-top:24px;color:#aac3d4;font-size:12px;line-height:1.6;overflow-wrap:anywhere}',
    '@media(max-width:700px){.warning{padding:10px}.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,155px),1fr))}.step-link{width:100%}.title-row{padding:12px 14px}.provenance{padding:12px 14px}}',
    '@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important}}'
  ];
  const shotIds=masked.masks.map(x=>x.shot_id);
  const generatedCss=plan.links.map((link,i)=>
    '#zone-'+(i+1)+'{left:'+percent(link.x,width)+';top:'+percent(link.y,height)+
    ';width:'+percent(link.width,width)+';height:'+percent(link.height,height)+'}'
  );
  const css=[...baseCss,...generatedCss].join('\n');
  const policy="default-src 'none'; base-uri 'none'; form-action 'none'; "+
    "script-src 'none'; connect-src 'none'; img-src data:; "+
    "style-src 'sha256-"+base64hash(css)+"'; "+
    "style-src-attr 'none'; frame-src 'none'; font-src 'none'; media-src 'none'";
  const navigation=source.frames.map((frame,i)=>
    '<a class="step-link" href="#scene-'+(i+1)+'">Step '+(i+1)+': '+
    escape(frame.label)+'</a>').join('');
  const frames=source.frames.map((frame,i)=>{
    const links=plan.links.filter(link=>link.from_shot_id===frame.shot_id);
    const control=links.map(link=>{
      const j=shotIds.indexOf(link.to_shot_id);
      ensure(j>=0,'A source screenshot step lacks an exact approved target','Conflict');
      const n=plan.links.indexOf(link)+1;
      return '<a class="hotspot" id="zone-'+n+'" href="#scene-'+(j+1)+
        '" aria-label="View captured step '+(j+1)+': '+escape(link.label)+
        '" title="'+escape(link.label)+'"><span class="hotspot-marker" aria-hidden="true">↗</span></a>';
    }).join('');
    const prev=i>0?'<a href="#scene-'+i+'">← Previous screen</a>':'<span></span>';
    const next=i<source.frames.length-1?
      '<a href="#scene-'+(i+2)+'">Next screen →</a>':'<a href="#scene-1">Return to first screen ↶</a>';
    return '<section class="frame" id="scene-'+(i+1)+'" aria-label="Captured state '+(i+1)+'">'+
      '<h2 class="title-row"><span>'+escape(frame.label)+'</span><small>'+
      (i+1)+' / '+source.frames.length+'</small></h2>'+
      '<div class="stage"><div class="surface">'+
      '<img src="data:image/png;base64,'+frame.normalized_png.toString('base64')+
      '" alt="'+escape(frame.alt)+'" width="'+width+'" height="'+height+'">'+
      control+'</div></div>'+
      '<p class="provenance">R55 opaque-mask derivative · Native evidence '+
      escape(masked.masks[i].derived_evidence_id)+' · SHA-256 '+
      escape(masked.masks[i].masked_pixel_sha256)+'</p>'+
      '<div class="prev-next">'+prev+next+'</div></section>';
  }).join('\n');
  const html='<!doctype html>\n<html lang="'+escape(source.masked_manifest.locale)+'">'+
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta http-equiv="Content-Security-Policy" content="'+escape(policy)+'">'+
    '<meta name="referrer" content="no-referrer"><title>Private click-through walkthrough</title>'+
    '<style>'+css+'</style></head><body><main><header class="banner">'+
    '<p class="eyebrow">Source-pinned offline product walkthrough</p>'+
    '<h1>Explore captured states</h1>'+
    '<p class="description">Choose a step or activate a highlighted region to open a different captured screenshot.'+
    ' These regions are operator-authored navigation only, not evidence that a live product action succeeded.</p>'+
    '<div class="warning"><strong>TECHNICAL UNKNOWN · PRIVATE REVIEW</strong>'+
    'Only operator-selected R55 rectangles were masked. Other pixels have not been independently privacy-verified.'+
    ' No live app, network access, user accounts or publication.</div></header>'+
    '<nav class="steps" aria-label="Captured screens">'+navigation+'</nav>'+
    '<div class="frames">'+frames+'</div>'+
    '<footer class="footer">DRAFT · NOT PUBLISHED · CSS-only offline navigation.'+
    ' Source R59 ZIP SHA-256: '+escape(plan.r59_bundle_sha256)+
    '. Masked pixels retain their exact original Native evidence lineage.'+
    ' Independent rights, privacy, accessibility and customer approval are still required.'+
    '</footer></main></body></html>\n';
  ensure(!/<script\b|<iframe\b|<form\b|https?:\/\//iu.test(html),
    'Offline hotspot document includes active code or external URLs','PolicyDenied');
  return Buffer.from(html,'utf8');
}
export async function renderHotspotWalkthrough(source,plan,masked){
  ensure(plan.frame_count===source.frames.length&&
    plan.r59_bundle_sha256===source.bundle_sha256,
    'Hotspot source differs from the exact R59 reviewed ZIP','Conflict');
  for(let i=0;i<source.frames.length;i++){
    ensure(source.frames[i].shot_id===masked.masks[i].shot_id,
      'Hotspot source Media shot order changed','Conflict');
  }
  const html=buildHtml(source,plan,masked);
  ensure(html.length<=20*1024*1024,
    'Offline hotspot HTML exceeds 20 MiB','ResourceExhausted');
  const manifest={
    schema_version:'launchwright-r61-masked-hotspot-bundle/1',
    plan_sha256:plan.plan_sha256,
    r59_plan_sha256:plan.r59_plan_sha256,
    r59_bundle_sha256:plan.r59_bundle_sha256,
    r59_manifest_sha256:plan.r59_manifest_sha256,
    r59_html_sha256:plan.r59_html_sha256,
    r59_media_output_id:plan.r59_media_output_id,
    media_plan_digest:plan.media_plan_digest,
    frame_count:plan.frame_count,
    links:plan.links,
    masked_source_chain:masked.masks.map(m=>({...m})),
    screenshots:source.frames.map((f,i)=>({
      shot_id:f.shot_id,
      original_r55_masked_pixel_sha256:masked.masks[i].masked_pixel_sha256,
      inline_normalized_png_sha256:sha(f.normalized_png)
    })),
    html_sha256:sha(html),
    navigation_mode:'css-target-links',
    user_authored_navigation_not_product_action:true,
    source_app_execution:false,
    network_access:false,script_execution:false,
    pixel_privacy_outside_masks_verified:false,
    technical_state:'UNKNOWN',
    native_media_output_created:false,
    external_publication:false,platform_authority:false
  };
  const notice=Buffer.from(
    'LAUNCHWRIGHT R61 PRIVATE CLICK-THROUGH\n'+
    'Extract this ZIP and open index.html in a modern browser. No JavaScript or network.\n'+
    'Operator-authored clickable regions navigate between existing masked screenshots only.\n'+
    'They do not reproduce a live product interaction or prove source behavior.\n'+
    'All R55 masks cover only selected rectangles. Other pixels may contain sensitive information.\n'+
    'No canonical Driver Host, customer acceptance or Platform Publish is claimed.\n'
  );
  const files=[
    {name:'index.html',bytes:html},
    {name:'manifest.json',bytes:Buffer.from(JSON.stringify(manifest,null,2)+'\n')},
    {name:'README.txt',bytes:notice}
  ];
  const zip=new JSZip(),date=new Date('2000-01-01T00:00:00.000Z');
  for(const file of files)zip.file(file.name,file.bytes,{
    date,unixPermissions:'0600'
  });
  const bytes=Buffer.from(await zip.generateAsync({
    type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6},
    platform:'UNIX'
  }));
  ensure(bytes.length<=21*1024*1024,'Hotspot ZIP exceeds 21 MiB budget','ResourceExhausted');
  const verified=await JSZip.loadAsync(bytes,{checkCRC32:true});
  ensure(JSON.stringify(Object.keys(verified.files).sort())===
    JSON.stringify(files.map(f=>f.name).sort()),
    'Offline ZIP contains unapproved executable or extra files','ProtocolMismatch');
  for(const file of files){
    const actual=await verified.file(file.name)?.async('nodebuffer');
    ensure(actual?.equals(file.bytes)===true,
      'Offline ZIP readback does not match approved bytes','Conflict');
  }
  return{bytes,html_sha256:sha(html),manifest};
}
