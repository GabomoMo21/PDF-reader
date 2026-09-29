import { useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { exportEditedPdf, mergePdfBytes, readFormFields, replacePdfPagesWithPng } from './pdf'
import type {
  Annotation,
  ChartSeries,
  ChartType,
  ExistingTextItem,
  FormEditValue,
  FormFieldInfo,
  PageState,
  Point,
  Rect,
  ToolMode,
} from './types'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

const uid = () => crypto.randomUUID()
const clone = <T,>(value: T): T => structuredClone(value)
const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n))

function downloadBytes(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function rectFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x,b.x), y: Math.min(a.y,b.y), width: Math.abs(a.x-b.x), height: Math.abs(a.y-b.y) }
}

function parseNumber(value: string) {
  const clean = value.trim().replace(/\s/g,'').replace(/[$€£₡%]/g,'')
  const normalized = /^-?\d{1,3}(\.\d{3})*,\d+$/.test(clean)
    ? clean.replace(/\./g,'').replace(',','.')
    : /^-?\d{1,3}(,\d{3})*\.\d+$/.test(clean)
      ? clean.replace(/,/g,'')
      : clean.replace(',','.')
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

function parseChartTable(raw: string): { labels: string[]; series: ChartSeries[] } {
  const lines = raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean)
  if (lines.length < 2) throw new Error('Necesitas al menos dos filas de datos.')
  const delimiter = raw.includes('\t') ? '\t' : raw.includes(';') ? ';' : ','
  const rows = lines.map(line => line.split(delimiter).map(cell=>cell.trim()))
  const width = Math.max(...rows.map(r=>r.length))
  if (width < 2) throw new Error('Usa una columna de etiquetas y al menos una columna numérica.')
  rows.forEach(r=>{ while(r.length<width) r.push('') })

  const firstData = rows[0].slice(1).map(parseNumber)
  const hasHeader = firstData.some(v=>v===null)
  const headers = hasHeader ? rows.shift()! : ['Categoría', ...Array.from({length:width-1},(_,i)=>`Serie ${i+1}`)]
  const labels: string[] = []
  const values = Array.from({length:width-1},()=>[] as number[])
  for (const row of rows) {
    const nums = row.slice(1).map(parseNumber)
    if (nums.every(n=>n===null)) continue
    labels.push(row[0] || `Fila ${labels.length+1}`)
    nums.forEach((n,i)=>values[i].push(n ?? 0))
  }
  if (!labels.length) throw new Error('No encontré valores numéricos utilizables.')
  const series = values.map((v,i)=>({name: headers[i+1] || `Serie ${i+1}`, values:v}))
  return {labels,series}
}

function makeChartDataUrl(type: ChartType, title: string, labels: string[], series: ChartSeries[]) {
  const canvas = document.createElement('canvas')
  canvas.width = 1200; canvas.height = 700
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height)
  ctx.fillStyle = '#15171b'; ctx.font = '700 34px Segoe UI, sans-serif'; ctx.textAlign='left'
  ctx.fillText(title || 'Gráfico', 72, 62)
  const palette = ['#4472c4','#ed7d31','#70ad47','#ffc000','#5b9bd5','#a5a5a5']
  const left=95, right=55, top=120, bottom=110, w=canvas.width-left-right, h=canvas.height-top-bottom

  if (type === 'pie') {
    const vals=series[0].values.map(v=>Math.max(0,v)); const total=vals.reduce((a,b)=>a+b,0) || 1
    const cx=430, cy=385, r=220; let angle=-Math.PI/2
    vals.forEach((v,i)=>{ const next=angle+(v/total)*Math.PI*2; ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,r,angle,next); ctx.closePath(); ctx.fillStyle=palette[i%palette.length]; ctx.fill(); angle=next })
    ctx.font='24px Segoe UI, sans-serif'; ctx.textAlign='left'
    labels.forEach((label,i)=>{ const y=180+i*46; if(y>620) return; ctx.fillStyle=palette[i%palette.length]; ctx.fillRect(740,y-19,25,25); ctx.fillStyle='#202329'; ctx.fillText(`${label}  ${series[0].values[i] ?? 0}`,780,y) })
  } else {
    const all=series.flatMap(s=>s.values); let min=Math.min(0,...all), max=Math.max(0,...all)
    if (max===min) max=min+1
    const range=max-min
    ctx.strokeStyle='#d8dce3'; ctx.lineWidth=1; ctx.font='18px Segoe UI, sans-serif'; ctx.fillStyle='#5d6570'
    for(let i=0;i<=5;i++){ const y=top+h-(i/5)*h; ctx.beginPath(); ctx.moveTo(left,y); ctx.lineTo(left+w,y); ctx.stroke(); const val=min+(i/5)*range; ctx.textAlign='right'; ctx.fillText(Number(val.toFixed(2)).toString(),left-14,y+6) }
    const zeroY=top+h-((0-min)/range)*h
    ctx.strokeStyle='#747b86'; ctx.beginPath(); ctx.moveTo(left,zeroY);ctx.lineTo(left+w,zeroY);ctx.stroke()
    const groupW=w/Math.max(1,labels.length)
    if(type==='bar'){
      const barW=Math.max(5,Math.min(70,groupW*.72/series.length))
      labels.forEach((label,i)=>{
        series.forEach((s,j)=>{ const v=s.values[i]??0; const y=top+h-((v-min)/range)*h; const x=left+i*groupW+(groupW-series.length*barW)/2+j*barW; ctx.fillStyle=palette[j%palette.length]; ctx.fillRect(x,Math.min(y,zeroY),barW-3,Math.abs(zeroY-y)) })
        ctx.save();ctx.translate(left+i*groupW+groupW/2,top+h+24);ctx.rotate(-.42);ctx.textAlign='right';ctx.fillStyle='#4d535c';ctx.font='17px Segoe UI, sans-serif';ctx.fillText(label.slice(0,24),0,0);ctx.restore()
      })
    } else {
      series.forEach((s,j)=>{ ctx.strokeStyle=palette[j%palette.length];ctx.fillStyle=palette[j%palette.length];ctx.lineWidth=4;ctx.beginPath(); s.values.forEach((v,i)=>{ const x=left+(labels.length===1?.5:i/(labels.length-1))*w; const y=top+h-((v-min)/range)*h; if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y) });ctx.stroke(); s.values.forEach((v,i)=>{ const x=left+(labels.length===1?.5:i/(labels.length-1))*w; const y=top+h-((v-min)/range)*h;ctx.beginPath();ctx.arc(x,y,6,0,Math.PI*2);ctx.fill() }) })
      labels.forEach((label,i)=>{ const x=left+(labels.length===1?.5:i/(labels.length-1))*w;ctx.save();ctx.translate(x,top+h+24);ctx.rotate(-.42);ctx.textAlign='right';ctx.fillStyle='#4d535c';ctx.font='17px Segoe UI, sans-serif';ctx.fillText(label.slice(0,24),0,0);ctx.restore() })
    }
    ctx.font='18px Segoe UI, sans-serif'; let lx=left
    series.forEach((s,j)=>{ctx.fillStyle=palette[j%palette.length];ctx.fillRect(lx,84,20,20);ctx.fillStyle='#343941';ctx.textAlign='left';ctx.fillText(s.name,lx+28,101);lx+=Math.min(260,70+s.name.length*10)})
  }
  return canvas.toDataURL('image/png')
}

