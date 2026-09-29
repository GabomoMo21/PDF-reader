import { useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { exportEditedPdf, mergePdfBytes, readFormFields } from './pdf'
import type {
  ExistingTextItem,
  FormEditValue,
  FormFieldInfo,
  PageState,
  Point,
  Rect,
  ToolMode,
} from './types'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

const uid = () => crypto.randomUUID()

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
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  }
}

export default function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const combineInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pageHostRef = useRef<HTMLDivElement>(null)

  const [fileName, setFileName] = useState('')
  const [sourceBytes, setSourceBytes] = useState<Uint8Array | null>(null)
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [pages, setPages] = useState<PageState[]>([])
  const [pageIndex, setPageIndex] = useState(0)
  const [tool, setTool] = useState<ToolMode>('select')
  const [zoom, setZoom] = useState(1.15)
  const [viewportSize, setViewportSize] = useState({ width: 1, height: 1 })
  const [drawing, setDrawing] = useState<Point[] | null>(null)
  const [dragStart, setDragStart] = useState<Point | null>(null)
  const [dragRect, setDragRect] = useState<Rect | null>(null)
  const [textItems, setTextItems] = useState<ExistingTextItem[]>([])
  const [pendingImage, setPendingImage] = useState<{ dataUrl: string; mime: 'image/png' | 'image/jpeg'; ratio: number } | null>(null)
  const [status, setStatus] = useState('Abre un PDF para comenzar')
  const [formFields, setFormFields] = useState<FormFieldInfo[]>([])
  const [formEdits, setFormEdits] = useState<Record<string, FormEditValue>>({})
  const [showForms, setShowForms] = useState(false)
  const [showInfo, setShowInfo] = useState(false)

  const currentPage = pages[pageIndex]

  useEffect(() => {
    if (!pdf || !currentPage || !canvasRef.current) return
    let cancelled = false

    ;(async () => {
      const page = await pdf.getPage(currentPage.sourceIndex + 1)
      const baseRotation = page.rotate || 0
      const viewport = page.getViewport({ scale: zoom, rotation: baseRotation + currentPage.rotationDelta })
      if (cancelled || !canvasRef.current) return

      const canvas = canvasRef.current
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      const ctx = canvas.getContext('2d')!
      await page.render({
        canvasContext: ctx,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      }).promise

      const content = await page.getTextContent()
      const items: ExistingTextItem[] = []
      content.items.forEach((raw, index) => {
        if (!('str' in raw) || !raw.str.trim()) return
        const tx = pdfjsLib.Util.transform(viewport.transform, raw.transform)
        const fontSize = Math.max(6, Math.hypot(tx[2], tx[3]))
        const width = Math.max(2, raw.width * zoom)
        const height = Math.max(fontSize, raw.height * zoom || fontSize)
        items.push({
          key: `${currentPage.sourceIndex}-${index}`,
          text: raw.str,
          x: tx[4],
          y: tx[5] - height,
          width,
          height,
          fontSize,
        })
      })

      if (!cancelled) {
        setViewportSize({ width: viewport.width, height: viewport.height })
        setTextItems(items)
      }
    })().catch(error => {
      console.error(error)
      setStatus('No se pudo renderizar esta página')
    })

    return () => { cancelled = true }
  }, [pdf, currentPage?.sourceIndex, currentPage?.rotationDelta, pageIndex, zoom])

  const openFile = async (file: File) => {
    try {
      setStatus('Abriendo PDF…')
      const bytes = new Uint8Array(await file.arrayBuffer())
      const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() })
      const loaded = await loadingTask.promise
      const initialPages: PageState[] = Array.from({ length: loaded.numPages }, (_, i) => ({
        id: uid(), sourceIndex: i, rotationDelta: 0, annotations: [],
      }))
      const fields = await readFormFields(bytes)

      setFileName(file.name)
      setSourceBytes(bytes)
      setPdf(loaded)
      setPages(initialPages)
      setPageIndex(0)
      setFormFields(fields)
      setFormEdits(Object.fromEntries(fields.map(f => [f.name, f.value])))
      setStatus(`${loaded.numPages} página${loaded.numPages === 1 ? '' : 's'}${fields.length ? ` · ${fields.length} campo${fields.length === 1 ? '' : 's'} de formulario` : ''}`)
    } catch (error) {
      console.error(error)
      setStatus('No se pudo abrir el PDF')
    }
  }

  const updateCurrentPage = (updater: (page: PageState) => PageState) => {
    setPages(old => old.map((p, i) => i === pageIndex ? updater(p) : p))
  }

  const rotate = () => updateCurrentPage(p => ({ ...p, rotationDelta: (p.rotationDelta + 90) % 360 }))

  const removeCurrent = () => {
    if (pages.length <= 1) return
    setPages(old => old.filter((_, i) => i !== pageIndex))
    setPageIndex(i => Math.max(0, Math.min(i, pages.length - 2)))
  }

  const duplicateCurrent = () => {
    if (!currentPage) return
    const clone: PageState = {
      ...currentPage,
      id: uid(),
      annotations: currentPage.annotations.map(annotation => ({ ...annotation, id: uid() })),
    }
    setPages(old => [...old.slice(0, pageIndex + 1), clone, ...old.slice(pageIndex + 1)])
    setPageIndex(pageIndex + 1)
  }

  const movePage = (direction: -1 | 1) => {
    const target = pageIndex + direction
    if (target < 0 || target >= pages.length) return
    setPages(old => {
      const copy = [...old]
      ;[copy[pageIndex], copy[target]] = [copy[target], copy[pageIndex]]
      return copy
    })
    setPageIndex(target)
  }

  const normalizedPoint = (event: React.PointerEvent): Point => {
    const rect = pageHostRef.current!.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    }
  }

  const onPointerDown = (event: React.PointerEvent) => {
    if (!currentPage || tool === 'editText') return
    const point = normalizedPoint(event)

    if (tool === 'text') {
      const text = window.prompt('Texto a insertar:')
      if (!text?.trim()) return
      updateCurrentPage(p => ({
        ...p,
        annotations: [...p.annotations, { id: uid(), kind: 'text', x: point.x, y: point.y, text: text.trim(), size: 16 }],
      }))
      setTool('select')
    } else if (tool === 'draw') {
      event.currentTarget.setPointerCapture(event.pointerId)
      setDrawing([point])
    } else if (tool === 'highlight' || tool === 'redact') {
      event.currentTarget.setPointerCapture(event.pointerId)
      setDragStart(point)
      setDragRect({ x: point.x, y: point.y, width: 0, height: 0 })
    } else if (tool === 'image') {
      if (!pendingImage) {
        imageInputRef.current?.click()
        return
      }
      const width = 0.28
      const height = Math.min(0.4, width / Math.max(0.15, pendingImage.ratio) * (viewportSize.width / viewportSize.height))
      updateCurrentPage(p => ({
        ...p,
        annotations: [...p.annotations, {
          id: uid(), kind: 'image', x: Math.min(point.x, 1 - width), y: Math.min(point.y, 1 - height),
          width, height, dataUrl: pendingImage.dataUrl, mime: pendingImage.mime,
        }],
      }))
      setPendingImage(null)
      setTool('select')
    }
  }

  const onPointerMove = (event: React.PointerEvent) => {
    if (tool === 'draw' && drawing) {
      setDrawing(points => points ? [...points, normalizedPoint(event)] : null)
    } else if ((tool === 'highlight' || tool === 'redact') && dragStart) {
      setDragRect(rectFromPoints(dragStart, normalizedPoint(event)))
    }
  }

  const finishPointerAction = () => {
    if (drawing) {
      if (drawing.length >= 2) {
        updateCurrentPage(p => ({
          ...p,
          annotations: [...p.annotations, { id: uid(), kind: 'stroke', points: drawing, width: 2 }],
        }))
      }
      setDrawing(null)
    }

    if (dragStart && dragRect && dragRect.width > 0.003 && dragRect.height > 0.003 && (tool === 'highlight' || tool === 'redact')) {
      const kind = tool
      updateCurrentPage(p => ({
        ...p,
        annotations: [...p.annotations, { id: uid(), kind, ...dragRect }],
      }))
      if (kind === 'redact') setStatus('Redacción marcada. En esta versión es visual; no la uses aún para datos sensibles.')
    }
    setDragStart(null)
    setDragRect(null)
  }

  const editExistingText = (item: ExistingTextItem) => {
    const existing = currentPage?.annotations.find(a => a.kind === 'replaceText' && a.sourceKey === item.key)
    const original = existing?.kind === 'replaceText' ? existing.text : item.text
    const replacement = window.prompt('Editar texto (déjalo vacío para ocultarlo):', original)
    if (replacement === null) return

    const normalized = {
      x: item.x / viewportSize.width,
      y: item.y / viewportSize.height,
      width: item.width / viewportSize.width,
      height: item.height / viewportSize.height,
    }
    const pdfFontSize = Math.max(5, item.fontSize / zoom)

    updateCurrentPage(p => {
      const filtered = p.annotations.filter(a => !(a.kind === 'replaceText' && a.sourceKey === item.key))
      return {
        ...p,
        annotations: [...filtered, {
          id: uid(), kind: 'replaceText', sourceKey: item.key,
          ...normalized, text: replacement, size: pdfFontSize,
        }],
      }
    })
  }

  const undo = () => updateCurrentPage(p => ({ ...p, annotations: p.annotations.slice(0, -1) }))

  const save = async () => {
    if (!sourceBytes || pages.length === 0) return
    try {
      setStatus('Generando PDF…')
      const bytes = await exportEditedPdf(sourceBytes, pages, formEdits)
      downloadBytes(bytes, fileName.replace(/\.pdf$/i, '') + '-editado.pdf')
      setStatus('PDF guardado')
    } catch (error) {
      console.error(error)
      setStatus('Error al guardar')
    }
  }

  const extractCurrent = async () => {
    if (!sourceBytes || !currentPage) return
    try {
      const bytes = await exportEditedPdf(sourceBytes, [currentPage], formEdits)
      downloadBytes(bytes, `${fileName.replace(/\.pdf$/i, '')}-pagina-${pageIndex + 1}.pdf`)
      setStatus(`Página ${pageIndex + 1} extraída`)
    } catch (error) {
      console.error(error)
      setStatus('No se pudo extraer la página')
    }
  }

  const combineFiles = async (files: FileList | null) => {
    if (!files?.length) return
    try {
      setStatus('Combinando PDFs…')
      const documents: Uint8Array[] = []
      if (sourceBytes) documents.push(sourceBytes)
      for (const file of Array.from(files)) documents.push(new Uint8Array(await file.arrayBuffer()))
      const merged = await mergePdfBytes(documents)
      const combinedFile = new File([merged], 'PDF-combinado.pdf', { type: 'application/pdf' })
      await openFile(combinedFile)
      setStatus(`${documents.length} documentos combinados · revisa y guarda cuando quieras`)
    } catch (error) {
      console.error(error)
      setStatus('No se pudieron combinar los PDFs')
    } finally {
      if (combineInputRef.current) combineInputRef.current.value = ''
    }
  }

  const loadPendingImage = (file?: File) => {
    if (!file) return
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setStatus('Por ahora las imágenes deben ser PNG o JPG')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result)
      const image = new Image()
      image.onload = () => {
        setPendingImage({ dataUrl, mime: file.type as 'image/png' | 'image/jpeg', ratio: image.width / image.height })
        setTool('image')
        setStatus('Haz clic sobre la página para colocar la imagen')
      }
      image.src = dataUrl
    }
    reader.readAsDataURL(file)
  }

  const setToolAndStatus = (next: ToolMode) => {
    setTool(next)
    if (next === 'editText') setStatus('Haz clic sobre un bloque de texto existente para reemplazarlo')
    else if (next === 'highlight') setStatus('Arrastra sobre el área que quieres resaltar')
    else if (next === 'draw') setStatus('Dibuja directamente sobre el documento. También sirve para una firma rápida.')
    else if (next === 'redact') setStatus('Arrastra para cubrir contenido. Aviso: la v0.2 todavía no elimina el contenido subyacente.')
    else if (next === 'image') imageInputRef.current?.click()
  }

  const strokeElements = useMemo(() => {
    if (!currentPage) return null
    const strokes = currentPage.annotations.filter(a => a.kind === 'stroke')
    const allStrokes = drawing ? [...strokes, { id: 'drawing-preview', kind: 'stroke' as const, points: drawing, width: 2 }] : strokes
    return allStrokes.map(annotation => {
      const points = annotation.points.map(p => `${p.x * viewportSize.width},${p.y * viewportSize.height}`).join(' ')
      return <polyline key={annotation.id} points={points} fill="none" stroke="currentColor" strokeWidth={annotation.width * zoom} strokeLinecap="round" strokeLinejoin="round" />
    })
  }, [currentPage, drawing, viewportSize, zoom])

  const annotationElements = useMemo(() => {
    if (!currentPage) return null
    return currentPage.annotations.map(annotation => {
      if (annotation.kind === 'text') {
        return <div key={annotation.id} className="text-annotation" style={{
          left: annotation.x * viewportSize.width,
          top: annotation.y * viewportSize.height,
          fontSize: annotation.size * zoom,
        }}>{annotation.text}</div>
      }
      if (annotation.kind === 'replaceText') {
        return <div key={annotation.id} className="replacement-annotation" style={{
          left: annotation.x * viewportSize.width - 1,
          top: annotation.y * viewportSize.height - 1,
          width: annotation.width * viewportSize.width + 2,
          minHeight: annotation.height * viewportSize.height + 2,
          fontSize: annotation.size * zoom,
        }}>{annotation.text}</div>
      }
      if (annotation.kind === 'highlight' || annotation.kind === 'redact') {
        return <div key={annotation.id} className={`rect-annotation ${annotation.kind}`} style={{
          left: annotation.x * viewportSize.width,
          top: annotation.y * viewportSize.height,
          width: annotation.width * viewportSize.width,
          height: annotation.height * viewportSize.height,
        }} />
      }
      if (annotation.kind === 'image') {
        return <img key={annotation.id} className="image-annotation" src={annotation.dataUrl} alt="" style={{
          left: annotation.x * viewportSize.width,
          top: annotation.y * viewportSize.height,
          width: annotation.width * viewportSize.width,
          height: annotation.height * viewportSize.height,
        }} />
      }
      return null
    })
  }, [currentPage, viewportSize, zoom])

  const currentDragElement = dragRect && (tool === 'highlight' || tool === 'redact') ? (
    <div className={`rect-annotation ${tool} preview`} style={{
      left: dragRect.x * viewportSize.width,
      top: dragRect.y * viewportSize.height,
      width: dragRect.width * viewportSize.width,
      height: dragRect.height * viewportSize.height,
    }} />
  ) : null

  const hiddenSourceKeys = useMemo(() => new Set(
    currentPage?.annotations.filter(a => a.kind === 'replaceText').map(a => a.kind === 'replaceText' ? a.sourceKey : '') ?? [],
  ), [currentPage])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">P</span><span>OpenPDF</span><span className="version">v0.2</span></div>
        <div className="file-title">{fileName || 'Editor PDF gratuito y local'}</div>
        <div className="top-actions">
          <button className="button secondary" onClick={() => setShowInfo(true)}>?</button>
          <button className="button secondary" onClick={() => combineInputRef.current?.click()}>Combinar</button>
          <button className="button secondary" onClick={() => setShowForms(true)} disabled={!formFields.length}>Formularios{formFields.length ? ` (${formFields.length})` : ''}</button>
          <button className="button secondary" onClick={() => fileInputRef.current?.click()}>Abrir</button>
          <button className="button primary" onClick={save} disabled={!pdf}>Guardar PDF</button>
        </div>
        <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" hidden onChange={e => e.target.files?.[0] && openFile(e.target.files[0])} />
        <input ref={combineInputRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={e => combineFiles(e.target.files)} />
        <input ref={imageInputRef} type="file" accept="image/png,image/jpeg" hidden onChange={e => loadPendingImage(e.target.files?.[0])} />
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-title">Páginas</div>
          <div className="page-list">
            {pages.map((page, index) => (
              <button key={page.id} className={`page-item ${index === pageIndex ? 'active' : ''}`} onClick={() => setPageIndex(index)}>
                <span className="page-icon">▤</span><span>Página {index + 1}</span>
              </button>
            ))}
          </div>
          {pdf && <div className="page-actions page-actions-6">
            <button title="Subir página" onClick={() => movePage(-1)}>↑</button>
            <button title="Bajar página" onClick={() => movePage(1)}>↓</button>
            <button title="Duplicar página" onClick={duplicateCurrent}>⧉</button>
            <button title="Extraer página" onClick={extractCurrent}>⇩</button>
            <button title="Rotar" onClick={rotate}>↻</button>
            <button title="Eliminar" onClick={removeCurrent}>⌫</button>
          </div>}
        </aside>

        <main className="main-area">
          <div className="toolbar">
            <button className={tool === 'select' ? 'active' : ''} onClick={() => setToolAndStatus('select')}>Cursor</button>
            <button className={tool === 'editText' ? 'active' : ''} onClick={() => setToolAndStatus('editText')} disabled={!pdf}>Editar texto</button>
            <button className={tool === 'text' ? 'active' : ''} onClick={() => setToolAndStatus('text')} disabled={!pdf}>Añadir texto</button>
            <button className={tool === 'highlight' ? 'active' : ''} onClick={() => setToolAndStatus('highlight')} disabled={!pdf}>Resaltar</button>
            <button className={tool === 'draw' ? 'active' : ''} onClick={() => setToolAndStatus('draw')} disabled={!pdf}>Dibujar / Firma</button>
            <button className={tool === 'image' ? 'active' : ''} onClick={() => setToolAndStatus('image')} disabled={!pdf}>Imagen</button>
            <button className={tool === 'redact' ? 'active danger-tool' : 'danger-tool'} onClick={() => setToolAndStatus('redact')} disabled={!pdf}>Redactar</button>
            <span className="divider" />
            <button onClick={undo} disabled={!currentPage?.annotations.length}>Deshacer</button>
            <span className="divider" />
            <button onClick={() => setZoom(z => Math.max(.5, +(z - .15).toFixed(2)))}>-</button>
            <span className="zoom-label">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(z => Math.min(2.5, +(z + .15).toFixed(2)))}>+</button>
          </div>

          <div className="document-stage">
            {!pdf ? (
              <button className="drop-card" onClick={() => fileInputRef.current?.click()}>
                <span className="drop-icon">PDF</span>
                <strong>Abre un documento PDF</strong>
                <span>Todo se procesa localmente en tu equipo.</span>
              </button>
            ) : (
              <div
                ref={pageHostRef}
                className={`page-host tool-${tool}`}
                style={{ width: viewportSize.width, height: viewportSize.height }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={finishPointerAction}
                onPointerCancel={finishPointerAction}
              >
                <canvas ref={canvasRef} />

                {tool === 'editText' && <div className="existing-text-layer">
                  {textItems.map(item => !hiddenSourceKeys.has(item.key) && (
                    <button
                      key={item.key}
                      className="existing-text-hitbox"
                      title={item.text}
                      style={{ left: item.x, top: item.y, width: Math.max(4, item.width), height: Math.max(8, item.height) }}
                      onPointerDown={e => { e.stopPropagation(); editExistingText(item) }}
                    />
                  ))}
                </div>}

                <svg className="annotation-layer" width={viewportSize.width} height={viewportSize.height}>{strokeElements}</svg>
                <div className="object-layer">{annotationElements}{currentDragElement}</div>
              </div>
            )}
          </div>
        </main>
      </div>

      <footer className="statusbar"><span>{status}</span><span>{pdf ? `Página ${pageIndex + 1} de ${pages.length}` : 'Local · sin subir archivos'}</span></footer>

      {showForms && <div className="modal-backdrop" onMouseDown={() => setShowForms(false)}>
        <section className="modal" onMouseDown={e => e.stopPropagation()}>
          <div className="modal-header"><div><strong>Formularios</strong><span>Edita campos AcroForm detectados en el PDF.</span></div><button onClick={() => setShowForms(false)}>×</button></div>
          <div className="form-list">
            {formFields.map(field => (
              <label className="form-row" key={field.name}>
                <span>{field.name}</span>
                {field.type === 'checkbox' ? (
                  <input type="checkbox" checked={Boolean(formEdits[field.name])} onChange={e => setFormEdits(v => ({ ...v, [field.name]: e.target.checked }))} />
                ) : field.options?.length ? (
                  <select value={String(formEdits[field.name] ?? '')} onChange={e => setFormEdits(v => ({ ...v, [field.name]: e.target.value }))}>
                    <option value="">—</option>{field.options.map(option => <option value={option} key={option}>{option}</option>)}
                  </select>
                ) : (
                  <input type="text" value={String(formEdits[field.name] ?? '')} disabled={field.type === 'unknown'} onChange={e => setFormEdits(v => ({ ...v, [field.name]: e.target.value }))} />
                )}
              </label>
            ))}
          </div>
          <div className="modal-footer"><button className="button primary" onClick={() => setShowForms(false)}>Aplicar</button></div>
        </section>
      </div>}

      {showInfo && <div className="modal-backdrop" onMouseDown={() => setShowInfo(false)}>
        <section className="modal info-modal" onMouseDown={e => e.stopPropagation()}>
          <div className="modal-header"><div><strong>OpenPDF v0.2</strong><span>Qué hace realmente esta versión.</span></div><button onClick={() => setShowInfo(false)}>×</button></div>
          <div className="info-content">
            <p><b>Editar texto existente:</b> detecta bloques de texto, cubre visualmente el original y escribe el reemplazo. Funciona bien para cambios cortos, pero todavía no recompone párrafos como Word/Acrobat.</p>
            <p><b>Imágenes:</b> inserta PNG y JPG. <b>Dibujar / Firma:</b> permite trazos libres sobre la página. <b>Resaltado:</b> arrastra sobre cualquier zona.</p>
            <p><b>Formularios:</b> reconoce campos AcroForm compatibles y los aplana al guardar.</p>
            <p className="warning"><b>Redacción:</b> en v0.2 el rectángulo negro es visual. El texto original podría seguir existiendo dentro del archivo. No lo uses todavía para ocultar información sensible.</p>
          </div>
          <div className="modal-footer"><button className="button primary" onClick={() => setShowInfo(false)}>Entendido</button></div>
        </section>
      </div>}
    </div>
  )
}
