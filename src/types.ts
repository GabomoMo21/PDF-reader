export type ToolMode = 'select' | 'editText' | 'text' | 'highlight' | 'draw' | 'image' | 'redact'

export type Point = { x: number; y: number }
export type Rect = { x: number; y: number; width: number; height: number }

export type TextAnnotation = {
  id: string
  kind: 'text'
  x: number
  y: number
  text: string
  size: number
}

export type StrokeAnnotation = {
  id: string
  kind: 'stroke'
  points: Point[]
  width: number
}

export type RectangleAnnotation = {
  id: string
  kind: 'highlight' | 'redact'
  appearance?: 'black' | 'white'
  x: number
  y: number
  width: number
  height: number
}

export type ImageAnnotation = {
  id: string
  kind: 'image'
  x: number
  y: number
  width: number
  height: number
  dataUrl: string
  mime: 'image/png' | 'image/jpeg'
}

export type ChartType = 'bar' | 'line' | 'pie'
export type ChartSeries = { name: string; values: number[] }

export type ChartAnnotation = {
  id: string
  kind: 'chart'
  x: number
  y: number
  width: number
  height: number
  dataUrl: string
  chartType: ChartType
  title: string
  labels: string[]
  series: ChartSeries[]
}

export type ReplaceTextAnnotation = {
  id: string
  kind: 'replaceText'
  sourceKey: string
  // Original rectangle stays fixed so moving/resizing edited text does not reveal the source.
  sourceX?: number
  sourceY?: number
  sourceWidth?: number
  sourceHeight?: number
  x: number
  y: number
  width: number
  height: number
  text: string
  size: number
}

export type Annotation = TextAnnotation | StrokeAnnotation | RectangleAnnotation | ImageAnnotation | ChartAnnotation | ReplaceTextAnnotation

export type OcrWord = {
  id: string
  text: string
  x: number
  y: number
  width: number
  height: number
  confidence: number
}

export type PageState = {
  id: string
  sourceIndex: number
  rotationDelta: number
  annotations: Annotation[]
  ocrWords?: OcrWord[]
  ocrLanguage?: string
}

export type ExistingTextItem = {
  key: string
  text: string
  x: number
  y: number
  width: number
  height: number
  fontSize: number
  confidence?: number
  source?: 'pdf' | 'ocr'
}

export type FormFieldInfo = {
  name: string
  type: 'text' | 'checkbox' | 'dropdown' | 'radio' | 'unknown'
  value: string | boolean
  options?: string[]
}

export type FormEditValue = string | boolean
