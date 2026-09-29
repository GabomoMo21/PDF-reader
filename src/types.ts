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

export type ReplaceTextAnnotation = {
  id: string
  kind: 'replaceText'
  sourceKey: string
  x: number
  y: number
  width: number
  height: number
  text: string
  size: number
}

export type Annotation = TextAnnotation | StrokeAnnotation | RectangleAnnotation | ImageAnnotation | ReplaceTextAnnotation

export type PageState = {
  id: string
  sourceIndex: number
  rotationDelta: number
  annotations: Annotation[]
}

export type ExistingTextItem = {
  key: string
  text: string
  x: number
  y: number
  width: number
  height: number
  fontSize: number
}

export type FormFieldInfo = {
  name: string
  type: 'text' | 'checkbox' | 'dropdown' | 'radio' | 'unknown'
  value: string | boolean
  options?: string[]
}

export type FormEditValue = string | boolean
