import {
  degrees,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
  rgb,
} from 'pdf-lib'
import type { FormEditValue, FormFieldInfo, PageState } from './types'

function dataUrlToBytes(dataUrl: string) {
  const [, base64] = dataUrl.split(',')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function readFormFields(source: Uint8Array): Promise<FormFieldInfo[]> {
  try {
    const doc = await PDFDocument.load(source, { ignoreEncryption: true })
    const form = doc.getForm()
    return form.getFields().map(field => {
      const name = field.getName()
      if (field instanceof PDFTextField) {
        return { name, type: 'text', value: field.getText() ?? '' }
      }
      if (field instanceof PDFCheckBox) {
        return { name, type: 'checkbox', value: field.isChecked() }
      }
      if (field instanceof PDFDropdown) {
        return { name, type: 'dropdown', value: field.getSelected()?.[0] ?? '', options: field.getOptions() }
      }
      if (field instanceof PDFRadioGroup) {
        return { name, type: 'radio', value: field.getSelected() ?? '', options: field.getOptions() }
      }
      return { name, type: 'unknown', value: '' }
    })
  } catch {
    return []
  }
}

async function applyFormEdits(sourceDoc: PDFDocument, formEdits: Record<string, FormEditValue>) {
  const keys = Object.keys(formEdits)
  if (!keys.length) return

  const form = sourceDoc.getForm()
  for (const [name, value] of Object.entries(formEdits)) {
    try {
      const field = form.getField(name)
      if (field instanceof PDFTextField && typeof value === 'string') field.setText(value)
      else if (field instanceof PDFCheckBox && typeof value === 'boolean') value ? field.check() : field.uncheck()
      else if (field instanceof PDFDropdown && typeof value === 'string' && value) field.select(value)
      else if (field instanceof PDFRadioGroup && typeof value === 'string' && value) field.select(value)
    } catch {
      // A malformed/unsupported field should not prevent saving the rest of the document.
    }
  }

  try {
    form.flatten()
  } catch {
    // Some malformed PDFs contain fields that pdf-lib cannot flatten. Keep the document usable.
  }
}

export async function exportEditedPdf(
  source: Uint8Array,
  pages: PageState[],
  formEdits: Record<string, FormEditValue> = {},
) {
  const sourceDoc = await PDFDocument.load(source)
  await applyFormEdits(sourceDoc, formEdits)

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
      } else if (annotation.kind === 'replaceText') {
        const x = annotation.x * width
        const y = height - (annotation.y + annotation.height) * height
        const w = annotation.width * width
        const h = annotation.height * height
        page.drawRectangle({ x: x - 1, y: y - 1, width: w + 2, height: h + 2, color: rgb(1, 1, 1) })
        if (annotation.text) {
          page.drawText(annotation.text, {
            x,
            y: y + Math.max(0, (h - annotation.size) / 2),
            size: annotation.size,
            font,
            color: rgb(0.06, 0.07, 0.09),
            maxWidth: Math.max(w * 1.8, w + 20),
          })
        }
      } else if (annotation.kind === 'stroke') {
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
      } else if (annotation.kind === 'highlight') {
        page.drawRectangle({
          x: annotation.x * width,
          y: height - (annotation.y + annotation.height) * height,
          width: annotation.width * width,
          height: annotation.height * height,
          color: rgb(1, 0.9, 0.18),
          opacity: 0.34,
        })
      } else if (annotation.kind === 'redact') {
        // Visual redaction. Secure redaction is handled by rasterizing affected pages in App.tsx.
        page.drawRectangle({
          x: annotation.x * width,
          y: height - (annotation.y + annotation.height) * height,
          width: annotation.width * width,
          height: annotation.height * height,
          color: rgb(0, 0, 0),
        })
      } else if (annotation.kind === 'image') {
        const bytes = dataUrlToBytes(annotation.dataUrl)
        const image = annotation.mime === 'image/png'
          ? await outputDoc.embedPng(bytes)
          : await outputDoc.embedJpg(bytes)
        page.drawImage(image, {
          x: annotation.x * width,
          y: height - (annotation.y + annotation.height) * height,
          width: annotation.width * width,
          height: annotation.height * height,
        })
      }
    }
  }

  return outputDoc.save()
}

export async function mergePdfBytes(documents: Uint8Array[]) {
  const output = await PDFDocument.create()
  for (const bytes of documents) {
    const source = await PDFDocument.load(bytes)
    const copied = await output.copyPages(source, source.getPageIndices())
    copied.forEach(page => output.addPage(page))
  }
  return output.save()
}