function detectTabularText(items: ExistingTextItem[]) {
  if (!items.length) return ''
  const sorted=[...items].sort((a,b)=>a.y-b.y || a.x-b.x)
  const rows: ExistingTextItem[][]=[]
  for(const item of sorted){
    let row=rows.find(r=>Math.abs((r[0]?.y??0)-item.y)<Math.max(5,item.fontSize*.55))
    if(!row){row=[];rows.push(row)}
    row.push(item)
  }
  const rendered:string[]=[]
  for(const row of rows){
    row.sort((a,b)=>a.x-b.x)
    const cells:string[]=[]; let current=''; let end=-Infinity
    for(const item of row){
      const gap=item.x-end
      if(current && gap>Math.max(24,item.fontSize*1.8)){cells.push(current.trim());current=item.text}
      else current += (current?' ':'')+item.text
      end=item.x+item.width
    }
    if(current)cells.push(current.trim())
    if(cells.length>=2) rendered.push(cells.join('\t'))
  }
  const numericRows=rendered.filter(line=>line.split('\t').slice(1).some(c=>parseNumber(c)!==null))
  if(!numericRows.length) return rendered.slice(0,12).join('\n')
  const firstNumericIndex=rendered.findIndex(r=>numericRows.includes(r))
  const result=firstNumericIndex>0 ? [rendered[firstNumericIndex-1],...numericRows] : numericRows
  return result.slice(0,30).join('\n')
}

