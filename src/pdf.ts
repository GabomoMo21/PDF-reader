import { degrees, PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { PageState } from './types'

export async function exportEditedPdf(source: Uint8Array, pages: PageState[]) {
  const sourceDoc = await PDFDocument.load(source)
  const outputDoc = await PDFDocument.create()
  const font = await outputDoc.embedFont(StandardFonts.Helvetica)

  for (const state of pages) {
    const [page] = await outputDoc.copyPages(sourceDoc, [state.sourceIndex])
    outputDoc.addPage(page)

    const originalRotation = page.getRotation().angle || 0
    const finalRotation = ((originalRotation + state.rotationDelta) % 360 + 360) % 360
    page.setRotation(degrees(finalRotation))

    const { width, height } = page.getSize()

    for (const annotation of state.annotations) {
      if (annotation.kind === 'text') {
        page.drawText(annotation.text, {
          x: annotation.x * width,
          y: height - annotation.y * height - annotation.size,
          size: annotation.size,
          font,
          color: rgb(0.06, 0.07, 0.09),
        })
      } else {
        for (let i = 1; i < annotation.points.length; i++) {
          const a = annotation.points[i - 1]
          const b = annotation.points[i]
          page.drawLine({
            start: { x: a.x * width, y: height - a.y * height },
            end: { x: b.x * width, y: height - b.y * height },
            thickness: annotation.width,
            color: rgb(0.06, 0.07, 0.09),
          })
        }
      }
    }
  }

  return outputDoc.save()
}
