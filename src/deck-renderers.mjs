// SPDX-License-Identifier: AGPL-3.0-only
// Real PPTX and PDF renderers from a shared measured slide model.
// No screenshot imitation, external service, private font or content invention.
import PptxGenJS from 'pptxgenjs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import JSZip from 'jszip';
import { requireCondition as ensure } from '@semwright/native-sdk';

const WIDTH=960,HEIGHT=540;
const COLORS={
  background:'122436',white:'FFFFFF',teal:'45D3BF',
  soft:'DDE8F1',muted:'ADC0D0'
};
const color=hex=>rgb(...[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)/255));
const xmlEscape=str=>str.replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;');

function wrap(text,font,size,maxWidth,maxLines){
  const words=text.split(/\s+/u),lines=[];
  let row='';
  for(const word of words){
    ensure(font.widthOfTextAtSize(word,size)<=maxWidth,
      'Approved word cannot fit in a slide; edit the source Markdown','ResourceExhausted');
    const next=row?row+' '+word:word;
    if(font.widthOfTextAtSize(next,size)<=maxWidth){row=next;continue;}
    if(row)lines.push(row);
    row=word;
  }
  if(row)lines.push(row);
  ensure(lines.length<=maxLines,
    'Approved text cannot fit in the slide without clipping; shorten or split source',
    'ResourceExhausted');
  return lines;
}
function presentationModel(source,sha,fonts,images=[]){
  const slides=[
    {kind:'cover',title:source.title,items:[
      {kind:'paragraph',text:'Editorial draft - human review required'},
      {kind:'paragraph',text:'Technical evidence is not upgraded by this export'}
    ]},
    ...source.sections.map((section,i)=>({kind:'content',
      title:section.title,items:section.items,
      image:images.length?images[i]:null})),
    {kind:'source',title:'Source and review',items:[
      ...source.provenance.map(text=>({kind:'paragraph',text})),
      {kind:'paragraph',text:'Frozen Markdown SHA-256: '+sha}
    ]}
  ];
  return slides.map((s,index)=>{
    const hasMaskedImage=s.kind==='content'&&!!s.image;
    const headingSize=s.kind==='cover'?37:hasMaskedImage?27:29;
    const bodySize=s.kind==='source'?13:s.kind==='cover'?18:hasMaskedImage?15:20;
    // A uniform display grid is enforced with the PDF font metrics first.
    // PPTX receives these same explicit line breaks, not independent reflow.
    const headLines=wrap(s.title,fonts.bold,headingSize,820,2);
    const items=s.items.map(item=>({...item,
      lines:wrap(item.text,fonts.normal,bodySize,
        hasMaskedImage?385:790,hasMaskedImage?3:s.kind==='source'?3:2)}));
    ensure(items.length<=7 && (s.kind==='source'||items.length<=5),
      'Source would exceed visible page limit','ResourceExhausted');
    const height=items.reduce((n,i)=>n+i.lines.length*(bodySize+10)+16,0);
    ensure(height<=(s.kind==='source'?320:s.kind==='cover'?165:hasMaskedImage?277:300),
      'Source items exceed available readable slide height','ResourceExhausted');
    return{...s,index:index+1,headLines,headingSize,bodySize,items};
  });
}
async function pdfBytes(layout,sha){
  const pdf=await PDFDocument.create();
  const fixedDate=new Date('2000-01-01T00:00:00.000Z');
  pdf.setCreationDate(fixedDate);pdf.setModificationDate(fixedDate);
  pdf.setTitle('Launchwright frozen editorial deck');
  pdf.setSubject('Private editable deck companion, not evidence of product behavior');
  pdf.setProducer('Launchwright R42 / pdf-lib 1.17.1');
  pdf.setCreator('Launchwright frozen source projection');
  const regular=await pdf.embedFont(StandardFonts.Helvetica);
  const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  for(const s of layout){
    const page=pdf.addPage([WIDTH,HEIGHT]);
    page.drawRectangle({x:0,y:0,width:WIDTH,height:HEIGHT,
      color:color(COLORS.background)});
    page.drawRectangle({x:0,y:0,width:10,height:HEIGHT,
      color:color(COLORS.teal)});
    page.drawText('LAUNCHWRIGHT  /  PRIVATE REVIEW',{
      x:63,y:HEIGHT-51,size:11,font:bold,color:color(COLORS.teal)
    });
    let y=HEIGHT-122;
    for(const h of s.headLines){
      page.drawText(h,{x:63,y,size:s.headingSize,font:bold,color:color(COLORS.white)});
      y-=s.headingSize+11;
    }
    page.drawRectangle({x:63,y:y-10,width:112,height:4,
      color:color(COLORS.teal)});
    y-=63;
    for(const item of s.items){
      item.lines.forEach((text,i)=>{
        page.drawText((item.kind==='bullet'&&i===0?'\u2022  ':'')+text,{
          x:75,y,size:s.bodySize,font:regular,color:color(COLORS.soft)
        });
        y-=s.bodySize+10;
      });
      y-=16;
    }
    if(s.image){
      const image=await pdf.embedPng(s.image.png);
      const box={x:515,y:145,w:390,h:259};
      const fit=Math.min(box.w/image.width,box.h/image.height);
      const w=image.width*fit,h=image.height*fit;
      page.drawRectangle({x:box.x-7,y:box.y-7,width:box.w+14,height:box.h+14,
        color:color('203B50')});
      page.drawImage(image,{x:box.x+(box.w-w)/2,y:box.y+(box.h-h)/2,width:w,height:h});
      page.drawText('OPERATOR-MASKED PIXELS / PRIVACY NOT VERIFIED',{
        x:box.x,y:box.y-31,size:8,font:regular,color:color(COLORS.muted)});
    }
    const footer='DRAFT / NOT PUBLISHED  |  SOURCE '+sha.slice(0,12)+
      '  |  '+s.index+'/'+layout.length;
    page.drawText(footer,{x:63,y:30,size:9,font:regular,
      color:color(COLORS.muted)});
  }
  return Buffer.from(await pdf.save({useObjectStreams:false}));
}
async function pptxBytes(layout,sha){
  const pptx=new PptxGenJS();
  pptx.layout='LAYOUT_WIDE';
  pptx.author='Launchwright R42 local export';
  pptx.subject='Exact frozen editorial copy, review required';
  pptx.title='Launchwright draft deck';
  pptx.lang='en-US';
  pptx.theme={headFontFace:'Arial',bodyFontFace:'Arial',lang:'en-US'};
  for(const s of layout){
    const slide=pptx.addSlide();
    slide.background={color:COLORS.background};
    slide.addShape(pptx.ShapeType.rect,{
      x:0,y:0,w:.13,h:7.5,
      line:{color:COLORS.teal,transparency:100},
      fill:{color:COLORS.teal}
    });
    slide.addText('LAUNCHWRIGHT  /  PRIVATE REVIEW',{
      x:.86,y:.68,w:10.8,h:.21,
      fontSize:10.5,fontFace:'Arial',bold:true,margin:0,
      color:COLORS.teal
    });
    let titleY=1.46;
    slide.addText(s.headLines.join('\n'),{
      x:.86,y:titleY,w:11.4,h:s.headLines.length*.59,
      fontSize:s.headingSize*.76,fontFace:'Arial',bold:true,
      color:COLORS.white,margin:0,breakLine:false,
      valign:'mid',fit:'shrink'
    });
    const contentStart=titleY+s.headLines.length*.59+.62;
    slide.addShape(pptx.ShapeType.rect,{
      x:.86,y:contentStart-.20,w:1.56,h:.05,
      line:{color:COLORS.teal,transparency:100},
      fill:{color:COLORS.teal}
    });
    let y=contentStart+.07;
    for(const item of s.items){
      const text=item.lines.map((line,index)=>
        (item.kind==='bullet'&&index===0?'\u2022  ':'')+line).join('\n');
      const height=item.lines.length*(s.bodySize*.76/72+.18)+.13;
      slide.addText(text,{
        x:1.02,y,w:s.image?5.25:11.18,h:height,
        fontSize:s.bodySize*.76,fontFace:'Arial',
        margin:0,color:COLORS.soft,valign:'mid',
        breakLine:false,fit:'shrink'
      });
      y+=height+.14;
    }
    if(s.image){
      const bounds={x:7.13,y:1.99,w:5.40,h:3.60};
      const fit=Math.min(bounds.w/s.image.width,bounds.h/s.image.height);
      const w=s.image.width*fit,h=s.image.height*fit;
      slide.addShape(pptx.ShapeType.rect,{x:bounds.x-.08,y:bounds.y-.08,
        w:bounds.w+.16,h:bounds.h+.16,
        line:{color:'406079',transparency:100},fill:{color:'203B50'}});
      slide.addImage({data:'image/png;base64,'+s.image.png.toString('base64'),
        x:bounds.x+(bounds.w-w)/2,y:bounds.y+(bounds.h-h)/2,w,h});
      slide.addText('OPERATOR-MASKED PIXELS / PRIVACY NOT VERIFIED',{
        x:bounds.x,y:bounds.y+bounds.h+.24,w:bounds.w,h:.20,
        fontFace:'Arial',fontSize:8.2,margin:0,color:COLORS.muted});
    }
    slide.addText('DRAFT / NOT PUBLISHED  |  SOURCE '+sha.slice(0,12)+
      '  |  '+s.index+'/'+layout.length,{
      x:.86,y:7.10,w:11.1,h:.20,
      fontSize:8.5,fontFace:'Arial',margin:0,color:COLORS.muted
    });
  }
  const output=await pptx.write({outputType:'nodebuffer',compression:true});
  // The upstream PowerPoint writer inserts current clock values into
  // docProps/core.xml and ZIP entry dates. Normalize ONLY packaging
  // timestamps so a reviewed frozen candidate always yields identical bytes.
  const zip=await JSZip.loadAsync(Buffer.from(output),{checkCRC32:true});
  const core=zip.file('docProps/core.xml');
  ensure(core,'PowerPoint archive is missing editable OOXML metadata','ProtocolMismatch');
  const xml=await core.async('string');
  const normalized=xml.replace(/<dcterms:(created|modified)[^>]*>[^<]*<\/dcterms:\1>/gu,
    '<dcterms:$1 xsi:type="dcterms:W3CDTF">2000-01-01T00:00:00Z</dcterms:$1>');
  ensure(normalized!==xml,'PowerPoint creation/modification timestamps were not recognized','ProtocolMismatch');
  zip.file('docProps/core.xml',normalized,{date:new Date('2000-01-01T00:00:00Z')});
  for(const entry of Object.values(zip.files))entry.date=new Date('2000-01-01T00:00:00Z');
  return Buffer.from(await zip.generateAsync({
    type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6},
    platform:'UNIX'
  }));
}
async function verifyOutput(pptx,pdf,layout){
  ensure(pptx.subarray(0,2).toString()==='PK'&&
    pdf.subarray(0,5).toString()==='%PDF-',
    'One requested output is not a real PPTX/PDF','ProtocolMismatch');
  const zip=await JSZip.loadAsync(pptx,{checkCRC32:true});
  const parts=Object.keys(zip.files).filter(x=>/^ppt\/slides\/slide\d+\.xml$/u.test(x));
  ensure(parts.length===layout.length,
    'Editable PowerPoint slide count differs from source','Conflict');
  for(const slide of layout){
    const xml=await zip.file('ppt/slides/slide'+slide.index+'.xml')?.async('string');
    ensure(xml?.includes(xmlEscape(slide.headLines[0]))===true,
      'A source title is missing from editable PPTX slide XML','Conflict');
    for(const item of slide.items){
      for(const line of item.lines){
        ensure(xml.includes(xmlEscape(line)),
          'An exact approved text line is absent from editable PPTX XML','Conflict');
      }
    }
  }
  const parsed=await PDFDocument.load(pdf);
  ensure(parsed.getPageCount()===layout.length,
    'PDF page count differs from the editable PowerPoint','Conflict');
}
export async function renderDeckFormats(source,sha,images=[]){
  ensure(Array.isArray(images)&&
    (images.length===0||images.length===source.sections.length),
    'A masked screenshot must be supplied for every content slide, or none',
    'InvalidArgument');
  for(const img of images)ensure(img&&Buffer.isBuffer(img.png)&&
    Number.isInteger(img.width)&&Number.isInteger(img.height)&&
    img.width>=240&&img.height>=135&&
    img.width<=3840&&img.height<=2160,
    'Deck image must be a bounded real pixel screenshot','InvalidArgument');
  const measure=await PDFDocument.create();
  const fonts={
    normal:await measure.embedFont(StandardFonts.Helvetica),
    bold:await measure.embedFont(StandardFonts.HelveticaBold)
  };
  const layout=presentationModel(source,sha,fonts,images);
  const pptx=await pptxBytes(layout,sha);
  const pdf=await pdfBytes(layout,sha);
  await verifyOutput(pptx,pdf,layout);
  return{pptx,pdf,pages:layout.length,
    titles:layout.map(s=>s.title),input_sections:source.sections.length};
}
