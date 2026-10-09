// SPDX-License-Identifier: AGPL-3.0-only
// R45: explicit, bounded Markdown -> script-free versioned HTML.
// Strict links preserve declared page identities; never silently drop sections.
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { requireCondition as ensure, NativeError } from '@semwright/native-sdk';

const sha=x=>createHash('sha256').update(x).digest('hex');
const b64=x=>createHash('sha256').update(x).digest('base64');
const escape=x=>String(x).replace(/[&<>"']/gu,ch=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[ch]);
const supportedLangs=new Set(['text','bash','sh','json','js','ts','python','rust','yaml','toml','html','css','sql']);
const fixedDate=new Date('2000-01-01T00:00:00.000Z');

function internalInline(source,validSlugs,links){
  // Reject all bracket-link syntax except a bounded local page reference.
  let remaining=source,out='';
  const token=/(\x60[^\x60\n]{1,90}\x60|\[[^\[\]\n]{1,90}\]\([^()\n]{1,128}\))/u;
  while(remaining.length){
    const match=token.exec(remaining);
    if(!match){out+=escape(remaining);break;}
    const before=remaining.slice(0,match.index);
    ensure(!/!\[|\]\(/u.test(before),'Unsupported inline image or malformed link','InvalidArgument');
    out+=escape(before);
    const part=match[0];
    if(part.startsWith('\x60')){
      out+='<code>'+escape(part.slice(1,-1))+'</code>';
    }else{
      const pos=part.indexOf(']('),label=part.slice(1,pos),href=part.slice(pos+2,-1);
      const target=/^\.\/([a-z][a-z0-9-]{1,38})\.html$/u.exec(href);
      ensure(!!target&&validSlugs.has(target[1]),
        'Documentation hyperlinks must reference declared ./slug.html pages only','InvalidArgument');
      ensure(!label.startsWith('!'),'Markdown images are not a supported source surface','InvalidArgument');
      links.add(target[1]);
      out+='<a href="'+href+'">'+escape(label)+'</a>';
    }
    remaining=remaining.slice(match.index+part.length);
  }
  ensure(!/!\[|\]\(/u.test(out),
    'Unsupported/unbalanced source Markdown link or image','InvalidArgument');
  return out;
}
export function parseStaticDocsMarkdown(bytes,validSlugs){
  ensure(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=32*1024,
    'Static docs source must be nonempty and at most 32 KiB','ResourceExhausted');
  let text;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/\r\n/gu,'\n');}
  catch{throw new NativeError('InvalidArgument','Docs source must be exact UTF-8');}
  ensure(!text.includes('\r')&&
    !/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u.test(text),
    'Invalid control bytes in source Markdown','InvalidArgument');
  const lines=text.replace(/\n+$/u,'').split('\n');
  ensure(lines.length<=240&&/^# [^\n]{2,90}$/u.test(lines[0]??''),
    'Static docs require a short leading # title and at most 240 source lines','InvalidArgument');
  const title=lines[0].slice(2);
  const blocks=[],links=new Set();
  let code=null,paragraph=[],list=null,heads=0,samples=0,sectionCount=0;
  const flushParagraph=()=>{
    if(!paragraph.length)return;
    const joined=paragraph.join(' ');
    blocks.push('<p>'+internalInline(joined,validSlugs,links)+'</p>');
    paragraph=[];
  };
  const flushList=()=>{
    if(!list)return;
    blocks.push('<'+list.kind+'>'+list.items.map(x=>
      '<li>'+internalInline(x,validSlugs,links)+'</li>').join('')+'</'+list.kind+'>');
    list=null;
  };
  for(let i=1;i<lines.length;i++){
    const raw=lines[i],line=raw.trim();
    if(code!==null){
      if(line==='~~~'){
        ensure(code.lines.length>=1&&code.lines.length<=50,'Code example must have 1–50 lines','ResourceExhausted');
        blocks.push('<pre><code data-language="'+escape(code.language)+'">'+
          escape(code.lines.join('\n'))+'</code></pre>');
        samples++;code=null;
      }else{
        ensure(raw.length<=120,'Code example line exceeds visible documentation width','ResourceExhausted');
        code.lines.push(raw);
      }
      continue;
    }
    if(/^~~~[a-z]*$/u.test(line)){
      flushParagraph();flushList();
      const lang=line.slice(3);
      ensure(supportedLangs.has(lang),'Code example language is unsupported or missing','InvalidArgument');
      code={language:lang,lines:[]};
      continue;
    }
    if(line===''){flushParagraph();flushList();continue;}
    // Canonical renderText emits a trailing "> " after its provenance
    // blockquote. Markdown treats it as an empty quoted line, not a literal
    // product-content paragraph. Ignore just that empty presentation marker.
    if(line==='>'){flushParagraph();flushList();continue;}
    if(/^> /u.test(line)){
      // Native renderText includes the declared release/build/locale as
      // blockquotes. Keep it visible, but never mistake it for runtime truth.
      flushParagraph();flushList();
      ensure(line.length<=160,'Source provenance line exceeds bounded layout','ResourceExhausted');
      blocks.push('<aside class="source-note">'+escape(line.slice(2))+'</aside>');
      continue;
    }
    if(/^#{2,3} /u.test(line)){
      flushParagraph();flushList();heads++;sectionCount++;
      ensure(sectionCount<=22&&line.length<=110,'Docs have too many/long headings','ResourceExhausted');
      const level=line.startsWith('### ')?3:2;
      const label=line.slice(level+1).trim();
      ensure(label.length>=2&&label.length<=90,'Docs heading is invalid','InvalidArgument');
      blocks.push('<h'+level+'>'+escape(label)+'</h'+level+'>');
      continue;
    }
    const bullet=/^[-*] ([^\n]+)$/u.exec(line);
    const number=/^\d+[.] ([^\n]+)$/u.exec(line);
    if(bullet||number){
      flushParagraph();
      const kind=bullet?'ul':'ol',value=(bullet??number)[1];
      ensure(value.length<=280,'Docs list item is too long','ResourceExhausted');
      if(list&&list.kind!==kind)flushList();
      if(!list)list={kind,items:[]};
      ensure(list.items.length<20,'Docs list exceeds 20 items','ResourceExhausted');
      list.items.push(value);
      continue;
    }
    ensure(!line.startsWith('#')&&!line.startsWith('~~~')&&
      !line.startsWith('<')&&!line.startsWith('|')&&line!=='---'&&
      !line.startsWith('![')&&line.length<=340,
      'Raw HTML, tables, images, unusual Markdown or overly long text are unsupported','InvalidArgument');
    flushList();
    paragraph.push(line);
    ensure(paragraph.join(' ').length<=1100,
      'Docs paragraph exceeds readable width budget','ResourceExhausted');
  }
  ensure(code===null,'Unclosed code example is not allowed','InvalidArgument');
  flushParagraph();flushList();
  ensure(blocks.length>0&&blocks.length<=150,'Documentation page has no readable content or too many blocks','InvalidArgument');
  return{title,html:blocks.join('\n'),codeSamples:samples,
    links:[...links].sort(),sections:heads,source_sha256:sha(bytes)};
}
const style=[
 ':root{color-scheme:dark;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;background:#0b1825;color:#e2eaf2;font-synthesis:none}',
 '*{box-sizing:border-box}body{margin:0;min-height:100vh}a{color:#6ee2ce;text-decoration-thickness:1px;text-underline-offset:3px}a:hover{color:#b8fff0}',
 'a:focus-visible{outline:3px solid #80eed6;outline-offset:3px}',
 '.skip{position:absolute;left:16px;top:-130px;padding:10px;background:#0d2c38;z-index:10}.skip:focus{top:8px}',
 '.layout{display:grid;grid-template-columns:242px minmax(0,1fr);max-width:1510px;margin:0 auto;min-height:100vh}',
 'aside.nav{padding:29px 17px;border-right:1px solid #33485b;background:#101e2f}',
 '.mark{font-size:12px;font-weight:750;letter-spacing:.08em;text-transform:uppercase;color:#6cd9c6}',
 '.release{font-size:12px;overflow-wrap:anywhere;color:#a9bfce;margin:12px 0 30px}',
 '.nav h2{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#c6d7e2}',
 '.nav ul{list-style:none;margin:10px 0;padding:0}.nav li{margin:3px 0}',
 '.nav a{display:block;padding:12px;border-radius:5px;text-decoration:none;color:#cddce6;overflow-wrap:anywhere}',
 '.nav a[aria-current=page]{background:#23483e;color:#b9ffec;border:1px solid #3c997e}',
 'main{min-width:0;max-width:1050px;padding:35px clamp(18px,4.5vw,70px) 70px}',
 '.eyebrow{text-transform:uppercase;font-size:12px;letter-spacing:.09em;color:#6edcc9}',
 'h1{font-size:clamp(28px,3vw,43px);line-height:1.16;margin:12px 0 24px;overflow-wrap:anywhere}',
 'h2{font-size:25px;margin:38px 0 16px}h3{font-size:19px;margin:27px 0 13px}',
 'p,li{font-size:16px;line-height:1.68;max-width:78ch}',
 'p{overflow-wrap:anywhere}.article li{margin:10px 0}.article ul,.article ol{padding-left:24px}',
 'pre{max-width:100%;overflow:auto;padding:19px;border:1px solid #365468;border-radius:7px;background:#132e40}',
 'pre code{font-family:ui-monospace,Consolas,monospace;color:#d6ebf2;font-size:14px;line-height:1.65;white-space:pre}',
 'code{font:0.88em ui-monospace,Consolas,monospace;color:#b4ffe6;overflow-wrap:anywhere}',
 '.source-note{font-size:12px;color:#9db7c6;border-left:3px solid #3d6c73;margin:5px 0;padding:7px 15px}',
 '.notice{border:1px solid #4b7382;border-radius:6px;padding:15px;color:#c3d5e2;background:#173040;font-size:13px;line-height:1.55}',
 '.version{display:inline-flex;gap:8px;flex-wrap:wrap;font:12px ui-monospace,monospace;color:#9bb9c5;margin-bottom:14px}',
 '.foot{margin-top:56px;padding-top:19px;border-top:1px solid #315066;font-size:12px;color:#9bb9c5;overflow-wrap:anywhere}',
 '@media(max-width:800px){.layout{display:block}.nav{border-right:0;border-bottom:1px solid #33485b!important;padding:15px!important}.nav ul{display:flex;flex-wrap:wrap;gap:4px}.nav a{padding:9px!important}main{padding:25px 18px 60px}}',
 '@media(prefers-reduced-motion:reduce){*,*:before,*:after{scroll-behavior:auto!important}}'
].join('\n');

function htmlPage({title,body,pages,current,release,build,shaValue,locale}){
  const navigation=pages.map(p=>
    '<li><a href="./'+p.slug+'.html"'+
    (p.slug===current?' aria-current="page"':'')+'>'+
    escape(p.title)+'</a></li>').join('');
  const cssSha=b64(Buffer.from(style,'utf8'));
  const policy="default-src 'none'; script-src 'none'; "+
    "connect-src 'none'; base-uri 'none'; form-action 'none'; "+
    "style-src 'sha256-"+cssSha+"'; font-src 'none'; "+
    "img-src 'none'; frame-src 'none'; object-src 'none'";
  const rtl=/^(?:ar|he|fa|ur)(?:-|$)/u.test(locale);
  return Buffer.from(
    '<!doctype html>\n<html lang="'+escape(locale)+'" dir="'+(rtl?'rtl':'ltr')+
    '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta http-equiv="Content-Security-Policy" content="'+escape(policy)+'">'+
    '<meta name="referrer" content="no-referrer">'+
    '<title>'+escape(title)+' · Documentation</title><style>'+style+'</style></head><body>'+
    '<a class="skip" href="#main-content">Skip to documentation</a>'+
    '<div class="layout"><aside class="nav"><div class="mark">Launchwright · Private docs</div>'+
    '<p class="release">Release '+escape(release)+' · Build '+escape(build)+'</p>'+
    '<nav aria-label="Documentation sections"><h2>Contents</h2><ul>'+
    '<li><a href="./index.html"'+(current==='index'?' aria-current="page"':'')+
    '>Overview</a></li>'+navigation+'</ul></nav></aside>'+
    '<main id="main-content" tabindex="-1"><div class="eyebrow">Version-bound · Editorial draft</div>'+
    '<h1>'+escape(title)+'</h1>'+
    '<div class="version"><span>Build '+escape(build)+'</span><span>Source '+escape(shaValue.slice(0,14))+'</span></div>'+
    '<div class="notice"><strong>Technical UNKNOWN · Not published.</strong> '+
    'This site represents editorially approved source text, not verified customer-product behavior. '+
    'All code samples are inert text. No network, scripts or deployment.</div>'+
    '<article class="article">'+body+'</article>'+
    '<footer class="foot">PRIVATE EDITORIAL / NOT PUBLISHED · Frozen candidate '+escape(shaValue)+
    ' · No external resources or runtime capture acceptance.</footer></main></div></body></html>\n',
    'utf8'
  );
}
export async function renderStaticDocs(pages,context){
  ensure(Array.isArray(pages)&&pages.length>=2&&pages.length<=12,
    'Docs site requires 2–12 linked editorial pages','InvalidArgument');
  const slugs=new Set(pages.map(p=>p.slug));
  ensure(slugs.size===pages.length&&!slugs.has('index')&&
    pages.every(p=>typeof p.slug==='string'&&
      /^[a-z][a-z0-9-]{1,38}$/u.test(p.slug)&&!p.slug.endsWith('-')),
    'Duplicate/reserved or unsafe documentation slug','Conflict');
  const parsed=pages.map(p=>({
    ...p,parsed:parseStaticDocsMarkdown(p.bytes,slugs)
  }));
  const allLinks=[...new Set(parsed.flatMap(x=>x.parsed.links))];
  const examples=parsed.reduce((n,p)=>n+p.parsed.codeSamples,0);
  ensure(allLinks.length>=1&&examples>=1,
    'Complete static docs require at least one internal source link and one inert code example','InvalidArgument');
  const catalog=parsed.map(p=>({slug:p.slug,title:p.parsed.title}));
  const rootBody='<p>This is a private documentation snapshot of a single frozen Release. '+
    'Select a page in the navigation; all links stay inside this archive.</p>'+
    '<ul>'+catalog.map(p=>'<li><a href="./'+p.slug+'.html">'+escape(p.title)+
    '</a></li>').join('')+'</ul>';
  const generated=[
    {name:'index.html',bytes:htmlPage({
      title:'Documentation overview',body:rootBody,pages:catalog,current:'index',...context
    })}
  ];
  for(const p of parsed){
    generated.push({name:p.slug+'.html',bytes:htmlPage({
      title:p.parsed.title,body:p.parsed.html,pages:catalog,current:p.slug,
      ...context
    })});
  }
  const manifest={
    schema_version:'launchwright-static-docs-site/1',
    release_id:context.release_id,release_version:context.release_version,
    release_build:context.build,candidate_id:context.candidate_id,
    candidate_sha256:context.shaValue,locale:context.locale,
    pages:parsed.map(p=>({slug:p.slug,title:p.parsed.title,
      source_artifact_id:p.artifact_id,source_sha256:p.parsed.source_sha256,
      links:p.parsed.links,code_samples:p.parsed.codeSamples})),
    links_verified:true,code_samples_inert:true,script_execution_allowed:false,
    internet_required:false,source_application_executed:false,
    technical_state:context.technical_state,
    customer_acceptance:false,platform_publish_authority:false,
    published:false,
    files:Object.fromEntries(generated.map(p=>[p.name,{sha256:sha(p.bytes),bytes:p.bytes.length}]))
  };
  generated.push({name:'manifest.json',bytes:Buffer.from(JSON.stringify(manifest,null,2)+'\n')});
  const zip=new JSZip(),epoch=new Date('2000-01-01T00:00:00.000Z');
  for(const file of generated){
    ensure(file.bytes.length<=300*1024,'One HTML document exceeds the bounded site limit','ResourceExhausted');
    zip.file(file.name,file.bytes,{date:epoch,unixPermissions:'0600'});
  }
  const bytes=Buffer.from(await zip.generateAsync({
    type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6},platform:'UNIX'
  }));
  ensure(bytes.length<=3*1024*1024,'Static docs archive exceeds 3 MiB','ResourceExhausted');
  const check=await JSZip.loadAsync(bytes,{checkCRC32:true});
  ensure(Object.keys(check.files).length===generated.length,'Site archive has unexpected files','Conflict');
  for(const f of generated){
    const same=await check.file(f.name)?.async('nodebuffer');
    ensure(same?.equals(f.bytes),'Archived documentation bytes differ from reviewed source','Conflict');
  }
  return{bytes,manifest,zip_sha256:sha(bytes),page_count:pages.length+1};
}