export default function App() {
  const fileInputRef=useRef<HTMLInputElement>(null), combineInputRef=useRef<HTMLInputElement>(null), imageInputRef=useRef<HTMLInputElement>(null)
  const canvasRef=useRef<HTMLCanvasElement>(null), pageHostRef=useRef<HTMLDivElement>(null)
  const [fileName,setFileName]=useState(''), [sourceBytes,setSourceBytes]=useState<Uint8Array|null>(null), [pdf,setPdf]=useState<pdfjsLib.PDFDocumentProxy|null>(null)
  const [pages,setPages]=useState<PageState[]>([]), [past,setPast]=useState<PageState[][]>([]), [future,setFuture]=useState<PageState[][]>([])
  const [pageIndex,setPageIndex]=useState(0), [tool,setTool]=useState<ToolMode>('select'), [zoom,setZoom]=useState(1.15)
  const [viewportSize,setViewportSize]=useState({width:1,height:1}), [drawing,setDrawing]=useState<Point[]|null>(null), [dragStart,setDragStart]=useState<Point|null>(null), [dragRect,setDragRect]=useState<Rect|null>(null)
  const [textItems,setTextItems]=useState<ExistingTextItem[]>([]), [pendingImage,setPendingImage]=useState<{dataUrl:string;mime:'image/png'|'image/jpeg';ratio:number}|null>(null)
  const [status,setStatus]=useState('Abre un PDF para comenzar'), [formFields,setFormFields]=useState<FormFieldInfo[]>([]), [formEdits,setFormEdits]=useState<Record<string,FormEditValue>>({})
  const [showForms,setShowForms]=useState(false), [showInfo,setShowInfo]=useState(false), [showSplit,setShowSplit]=useState(false), [splitSpec,setSplitSpec]=useState('1-3; 4-6')
  const [showChart,setShowChart]=useState(false), [chartType,setChartType]=useState<ChartType>('bar'), [chartTitle,setChartTitle]=useState(''), [chartData,setChartData]=useState('Categoría\tValor\nA\t10\nB\t18\nC\t12')
  const [selectedId,setSelectedId]=useState<string|null>(null)
  const [objectDrag,setObjectDrag]=useState<{id:string;mode:'move'|'resize';start:Point;original:Annotation;before:PageState[];changed:boolean}|null>(null)
  const currentPage=pages[pageIndex]

  const commitPages=(next:PageState[]|((old:PageState[])=>PageState[]))=>{
    const result=typeof next==='function' ? next(pages) : next
    setPast(h=>[...h,clone(pages)].slice(-60)); setFuture([]); setPages(result)
  }
  const updateCurrentPage=(updater:(page:PageState)=>PageState)=>commitPages(old=>old.map((p,i)=>i===pageIndex?updater(p):p))

  useEffect(()=>{
    if(!pdf||!currentPage||!canvasRef.current)return
    let cancelled=false
    ;(async()=>{
      const page=await pdf.getPage(currentPage.sourceIndex+1); const viewport=page.getViewport({scale:zoom,rotation:(page.rotate||0)+currentPage.rotationDelta})
      if(cancelled||!canvasRef.current)return
      const canvas=canvasRef.current, ratio=window.devicePixelRatio||1
      canvas.width=Math.floor(viewport.width*ratio);canvas.height=Math.floor(viewport.height*ratio);canvas.style.width=`${viewport.width}px`;canvas.style.height=`${viewport.height}px`
      const ctx=canvas.getContext('2d')!;await page.render({canvasContext:ctx,viewport,transform:ratio===1?undefined:[ratio,0,0,ratio,0,0]}).promise
      const content=await page.getTextContent();const items:ExistingTextItem[]=[]
      content.items.forEach((raw,index)=>{if(!('str'in raw)||!raw.str.trim())return;const tx=pdfjsLib.Util.transform(viewport.transform,raw.transform);const fontSize=Math.max(6,Math.hypot(tx[2],tx[3]));const width=Math.max(2,raw.width*zoom),height=Math.max(fontSize,raw.height*zoom||fontSize);items.push({key:`${currentPage.sourceIndex}-${index}`,text:raw.str,x:tx[4],y:tx[5]-height,width,height,fontSize})})
      if(!cancelled){setViewportSize({width:viewport.width,height:viewport.height});setTextItems(items)}
    })().catch(e=>{console.error(e);setStatus('No se pudo renderizar esta página')})
    return()=>{cancelled=true}
  },[pdf,currentPage?.sourceIndex,currentPage?.rotationDelta,pageIndex,zoom])

  useEffect(()=>{setSelectedId(null)},[pageIndex])
  useEffect(()=>{
    const handler=(e:KeyboardEvent)=>{
      const target=e.target as HTMLElement|null
      if(target && ['INPUT','TEXTAREA','SELECT'].includes(target.tagName))return
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo()}
      else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo()}
      else if((e.key==='Delete'||e.key==='Backspace')&&selectedId){e.preventDefault();deleteSelected()}
    }
    window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler)
  })

  const openFile=async(file:File)=>{
    try{setStatus('Abriendo PDF…');const bytes=new Uint8Array(await file.arrayBuffer());const loaded=await pdfjsLib.getDocument({data:bytes.slice()}).promise
      const initialPages=Array.from({length:loaded.numPages},(_,i)=>({id:uid(),sourceIndex:i,rotationDelta:0,annotations:[]} as PageState));const fields=await readFormFields(bytes)
      setFileName(file.name);setSourceBytes(bytes);setPdf(loaded);setPages(initialPages);setPast([]);setFuture([]);setPageIndex(0);setSelectedId(null);setFormFields(fields);setFormEdits(Object.fromEntries(fields.map(f=>[f.name,f.value])));setStatus(`${loaded.numPages} página${loaded.numPages===1?'':'s'}${fields.length?` · ${fields.length} campos de formulario`:''}`)
    }catch(e){console.error(e);setStatus('No se pudo abrir el PDF')}
  }

  const undo=()=>{if(!past.length)return;const prev=past[past.length-1];setFuture(f=>[clone(pages),...f].slice(0,60));setPast(p=>p.slice(0,-1));setPages(clone(prev));setSelectedId(null)}
  const redo=()=>{if(!future.length)return;const next=future[0];setPast(p=>[...p,clone(pages)].slice(-60));setFuture(f=>f.slice(1));setPages(clone(next));setSelectedId(null)}
  const rotate=()=>updateCurrentPage(p=>({...p,rotationDelta:(p.rotationDelta+90)%360}))
  const removeCurrent=()=>{if(pages.length<=1)return;commitPages(pages.filter((_,i)=>i!==pageIndex));setPageIndex(i=>Math.max(0,Math.min(i,pages.length-2)))}
  const duplicateCurrent=()=>{if(!currentPage)return;const cp:PageState={...clone(currentPage),id:uid(),annotations:currentPage.annotations.map(a=>({...clone(a),id:uid()}))};commitPages([...pages.slice(0,pageIndex+1),cp,...pages.slice(pageIndex+1)]);setPageIndex(pageIndex+1)}
  const movePage=(d:-1|1)=>{const target=pageIndex+d;if(target<0||target>=pages.length)return;const cp=[...pages];[cp[pageIndex],cp[target]]=[cp[target],cp[pageIndex]];commitPages(cp);setPageIndex(target)}
  const normalizedPoint=(event:{clientX:number;clientY:number}):Point=>{const r=pageHostRef.current!.getBoundingClientRect();return{x:clamp((event.clientX-r.left)/r.width),y:clamp((event.clientY-r.top)/r.height)}}

  const onPointerDown=(event:React.PointerEvent)=>{
    if(!currentPage||tool==='editText')return
    if(tool==='select'){setSelectedId(null);return}
    const p=normalizedPoint(event)
    if(tool==='text'){const text=window.prompt('Texto a insertar:');if(!text?.trim())return;updateCurrentPage(pg=>({...pg,annotations:[...pg.annotations,{id:uid(),kind:'text',x:p.x,y:p.y,text:text.trim(),size:16}]}));setTool('select')}
    else if(tool==='draw'){event.currentTarget.setPointerCapture(event.pointerId);setDrawing([p])}
    else if(tool==='highlight'||tool==='redact'){event.currentTarget.setPointerCapture(event.pointerId);setDragStart(p);setDragRect({x:p.x,y:p.y,width:0,height:0})}
    else if(tool==='image'){if(!pendingImage){imageInputRef.current?.click();return}const width=.28,height=Math.min(.4,width/Math.max(.15,pendingImage.ratio)*(viewportSize.width/viewportSize.height));updateCurrentPage(pg=>({...pg,annotations:[...pg.annotations,{id:uid(),kind:'image',x:Math.min(p.x,1-width),y:Math.min(p.y,1-height),width,height,dataUrl:pendingImage.dataUrl,mime:pendingImage.mime}]}));setPendingImage(null);setTool('select')}
  }
  const onPointerMove=(event:React.PointerEvent)=>{
    if(objectDrag){
      const p=normalizedPoint(event),dx=p.x-objectDrag.start.x,dy=p.y-objectDrag.start.y, original=objectDrag.original
      setPages(old=>old.map((pg,i)=>i!==pageIndex?pg:{...pg,annotations:pg.annotations.map(a=>{
        if(a.id!==objectDrag.id)return a
        if(objectDrag.mode==='move'){
          if(original.kind==='stroke')return{...original,points:original.points.map(pt=>({x:clamp(pt.x+dx),y:clamp(pt.y+dy)}))}
          if('x'in original&&'y'in original){const ow='width'in original?original.width:0,oh='height'in original?original.height:0;return{...original,x:clamp(original.x+dx,0,1-ow),y:clamp(original.y+dy,0,1-oh)} as Annotation}
        }else if('x'in original&&'y'in original&&'width'in original&&'height'in original){return{...original,width:clamp(original.width+dx,.02,1-original.x),height:clamp(original.height+dy,.02,1-original.y)} as Annotation}
        return a
      })}))
      setObjectDrag(d=>d?{...d,changed:true}:d);return
    }
    if(tool==='draw'&&drawing)setDrawing(v=>v?[...v,normalizedPoint(event)]:null)
    else if((tool==='highlight'||tool==='redact')&&dragStart)setDragRect(rectFromPoints(dragStart,normalizedPoint(event)))
  }
  const finishPointerAction=()=>{
    if(objectDrag){if(objectDrag.changed){setPast(h=>[...h,objectDrag.before].slice(-60));setFuture([])}setObjectDrag(null);return}
    if(drawing){if(drawing.length>=2)updateCurrentPage(pg=>({...pg,annotations:[...pg.annotations,{id:uid(),kind:'stroke',points:drawing,width:2}]}));setDrawing(null)}
    if(dragStart&&dragRect&&dragRect.width>.003&&dragRect.height>.003&&(tool==='highlight'||tool==='redact')){const kind=tool;updateCurrentPage(pg=>({...pg,annotations:[...pg.annotations,{id:uid(),kind,...dragRect}]}));if(kind==='redact')setStatus('Redacción marcada. Al guardar, esta página se aplanará para eliminar el contenido subyacente.')}setDragStart(null);setDragRect(null)
  }

  const startObjectDrag=(e:React.PointerEvent,id:string,mode:'move'|'resize')=>{if(tool!=='select')return;e.stopPropagation();const a=currentPage?.annotations.find(x=>x.id===id);if(!a)return;setSelectedId(id);(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);setObjectDrag({id,mode,start:normalizedPoint(e),original:clone(a),before:clone(pages),changed:false})}
  const deleteSelected=()=>{if(!selectedId)return;updateCurrentPage(pg=>({...pg,annotations:pg.annotations.filter(a=>a.id!==selectedId)}));setSelectedId(null)}

  const editExistingText=(item:ExistingTextItem)=>{const existing=currentPage?.annotations.find(a=>a.kind==='replaceText'&&a.sourceKey===item.key);const original=existing?.kind==='replaceText'?existing.text:item.text;const replacement=window.prompt('Editar texto (déjalo vacío para ocultarlo):',original);if(replacement===null)return;const normalized={x:item.x/viewportSize.width,y:item.y/viewportSize.height,width:item.width/viewportSize.width,height:item.height/viewportSize.height};const pdfFontSize=Math.max(5,item.fontSize/zoom);updateCurrentPage(pg=>({...pg,annotations:[...pg.annotations.filter(a=>!(a.kind==='replaceText'&&a.sourceKey===item.key)),{id:uid(),kind:'replaceText',sourceKey:item.key,...normalized,text:replacement,size:pdfFontSize}]}))}

  const secureRedactions=async(bytes:Uint8Array,states:PageState[])=>{
    const targets=states.map((p,i)=>p.annotations.some(a=>a.kind==='redact')?i:-1).filter(i=>i>=0)
    if(!targets.length)return bytes
    setStatus(`Aplicando redacción segura en ${targets.length} página${targets.length===1?'':'s'}…`)
    const edited=await pdfjsLib.getDocument({data:bytes.slice()}).promise;const replacements=new Map<number,string>()
    for(const i of targets){const page=await edited.getPage(i+1);const viewport=page.getViewport({scale:2.2});const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);const ctx=canvas.getContext('2d')!;await page.render({canvasContext:ctx,viewport}).promise;replacements.set(i,canvas.toDataURL('image/png'))}
    return replacePdfPagesWithPng(bytes,replacements)
  }
  const exportStates=async(states:PageState[])=>{if(!sourceBytes)throw new Error('Sin PDF');const raw=await exportEditedPdf(sourceBytes,states,formEdits);return secureRedactions(raw,states)}
  const save=async()=>{if(!sourceBytes||!pages.length)return;try{setStatus('Generando PDF…');const bytes=await exportStates(pages);downloadBytes(bytes,fileName.replace(/\.pdf$/i,'')+'-editado.pdf');setStatus(pages.some(p=>p.annotations.some(a=>a.kind==='redact'))?'PDF guardado · redacciones aplanadas de forma segura':'PDF guardado')}catch(e){console.error(e);setStatus('Error al guardar')}}
  const extractCurrent=async()=>{if(!currentPage)return;try{const bytes=await exportStates([currentPage]);downloadBytes(bytes,`${fileName.replace(/\.pdf$/i,'')}-pagina-${pageIndex+1}.pdf`);setStatus(`Página ${pageIndex+1} extraída`)}catch(e){console.error(e);setStatus('No se pudo extraer la página')}}

  const parseRangeGroup=(part:string)=>{const indices:number[]=[];for(const token of part.split(',').map(x=>x.trim()).filter(Boolean)){const m=token.match(/^(\d+)\s*-\s*(\d+)$/);if(m){const a=+m[1],b=+m[2],step=a<=b?1:-1;for(let n=a;;n+=step){if(n>=1&&n<=pages.length&&!indices.includes(n-1))indices.push(n-1);if(n===b)break}}else if(/^\d+$/.test(token)){const n=+token;if(n>=1&&n<=pages.length&&!indices.includes(n-1))indices.push(n-1)}}return indices}
  const splitPdf=async()=>{const groups=splitSpec.split(/[;\n]+/).map(x=>x.trim()).filter(Boolean);if(!groups.length){setStatus('Escribe al menos un rango');return}try{setShowSplit(false);for(let i=0;i<groups.length;i++){const idx=parseRangeGroup(groups[i]);if(!idx.length)continue;const states=idx.map(n=>pages[n]);const bytes=await exportStates(states);downloadBytes(bytes,`${fileName.replace(/\.pdf$/i,'')}-parte-${i+1}.pdf`);await new Promise(r=>setTimeout(r,120))}setStatus(`${groups.length} parte${groups.length===1?'':'s'} generada${groups.length===1?'':'s'}`)}catch(e){console.error(e);setStatus('No se pudo dividir el PDF')}}

  const combineFiles=async(files:FileList|null)=>{if(!files?.length)return;try{setStatus('Combinando PDFs…');const docs:Uint8Array[]=[];if(sourceBytes)docs.push(sourceBytes);for(const file of Array.from(files))docs.push(new Uint8Array(await file.arrayBuffer()));const merged=await mergePdfBytes(docs);await openFile(new File([merged],'PDF-combinado.pdf',{type:'application/pdf'}));setStatus(`${docs.length} documentos combinados · revisa y guarda cuando quieras`)}catch(e){console.error(e);setStatus('No se pudieron combinar los PDFs')}finally{if(combineInputRef.current)combineInputRef.current.value=''}}
  const loadPendingImage=(file?:File)=>{if(!file)return;if(!['image/png','image/jpeg'].includes(file.type)){setStatus('Por ahora las imágenes deben ser PNG o JPG');return}const reader=new FileReader();reader.onload=()=>{const dataUrl=String(reader.result),img=new Image();img.onload=()=>{setPendingImage({dataUrl,mime:file.type as 'image/png'|'image/jpeg',ratio:img.width/img.height});setTool('image');setStatus('Haz clic sobre la página para colocar la imagen')};img.src=dataUrl};reader.readAsDataURL(file)}

  const createChart=()=>{try{const {labels,series}=parseChartTable(chartData);const dataUrl=makeChartDataUrl(chartType,chartTitle,labels,series);const width=.62,height=.38;updateCurrentPage(pg=>({...pg,annotations:[...pg.annotations,{id:uid(),kind:'chart',x:.19,y:.25,width,height,dataUrl,chartType,title:chartTitle||'Gráfico',labels,series}]}));setShowChart(false);setTool('select');setStatus('Gráfico insertado. Puedes moverlo y redimensionarlo con el cursor.')}catch(e){setStatus(e instanceof Error?e.message:'No se pudo crear el gráfico')}}
  const detectTable=()=>{const detected=detectTabularText(textItems);if(!detected){setStatus('No detecté una tabla clara en esta página');return}setChartData(detected);setStatus('Datos de la página cargados. Revísalos antes de insertar el gráfico.')}

  const setToolAndStatus=(next:ToolMode)=>{setTool(next);setSelectedId(null);if(next==='editText')setStatus('Haz clic sobre un bloque de texto existente para reemplazarlo');else if(next==='highlight')setStatus('Arrastra sobre el área que quieres resaltar');else if(next==='draw')setStatus('Dibuja directamente sobre el documento. También sirve para una firma rápida.');else if(next==='redact')setStatus('Arrastra sobre lo que quieras eliminar. Al guardar, las páginas redactadas se rasterizan para quitar el contenido original.');else if(next==='image')imageInputRef.current?.click();else setStatus('Cursor: selecciona objetos para moverlos, redimensionarlos o eliminarlos.')}

  const strokeElements=useMemo(()=>{if(!currentPage)return null;const strokes=currentPage.annotations.filter(a=>a.kind==='stroke');const all=drawing?[...strokes,{id:'preview',kind:'stroke' as const,points:drawing,width:2}]:strokes;return all.map(a=><polyline key={a.id} points={a.points.map(p=>`${p.x*viewportSize.width},${p.y*viewportSize.height}`).join(' ')} fill="none" stroke="currentColor" strokeWidth={a.width*zoom} strokeLinecap="round" strokeLinejoin="round" className={tool==='select'&&a.id!=='preview'?`stroke-object ${selectedId===a.id?'selected':''}`:''} onPointerDown={tool==='select'&&a.id!=='preview'?(e)=>startObjectDrag(e,a.id,'move'):undefined}/> )},[currentPage,drawing,viewportSize,zoom,tool,selectedId])

  const annotationElements=useMemo(()=>{if(!currentPage)return null;return currentPage.annotations.map(a=>{
    const selected=selectedId===a.id, common={onPointerDown:(e:React.PointerEvent)=>startObjectDrag(e,a.id,'move')}
    if(a.kind==='stroke')return null
    let node:React.ReactNode=null
    if(a.kind==='text')node=<div className={`text-annotation object ${selected?'selected':''}`} style={{left:a.x*viewportSize.width,top:a.y*viewportSize.height,fontSize:a.size*zoom}} {...common}>{a.text}</div>
    else if(a.kind==='replaceText')node=<div className={`replacement-annotation object ${selected?'selected':''}`} style={{left:a.x*viewportSize.width-1,top:a.y*viewportSize.height-1,width:a.width*viewportSize.width+2,minHeight:a.height*viewportSize.height+2,fontSize:a.size*zoom}} {...common}>{a.text}</div>
    else if(a.kind==='highlight'||a.kind==='redact')node=<div className={`rect-annotation ${a.kind} object ${selected?'selected':''}`} style={{left:a.x*viewportSize.width,top:a.y*viewportSize.height,width:a.width*viewportSize.width,height:a.height*viewportSize.height}} {...common}/>
    else if(a.kind==='image'||a.kind==='chart')node=<img className={`image-annotation object ${a.kind==='chart'?'chart-object':''} ${selected?'selected':''}`} src={a.dataUrl} alt={a.kind==='chart'?a.title:''} style={{left:a.x*viewportSize.width,top:a.y*viewportSize.height,width:a.width*viewportSize.width,height:a.height*viewportSize.height}} {...common}/>
    const canResize='width'in a&&'height'in a
    return <div key={a.id}>{node}{selected&&canResize&&<button className="resize-handle" title="Redimensionar" style={{left:(a.x+a.width)*viewportSize.width-7,top:(a.y+a.height)*viewportSize.height-7}} onPointerDown={e=>startObjectDrag(e,a.id,'resize')}/>}</div>
  })},[currentPage,viewportSize,zoom,selectedId,tool])

  const currentDragElement=dragRect&&(tool==='highlight'||tool==='redact')?<div className={`rect-annotation ${tool} preview`} style={{left:dragRect.x*viewportSize.width,top:dragRect.y*viewportSize.height,width:dragRect.width*viewportSize.width,height:dragRect.height*viewportSize.height}}/>:null
  const hiddenSourceKeys=useMemo(()=>new Set(currentPage?.annotations.filter(a=>a.kind==='replaceText').map(a=>a.kind==='replaceText'?a.sourceKey:'')??[]),[currentPage])

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">P</span><span>OpenPDF</span><span className="version">v0.3</span></div><div className="file-title">{fileName||'Editor PDF gratuito y local'}</div><div className="top-actions">
      <button className="button secondary" onClick={()=>setShowInfo(true)}>?</button><button className="button secondary" onClick={()=>combineInputRef.current?.click()}>Combinar</button><button className="button secondary" onClick={()=>setShowSplit(true)} disabled={!pdf}>Dividir</button><button className="button secondary" onClick={()=>setShowForms(true)} disabled={!formFields.length}>Formularios{formFields.length?` (${formFields.length})`:''}</button><button className="button secondary" onClick={()=>fileInputRef.current?.click()}>Abrir</button><button className="button primary" onClick={save} disabled={!pdf}>Guardar PDF</button>
    </div><input ref={fileInputRef} type="file" accept="application/pdf,.pdf" hidden onChange={e=>e.target.files?.[0]&&openFile(e.target.files[0])}/><input ref={combineInputRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={e=>combineFiles(e.target.files)}/><input ref={imageInputRef} type="file" accept="image/png,image/jpeg" hidden onChange={e=>loadPendingImage(e.target.files?.[0])}/></header>

    <div className="workspace"><aside className="sidebar"><div className="sidebar-title">Páginas</div><div className="page-list">{pages.map((p,i)=><button key={p.id} className={`page-item ${i===pageIndex?'active':''}`} onClick={()=>setPageIndex(i)}><span className="page-icon">▤</span><span>Página {i+1}</span>{p.annotations.some(a=>a.kind==='redact')&&<span className="secure-dot" title="Contiene redacción segura">●</span>}</button>)}</div>{pdf&&<div className="page-actions page-actions-6"><button title="Subir página" onClick={()=>movePage(-1)}>↑</button><button title="Bajar página" onClick={()=>movePage(1)}>↓</button><button title="Duplicar página" onClick={duplicateCurrent}>⧉</button><button title="Extraer página" onClick={extractCurrent}>⇩</button><button title="Rotar" onClick={rotate}>↻</button><button title="Eliminar" onClick={removeCurrent}>⌫</button></div>}</aside>
      <main className="main-area"><div className="toolbar"><button className={tool==='select'?'active':''} onClick={()=>setToolAndStatus('select')}>Cursor</button><button className={tool==='editText'?'active':''} onClick={()=>setToolAndStatus('editText')} disabled={!pdf}>Editar texto</button><button className={tool==='text'?'active':''} onClick={()=>setToolAndStatus('text')} disabled={!pdf}>Añadir texto</button><button className={tool==='highlight'?'active':''} onClick={()=>setToolAndStatus('highlight')} disabled={!pdf}>Resaltar</button><button className={tool==='draw'?'active':''} onClick={()=>setToolAndStatus('draw')} disabled={!pdf}>Dibujar / Firma</button><button className={tool==='image'?'active':''} onClick={()=>setToolAndStatus('image')} disabled={!pdf}>Imagen</button><button onClick={()=>setShowChart(true)} disabled={!pdf}>Gráfico</button><button className={tool==='redact'?'active danger-tool':'danger-tool'} onClick={()=>setToolAndStatus('redact')} disabled={!pdf}>Redactar</button><span className="divider"/><button onClick={undo} disabled={!past.length}>↶</button><button onClick={redo} disabled={!future.length}>↷</button><span className="divider"/><button onClick={()=>setZoom(z=>Math.max(.5,+(z-.15).toFixed(2)))}>-</button><span className="zoom-label">{Math.round(zoom*100)}%</span><button onClick={()=>setZoom(z=>Math.min(2.5,+(z+.15).toFixed(2)))}>+</button></div>
        <div className="document-stage">{!pdf?<button className="drop-card" onClick={()=>fileInputRef.current?.click()}><span className="drop-icon">PDF</span><strong>Abre un documento PDF</strong><span>Todo se procesa localmente en tu equipo.</span></button>:<div ref={pageHostRef} className={`page-host tool-${tool}`} style={{width:viewportSize.width,height:viewportSize.height}} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={finishPointerAction} onPointerCancel={finishPointerAction}><canvas ref={canvasRef}/>
          {tool==='editText'&&<div className="existing-text-layer">{textItems.map(item=>!hiddenSourceKeys.has(item.key)&&<button key={item.key} className="existing-text-hitbox" title={item.text} style={{left:item.x,top:item.y,width:Math.max(4,item.width),height:Math.max(8,item.height)}} onPointerDown={e=>{e.stopPropagation();editExistingText(item)}}/>)}</div>}
          <svg className={`annotation-layer ${tool==='select'?'interactive':''}`} width={viewportSize.width} height={viewportSize.height}>{strokeElements}</svg><div className={`object-layer ${tool==='select'?'interactive':''}`}>{annotationElements}{currentDragElement}</div>{selectedId&&tool==='select'&&<div className="selection-toolbar"><span>Objeto seleccionado</span><button onClick={deleteSelected}>Eliminar</button></div>}
        </div>}</div>
      </main></div>
    <footer className="statusbar"><span>{status}</span><span>{pdf?`Página ${pageIndex+1} de ${pages.length}`:'Local · sin subir archivos'}</span></footer>

    {showChart&&<div className="modal-backdrop" onMouseDown={()=>setShowChart(false)}><section className="modal chart-modal" onMouseDown={e=>e.stopPropagation()}><div className="modal-header"><div><strong>Insertar gráfico</strong><span>Pega datos de Excel/CSV o intenta detectar columnas de la página.</span></div><button onClick={()=>setShowChart(false)}>×</button></div><div className="chart-editor"><div className="chart-options"><label>Tipo<select value={chartType} onChange={e=>setChartType(e.target.value as ChartType)}><option value="bar">Barras</option><option value="line">Líneas</option><option value="pie">Pastel</option></select></label><label>Título<input value={chartTitle} onChange={e=>setChartTitle(e.target.value)} placeholder="Título del gráfico"/></label></div><label className="chart-data-label">Datos<textarea value={chartData} onChange={e=>setChartData(e.target.value)} spellCheck={false}/></label><div className="chart-help">Primera columna = categorías. Las demás columnas = series numéricas. Acepta tabulaciones de Excel, comas o punto y coma.</div></div><div className="modal-footer split-footer"><button className="button secondary" onClick={detectTable}>Detectar tabla de esta página</button><button className="button primary" onClick={createChart}>Insertar gráfico</button></div></section></div>}

    {showSplit&&<div className="modal-backdrop" onMouseDown={()=>setShowSplit(false)}><section className="modal small-modal" onMouseDown={e=>e.stopPropagation()}><div className="modal-header"><div><strong>Dividir PDF</strong><span>Separa grupos con punto y coma. Cada grupo genera un PDF.</span></div><button onClick={()=>setShowSplit(false)}>×</button></div><div className="split-content"><label>Rangos<input value={splitSpec} onChange={e=>setSplitSpec(e.target.value)} placeholder="1-3; 4-6; 8,10-12"/></label><p>Ejemplo: <b>1-3; 4-6; 8,10-12</b> crea tres archivos.</p></div><div className="modal-footer"><button className="button primary" onClick={splitPdf}>Generar partes</button></div></section></div>}

    {showForms&&<div className="modal-backdrop" onMouseDown={()=>setShowForms(false)}><section className="modal" onMouseDown={e=>e.stopPropagation()}><div className="modal-header"><div><strong>Formularios</strong><span>Edita campos AcroForm detectados en el PDF.</span></div><button onClick={()=>setShowForms(false)}>×</button></div><div className="form-list">{formFields.map(field=><label className="form-row" key={field.name}><span>{field.name}</span>{field.type==='checkbox'?<input type="checkbox" checked={Boolean(formEdits[field.name])} onChange={e=>setFormEdits(v=>({...v,[field.name]:e.target.checked}))}/>:field.options?.length?<select value={String(formEdits[field.name]??'')} onChange={e=>setFormEdits(v=>({...v,[field.name]:e.target.value}))}><option value="">—</option>{field.options.map(o=><option value={o} key={o}>{o}</option>)}</select>:<input type="text" value={String(formEdits[field.name]??'')} disabled={field.type==='unknown'} onChange={e=>setFormEdits(v=>({...v,[field.name]:e.target.value}))}/>}</label>)}</div><div className="modal-footer"><button className="button primary" onClick={()=>setShowForms(false)}>Aplicar</button></div></section></div>}

    {showInfo&&<div className="modal-backdrop" onMouseDown={()=>setShowInfo(false)}><section className="modal info-modal" onMouseDown={e=>e.stopPropagation()}><div className="modal-header"><div><strong>OpenPDF v0.3</strong><span>Editor local: nada se sube a un servidor.</span></div><button onClick={()=>setShowInfo(false)}>×</button></div><div className="info-content"><p><b>Objetos:</b> con Cursor puedes seleccionar, arrastrar y redimensionar texto reemplazado, imágenes, gráficos, resaltados y redacciones. Supr/Delete elimina el objeto.</p><p><b>Deshacer/Rehacer:</b> ahora conserva historial real de cambios de páginas y objetos.</p><p><b>Gráficos:</b> pega una tabla desde Excel o CSV para crear barras, líneas o pastel. “Detectar tabla” intenta reconstruir columnas usando las posiciones del texto de la página; es experimental y conviene revisar los datos detectados.</p><p><b>Dividir:</b> admite grupos como 1-3; 4-6; 8,10-12.</p><p className="safe"><b>Redacción segura:</b> al guardar, las páginas que contengan redacciones se convierten a una imagen nueva dentro del PDF. Así el texto/objetos que estaban debajo no se copian a esa página del archivo resultante. Como consecuencia, esas páginas pierden texto seleccionable y elementos vectoriales.</p><p><b>Editar texto existente:</b> todavía es reemplazo visual de bloques detectados; la recomposición real de párrafos y fuentes seguirá siendo una fase posterior.</p></div><div className="modal-footer"><button className="button primary" onClick={()=>setShowInfo(false)}>Entendido</button></div></section></div>}
  </div>
}
