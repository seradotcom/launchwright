// SPDX-License-Identifier: AGPL-3.0-only
// R44: reproducible private store listing ZIP of exact source-linked PNG pixels.
// No network, account APIs, device image resizing or product claim generation.
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { requireCondition as ensure } from '@semwright/native-sdk';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const escape=str=>String(str).replace(/[&<>"']/gu,c=>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const FIXED_DATE=new Date('2000-01-01T00:00:00.000Z');
const STYLES=[
  ':root{color-scheme:dark;font-family:system-ui,sans-serif;background:#0c1826;color:#e5eff7}',
  '*{box-sizing:border-box}body{margin:0}main{max-width:1400px;margin:auto;padding:32px clamp(16px,4vw,55px)}',
  '.small{font-size:12px;letter-spacing:.06em;color:#67d5c6;text-transform:uppercase}',
  'h1{font-size:clamp(24px,3.5vw,46px);margin:14px 0 4px}',
  'h2{font-size:clamp(18px,2vw,26px)}p{line-height:1.65}',
  '.pill{border:1px solid #497087;background:#1a334b;border-radius:8px;padding:12px 16px;color:#c5dce9}',
  '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:18px;margin:28px 0}',
  'figure{margin:0;background:#142a3e;border:1px solid #38536b;border-radius:10px;padding:12px;min-width:0}',
  'figure img{display:block;width:100%;max-height:65vh;object-fit:contain}',
  'figcaption{font-size:13px;color:#c7dce9;padding:10px 6px;overflow-wrap:anywhere}',
  '.muted{color:#96b1c6}.fine{font-size:13px;max-width:80ch;color:#bad0df}',
  'a{color:#78dbcf}pre{white-space:pre-wrap;overflow-wrap:anywhere}'
].join('\n');
function html(data,plan,screens,graphics){
  const pictures=screens.map((item,i)=>
    '<figure><img src="data:image/png;base64,'+item.bytes.toString('base64')+
      '" width="'+item.width+'" height="'+item.height+'" alt="'+escape(item.alt)+
      '"><figcaption>Screenshot '+(i+1)+' — '+escape(item.alt)+
      '<br>Evidence '+escape(item.evidence_id)+'</figcaption></figure>').join('\n');
  const graphicHtml=graphics.map(item=>
    '<figure><img src="data:image/png;base64,'+item.bytes.toString('base64')+
      '" width="'+item.width+'" height="'+item.height+'" alt="Operator-provided '+
      escape(item.role)+' graphic"><figcaption>'+escape(item.role)+
      ' graphic — operator-owned, image-content review pending</figcaption></figure>').join('\n');
  const cssHash=createHash('sha256').update(STYLES).digest('base64');
  const policy="default-src 'none'; script-src 'none'; connect-src 'none'; "+
    "frame-src 'none'; form-action 'none'; base-uri 'none'; "+
    "font-src 'none'; img-src data:; style-src 'sha256-"+cssHash+"'";
  return '<!doctype html>\n<html lang="'+escape(plan.locale)+
    '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta http-equiv="Content-Security-Policy" content="'+escape(policy)+'">'+
    '<meta name="referrer" content="no-referrer">'+
    '<title>Private store listing review</title><style>'+STYLES+'</style></head>'+
    '<body><main><div class="small">Launchwright / Owner review only</div>'+
    '<h1>'+escape(plan.metadata.name)+'</h1><p>'+escape(plan.metadata.summary)+'</p>'+
    '<p class="pill"><strong>NOT PUBLISHED.</strong> These are operator-selected listing assets and metadata.'+
    ' Pixel privacy, authenticity, rights and policy compliance have not been independently certified.'+
    ' Technical state remains UNKNOWN. No App Store/Google Play submission has occurred.</p>'+
    '<h2>Screenshot sequence</h2><div class="grid">'+pictures+'</div>'+
    (graphicHtml?'<h2>Store graphics</h2><div class="grid">'+graphicHtml+'</div>':'')+
    '<h2>Operator-written listing description</h2><p>'+escape(plan.metadata.description).
      replaceAll('\n','</p><p>')+'</p>'+
    '<p class="fine">Source release '+escape(plan.release_id)+' · Store profile '+escape(plan.platform)+
    ' · Locale '+escape(plan.locale)+' · Frozen candidate '+escape(plan.candidate_sha256)+
    ' · Local plan '+escape(plan.plan_sha256)+'</p>'+
    '<p class="fine">Store policy subset checked locally. No store account, app binary, privacy review,'+
    ' pricing, age ratings, submission or external deployment is included.</p></main></body></html>\n';
}
export async function renderStorePackage(plan,data){
  ensure(plan?.plan_sha256&&data?.screenshots?.length===plan.screenshot_count,
    'Store input does not match approved plan screenshot count','Conflict');
  for(let i=0;i<data.screenshots.length;i++){
    const actual=data.screenshots[i],expected=plan.screenshots[i];
    ensure(actual.evidence_id===expected.evidence_id&&
      actual.normalized_sha256===expected.normalized_sha256&&
      actual.width===expected.width&&actual.height===expected.height&&
      Buffer.isBuffer(actual.bytes)&&sha(actual.bytes)===expected.normalized_sha256,
      'A store screenshot differs from approved metadata and PNG bytes','Conflict');
  }
  for(let i=0;i<data.graphics.length;i++){
    const actual=data.graphics[i],expected=plan.graphics[i];
    ensure(actual.role===expected.role&&actual.normalized_sha256===expected.normalized_sha256&&
      Buffer.isBuffer(actual.bytes)&&sha(actual.bytes)===expected.normalized_sha256,
      'A store graphic differs from its approved pixels','Conflict');
  }
  const screenshots=data.screenshots.map((s,i)=>({
    path:'screenshots/'+String(i+1).padStart(2,'0')+'.png',
    ordinal:i+1,evidence_id:s.evidence_id,
    source_png_sha256:s.source_png_sha256,
    normalized_png_sha256:s.normalized_sha256,
    width:s.width,height:s.height,alt:s.alt,
    pixels_bound_to_capture_receipt:'operator-declaration-only',
    bytes:s.bytes
  }));
  const graphics=data.graphics.map(g=>({
    path:'graphics/'+g.role+'.png',role:g.role,width:g.width,height:g.height,
    source_png_sha256:g.source_png_sha256,
    normalized_png_sha256:g.normalized_sha256,
    pixel_rights_basis:'operator-declared-only',
    bytes:g.bytes
  }));
  const display=html(data,plan,data.screenshots,data.graphics);
  ensure(Buffer.byteLength(display,'utf8')<=60*1024*1024,
    'Preview exceeds local HTML byte budget','ResourceExhausted');
  const metadata={
    schema_version:'launchwright-store-listing-metadata/1',
    platform:plan.platform,locale:plan.locale,device:plan.device,
    app_name:plan.metadata.name,summary:plan.metadata.summary,
    description:plan.metadata.description,keywords:plan.metadata.keywords,
    support_url:plan.metadata.support_url,
    privacy_policy_url:plan.metadata.privacy_policy_url,
    source_candidate_id:plan.candidate_id,
    source_candidate_sha256:plan.candidate_sha256,
    store_listing_state:'OPERATOR_LOCAL_REVIEW',
    external_submission_state:'NOT_SENT'
  };
  const manifest={
    schema_version:'launchwright-store-package-manifest/1',
    plan_sha256:plan.plan_sha256,
    store_platform:plan.platform,store_profile:plan.device,channel:plan.channel,
    snapshot_as_of:plan.policy_snapshot,
    policy_reference:plan.policy_url,
    release_id:plan.release_id,release_version:plan.release_version,
    release_build:plan.build,
    candidate_id:plan.candidate_id,candidate_sha256:plan.candidate_sha256,
    channel_profile_id:plan.channel_profile_id,
    channel_profile_version:plan.channel_profile_version,
    screenshot_count:screenshots.length,
    screenshot_assets:screenshots.map(({bytes,...value})=>value),
    marketing_graphics:graphics.map(({bytes,...value})=>value),
    google_play_4_screenshot_promotion_recommendation:
      plan.platform==='google-play-phone-portrait'
        ?(screenshots.length>=4?'COUNT_SATISFIED_ONLY':'NOT_ESTABLISHED')
        :'NOT_APPLICABLE',
    metadata_sha256:sha(Buffer.from(JSON.stringify(metadata,null,2)+'\n')),
    preview_sha256:sha(Buffer.from(display,'utf8')),
    local_png_dimensions_channels_verified:true,
    source_pixel_authenticity:'operator-declaration-only',
    independent_privacy_rights_content_review:false,
    store_policy_complete:false,store_account_accepted:false,
    app_binary_included:false,store_upload_performed:false,
    published:false,platform_authority:false
  };
  const files=[
    {path:'listing.json',bytes:Buffer.from(JSON.stringify(metadata,null,2)+'\n')},
    {path:'manifest.json',bytes:Buffer.from(JSON.stringify(manifest,null,2)+'\n')},
    {path:'preview.html',bytes:Buffer.from(display,'utf8')},
    {path:'README.txt',bytes:Buffer.from(
      'LAUNCHWRIGHT STORE LISTING — PRIVATE OPERATOR REVIEW\n'+
      'This is not an Apple/Google store upload, app binary or accepted listing.\n'+
      'PNG dimensions and pixel/channel structure match only a bounded policy snapshot.\n'+
      'Exact screenshots correspond to operator-declared sanitized evidence IDs, not cryptographically verified capture pixels.\n'+
      'Review visual PII, trademarks, content rights, accessibility, localization and all current store policies separately.\n'+
      'Open preview.html offline (no scripts, no external network). NEVER publish this ZIP automatically.\n'
    )},
    ...screenshots.map(s=>({path:s.path,bytes:s.bytes})),
    ...graphics.map(s=>({path:s.path,bytes:s.bytes}))
  ];
  const archive=new JSZip();
  const epoch=new Date('2000-01-01T00:00:00.000Z');
  for(const f of files)
    archive.file(f.path,f.bytes,{date:epoch,unixPermissions:'0600',createFolders:false});
  const bytes=Buffer.from(await archive.generateAsync({
    type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6},platform:'UNIX'
  }));
  ensure(bytes.length<=60*1024*1024,'Store listing ZIP exceeds 60 MiB','ResourceExhausted');
  const check=await JSZip.loadAsync(bytes,{checkCRC32:true});
  const list=Object.keys(check.files).sort();
  ensure(JSON.stringify(list)===JSON.stringify(files.map(f=>f.path).sort()),
    'Store asset ZIP has unexpected entries or executable content','Conflict');
  for(const file of files)
    ensure((await check.file(file.path).async('nodebuffer')).equals(file.bytes),
      'Store asset ZIP failed exact file byte readback','Conflict');
  ensure(!/<script\b|<iframe\b|https?:\/\//iu.test(display),
    'Offline asset preview must contain no scripts/frames/external HTTP addresses',
    'PolicyDenied');
  return{bytes,manifest,metadata,files:list,
    zip_sha256:sha(bytes),html_sha256:sha(Buffer.from(display))};
}
