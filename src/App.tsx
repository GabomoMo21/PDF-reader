import { useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { exportEditedPdf } from './pdf'
import type { PageState, Point, ToolMode } from './types'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

const uid = () => crypto.randomUUID()

export default function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
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
  const [status, setStatus] = useState('Abre un PDF para comenzar')

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
      setViewportSize({ width: viewport.width, height: viewport.height })
    })()

    return () => {
      cancelled = true
    }
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
      setFileName(file.name)
      setSourceBytes(bytes)
      setPdf(loaded)
      setPages(initialPages)
      setPageIndex(0)
      setStatus(`${loaded.numPages} página${loaded.numPages === 1 ? '' : 's'}`)
    } catch (error) {
      console.error(error)
      setStatus('No se pudo abrir el PDF')
    }
  }

  const updateCurrentPage = (updater: (page: PageState) => PageState) => {
    setPages(old => old.map((p, i) => i === pageIndex ? updater(p) : p))
  }

  const rotate = () => {
    updateCurrentPage(p => ({ ...p, rotationDelta: (p.rotationDelta + 90) % 360 }))
  }

  const removeCurrent = () => {
    if (pages.length <= 1) return
    setPages(old => old.filter((_, i) => i !== pageIndex))
    setPageIndex(i => Math.max(0, Math.min(i, pages.length - 2)))
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
    if (!currentPage) return
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
    }
  }

  const onPointerMove = (event: React.PointerEvent) => {
    if (tool !== 'draw' || !drawing) return
    setDrawing(points => points ? [...points, normalizedPoint(event)] : null)
  }

  const finishDrawing = () => {
    if (!drawing || drawing.length < 2) {
      setDrawing(null)
      return
    }
    updateCurrentPage(p => ({
      ...p,
      annotations: [...p.annotations, { id: uid(), kind: 'stroke', points: drawing, width: 2 }],
    }))
    setDrawing(null)
  }

  const undo = () => {
    updateCurrentPage(p => ({ ...p, annotations: p.annotations.slice(0, -1) }))
  }

  const save = async () => {
    if (!sourceBytes || pages.length === 0) return
    try {
      setStatus('Generando PDF…')
      const bytes = await exportEditedPdf(sourceBytes, pages)
      const blob = new Blob([bytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName.replace(/\.pdf$/i, '') + '-editado.pdf'
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setStatus('PDF guardado')
    } catch (error) {
      console.error(error)
      setStatus('Error al guardar')
    }
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

  const textElements = useMemo(() => {
    if (!currentPage) return null
    return currentPage.annotations.filter(a => a.kind === 'text').map(annotation => (
      <div key={annotation.id} className="text-annotation" style={{
        left: annotation.x * viewportSize.width,
        top: annotation.y * viewportSize.height,
        fontSize: annotation.size * zoom,
      }}>
        {annotation.text}
      </div>
    ))
  }, [currentPage, viewportSize, zoom])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">P</span><span>OpenPDF</span></div>
        <div className="file-title">{fileName || 'Editor PDF gratuito y local'}</div>
        <div className="top-actions">
          <button className="button secondary" onClick={() => fileInputRef.current?.click()}>Abrir</button>
          <button className="button primary" onClick={save} disabled={!pdf}>Guardar PDF</button>
        </div>
        <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" hidden onChange={e => e.target.files?.[0] && openFile(e.target.files[0])} />
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-title">Páginas</div>
          <div className="page-list">
            {pages.map((page, index) => (
              <button key={page.id} className={`page-item ${index === pageIndex ? 'active' : ''}`} onClick={() => setPageIndex(index)}>
                <span className="page-icon">▤</span>
                <span>Página {index + 1}</span>
              </button>
            ))}
          </div>
          {pdf && <div className="page-actions">
            <button title="Subir página" onClick={() => movePage(-1)}>↑</button>
            <button title="Bajar página" onClick={() => movePage(1)}>↓</button>
            <button title="Rotar" onClick={rotate}>↻</button>
            <button title="Eliminar" onClick={removeCurrent}>⌫</button>
          </div>}
        </aside>

        <main className="main-area">
          <div className="toolbar">
            <button className={tool === 'select' ? 'active' : ''} onClick={() => setTool('select')}>Cursor</button>
            <button className={tool === 'text' ? 'active' : ''} onClick={() => setTool('text')}>Texto</button>
            <button className={tool === 'draw' ? 'active' : ''} onClick={() => setTool('draw')}>Dibujar</button>
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
                onPointerUp={finishDrawing}
                onPointerCancel={finishDrawing}
              >
                <canvas ref={canvasRef} />
                <svg className="annotation-layer" width={viewportSize.width} height={viewportSize.height}>{strokeElements}</svg>
                <div className="text-layer-ui">{textElements}</div>
              </div>
            )}
          </div>
        </main>
      </div>
      <footer className="statusbar"><span>{status}</span><span>{pdf ? `Página ${pageIndex + 1} de ${pages.length}` : 'Local · sin subir archivos'}</span></footer>
    </div>
  )
}
