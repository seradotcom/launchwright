// SPDX-License-Identifier: AGPL-3.0-only
// R54: static offline version comparison, no JS/remote resources or product code.
import { createHash } from 'node:crypto';
import { requireCondition as ensure } from '@semwright/native-sdk';
const shaBase64=value=>createHash('sha256').update(value).digest('base64');
const escape=value=>String(value??'').replace(/[&<>"']/gu,ch=>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const css=[
 ':root{color-scheme:dark;font:15px/1.5 Inter,system-ui,"Segoe UI",sans-serif;background:#0b1523;color:#e7f0f7}',
 '*{box-sizing:border-box}body{margin:0;min-height:100vh}',
 'main{width:min(1200px,100%);margin:auto;padding:42px clamp(16px,4vw,60px) 64px}',
 'header{border-bottom:1px solid #284056;padding-bottom:29px;margin-bottom:26px}',
 '.kicker{font-weight:700;color:#58d9c8;letter-spacing:.13em;text-transform:uppercase;font-size:11px}',
 'h1{font-size:clamp(26px,4vw,46px);line-height:1.13;letter-spacing:-.025em;margin:14px 0 18px}',
 '.desc{color:#b0c7d6;font-size:15px;max-width:80ch}',
 '.notice{background:#152d3c;border-left:4px solid #52cbbf;padding:16px 20px;margin:20px 0;color:#d8e8ed}',
 '.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}',
 '.panel{background:#13283a;border:1px solid #28465b;border-radius:8px;padding:19px;min-width:0}',
 '.small{font-size:12px;color:#adc5d3;letter-spacing:.03em;overflow-wrap:anywhere}',
 '.release-name{font-size:23px;font-weight:700;margin:10px 0}',
 'dl{display:grid;grid-template-columns:132px minmax(0,1fr);gap:5px 14px;margin:12px 0}',
 'dt{font-size:12px;color:#9db9c8}dd{margin:0;min-width:0;overflow-wrap:anywhere}',
 'code{font:12px/1.55 ui-monospace,"SFMono-Regular",Consolas,monospace;overflow-wrap:anywhere;color:#e2f4f0}',
 '.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:24px 0 37px}',
 '.metric{border-top:2px solid #4bbfb2;background:#152839;padding:13px 16px}',
 '.metric strong{font-size:27px;display:block;margin:2px 0}',
 'h2{font-size:20px;line-height:1.3;margin:36px 0 13px}',
 '.table-wrap{overflow-x:auto;border:1px solid #28465b;border-radius:8px}',
 'table{width:100%;border-collapse:collapse;background:#112537;text-align:left;font-size:13px}',
 'th,td{padding:14px 16px;border-bottom:1px solid #274052;vertical-align:top;min-width:0;overflow-wrap:anywhere}',
 'th{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#9db8c9;background:#183143}',
 'tr:last-child td{border:0}.status{font-weight:700;font-size:12px}',
 '.status.changed{color:#f9c976}.status.unchanged{color:#74d8ca}',
 '.status.added{color:#8ac3f8}.status.removed{color:#eea1a4}',
 '.warn{color:#f5c68c}.not-proven{color:#b7cddd;font-size:12px}',
 'footer{margin-top:28px;color:#9bb5c5;font-size:12px;line-height:1.75;border-top:1px solid #284056;padding-top:20px}',
 '@media(max-width:770px){main{padding-top:22px}.grid{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}dl{grid-template-columns:95px minmax(0,1fr)}th,td{padding:9px 11px}}',
 '@media(max-width:620px){table,tbody,tr{display:block;width:100%}thead{display:none}tbody tr{border-bottom:1px solid #28465b;padding:12px}tbody tr:last-child{border:0}td{display:grid;grid-template-columns:85px minmax(0,1fr);gap:8px;width:100%;padding:7px 0;border:0}td::before{content:attr(data-label);font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:#a8c4d1}td>div{min-width:0;overflow-wrap:anywhere}}',
 '@media(max-width:420px){.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}table{font-size:12px}}'
].join('\n');
const short=v=>escape(String(v).slice(0,12));
function releasePanel(r,label){
  return '<article class="panel"><div class="small">'+label+'</div>'+
    '<div class="release-name">'+escape(r.release_name)+'</div>'+
    '<dl><dt>Build</dt><dd><code>'+escape(r.build)+'</code></dd>'+
    '<dt>Candidate</dt><dd><code>'+short(r.candidate_sha256)+'</code></dd>'+
    '<dt>Editorial</dt><dd>'+escape(r.candidate_editorial==='APPROVED_EDITORIAL'?
      'Editorial review approved':r.candidate_editorial)+'</dd>'+
    '<dt>Technical</dt><dd class="warn">'+escape(r.candidate_technical)+'</dd>'+
    '<dt>Candidate input</dt><dd>'+ (r.candidate_fresh?'CURRENT':'STALE')+'</dd>'+
    '<dt>Graph coverage</dt><dd>'+escape(r.impact.coverage==='DECLARED_DEPENDENCIES_ONLY'?
      'Declared dependencies only':r.impact.coverage)+'</dd>'+
    '<dt>Claim inventory</dt><dd>'+r.release_coverage.registered_claims+
      ' registered · '+r.release_coverage.reported_unknown+' unknown</dd>'+
    '<dt>Scenarios</dt><dd>'+r.release_coverage.registered_scenarios+
      ' registered; canonical outcome not established</dd></dl></article>';
}
function row(v){
  const status=v.status.toLowerCase();
  return '<tr><td data-label="Output"><div><strong>'+escape(v.title)+'</strong><div class="small">'+
      escape(v.format)+' / '+escape(v.target_name)+' / '+escape(v.locale)+'</div></div></td>'+
    '<td data-label="Change"><div><span class="status '+status+'">'+escape(v.status)+'</span>'+
      (v.status==='CHANGED'&&v.editorial_copy_unchanged?
        '<div class="not-proven">Editorial copy unchanged; rendered release-bound bytes changed</div>':'')+
    '</div></td><td data-label="Before"><div><code>'+short(v.previous_artifact_sha256??'—')+'</code></div></td>'+
    '<td data-label="After"><div><code>'+short(v.current_artifact_sha256??'—')+'</code></div></td></tr>';
}
export function renderContinuityReview(report,plan){
  ensure(report?.schema_version==='launchwright-release-continuity-report/1'&&
    plan?.schema_version==='launchwright-release-continuity-plan/1',
    'Review HTML requires a canonical two-release model');
  const c=report.counts;
  const styleHash=shaBase64(Buffer.from(css));
  const policy="default-src 'none'; script-src 'none'; "+
    "style-src 'sha256-"+styleHash+"'; "+
    "img-src 'none'; font-src 'none'; connect-src 'none'; "+
    "frame-src 'none'; form-action 'none'; base-uri 'none'";
  return '<!doctype html>\n<html lang="en"><head>'+
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta http-equiv="Content-Security-Policy" content="'+escape(policy)+'">'+
    '<meta name="referrer" content="no-referrer">'+
    '<title>Launchwright · Release continuity review</title><style>'+css+'</style></head>'+
    '<body><main><header><div class="kicker">Launchwright / Local private review</div>'+
    '<h1>Release continuity</h1>'+
    '<p class="desc">Compare immutable candidate outputs across two builds of one product. '+
    'A file difference is not proof of a feature change, and identical copy does not prove '+
    'identical product behavior.</p></header>'+
    '<div class="notice"><strong>Registered workspace inventory only.</strong> '+
    'Missing sources, undeclared Project Graph dependencies, technical verification and '+
    'external publication remain UNKNOWN unless independently established. This comparison '+
    'does not deploy, execute, publish or automatically reuse historical materials.</div>'+
    '<div class="grid">'+releasePanel(report.before,'HISTORICAL RELEASE')+
      releasePanel(report.after,'COMPARISON RELEASE')+'</div>'+
    '<div class="metrics">'+
      [['Changed',c.changed],['Added',c.added],['Removed',c.removed],['Unchanged',c.unchanged]]
        .map(([label,value])=>'<div class="metric"><span class="small">'+
          label+'</span><strong>'+value+'</strong></div>').join('')+
    '</div><h2>Output-by-output comparison</h2>'+
    '<div class="table-wrap"><table><thead><tr><th>Semantic slot</th>'+
    '<th>Rendered bytes</th><th>Before SHA-256</th><th>After SHA-256</th></tr></thead><tbody>'+
    report.changes.map(row).join('')+'</tbody></table></div>'+
    '<h2>What this does not certify</h2><div class="panel">'+
    '<p>No automatic copy reuse. No production behavior inference. '+
    'No customer source/capture attestation. No broad rights/privacy/semantic/accessibility PASS. '+
    'No canonical Platform Publish, host job or external channel activation.</p>'+
    '<p class="small">Input SHA-256: '+escape(plan.report_sha256)+
    '</p></div><footer><strong>DRAFT / NOT PUBLISHED.</strong> '+
    'Operator-only package; report schema '+escape(report.schema_version)+
    '. Candidate and artifact identities are pinned, but source coverage can be incomplete. '+
    'Keep the original historical release and independent receipts for audit.</footer></main></body></html>\n';
}
