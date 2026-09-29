export type ToolMode = 'select' | 'text' | 'draw'

export type Point = { x: number; y: number }

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

export type Annotation = TextAnnotation | StrokeAnnotation

export type PageState = {
  id: string
  sourceIndex: number
  rotationDelta: number
  annotations: Annotation[]
}
