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
      if (field instanceof PDFTextField) return { name, type: 'text', value: field.getText() ?? '' }
      if (field instanceof PDFCheckBox) return { name, type: 'checkbox', value: field.isChecked() }
      if (field instanceof PDFDropdown) return { name, type: 'dropdown', value: field.getSelected()?.[0] ?? '', options: field.getOptions() }
      if (field instanceof PDFRadioGroup) return { name, type: 'radio', value: field.getSelected() ?? '', options: field.getOptions() }
      return { name, type: 'unknown', value: '' }
    })
  } catch {
    return []
  }
}

async function applyFormEdits(sourceDoc: PDFDocument, formEdits: Record<string, FormEditValue>) {
  if (!Object.keys(formEdits).length) return
  const form = sourceDoc.getForm()
  for (const [name, value] of Object.entries(formEdits)) {
    try {
      const field = form.getField(name)
      if (field instanceof PDFTextField && typeof value === 'string') field.setText(value)
      else if (field instanceof PDFCheckBox && typeof value === 'boolean') value ? field.check() : field.uncheck()
      else if (field instanceof PDFDropdown && typeof value === 'string' && value) field.select(value)
      else if (field instanceof PDFRadioGroup && typeof value === 'string' && value) field.select(value)
    } catch { /* malformed field: continue */ }
  }
  try { form.flatten() } catch { /* keep document usable */ }
}

export async function exportEditedPdf(source: Uint8Array, pages: PageState[], formEdits: Record<string, FormEditValue> = {}) {
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
        page.drawText(annotation.text, { x: annotation.x * width, y: height - annotation.y * height - annotation.size, size: annotation.size, font, color: rgb(.06,.07,.09) })
      } else if (annotation.kind === 'replaceText') {
        const x = annotation.x * width, y = height - (annotation.y + annotation.height) * height
        const w = annotation.width * width, h = annotation.height * height
        page.drawRectangle({ x: x - 1, y: y - 1, width: w + 2, height: h + 2, color: rgb(1,1,1) })
        if (annotation.text) page.drawText(annotation.text, { x, y: y + Math.max(0,(h-annotation.size)/2), size: annotation.size, font, color: rgb(.06,.07,.09), maxWidth: Math.max(w*1.8,w+20) })
      } else if (annotation.kind === 'stroke') {
        for (let i=1;i<annotation.points.length;i++) {
          const a=annotation.points[i-1], b=annotation.points[i]
          page.drawLine({ start:{x:a.x*width,y:height-a.y*height}, end:{x:b.x*width,y:height-b.y*height}, thickness:annotation.width, color:rgb(.06,.07,.09) })
        }
      } else if (annotation.kind === 'highlight') {
        page.drawRectangle({ x:annotation.x*width, y:height-(annotation.y+annotation.height)*height, width:annotation.width*width, height:annotation.height*height, color:rgb(1,.9,.18), opacity:.34 })
      } else if (annotation.kind === 'redact') {
        page.drawRectangle({ x:annotation.x*width, y:height-(annotation.y+annotation.height)*height, width:annotation.width*width, height:annotation.height*height, color:rgb(0,0,0) })
      } else if (annotation.kind === 'image' || annotation.kind === 'chart') {
        const bytes = dataUrlToBytes(annotation.dataUrl)
        const image = annotation.kind === 'image' && annotation.mime === 'image/jpeg' ? await outputDoc.embedJpg(bytes) : await outputDoc.embedPng(bytes)
        page.drawImage(image, { x:annotation.x*width, y:height-(annotation.y+annotation.height)*height, width:annotation.width*width, height:annotation.height*height })
      }
    }

    // OCR layer: invisible text that keeps scanned pages searchable/selectable.
    // Extremely low opacity avoids altering the page visually while preserving text objects.
    if (state.ocrWords?.length) {
      for (const word of state.ocrWords) {
        if (!word.text.trim()) continue
        const x = word.x * width
        const boxHeight = Math.max(2, word.height * height)
        const fontSize = Math.max(4, Math.min(72, boxHeight * 0.82))
        const y = height - (word.y + word.height) * height + Math.max(0, (boxHeight - fontSize) * 0.5)
        try {
          page.drawText(word.text, {
            x,
            y,
            size: fontSize,
            font,
            color: rgb(0, 0, 0),
            opacity: 0.001,
            maxWidth: Math.max(2, word.width * width * 1.35),
          })
        } catch {
          // A malformed OCR token should not prevent the document from being saved.
        }
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

export async function replacePdfPagesWithPng(input: Uint8Array, replacements: Map<number, string>) {
  const source = await PDFDocument.load(input)
  const output = await PDFDocument.create()
  for (let i=0;i<source.getPageCount();i++) {
    const replacement = replacements.get(i)
    if (!replacement) {
      const [page] = await output.copyPages(source,[i]); output.addPage(page); continue
    }
    const srcPage = source.getPage(i)
    const {width,height} = srcPage.getSize()
    const page = output.addPage([width,height])
    const png = await output.embedPng(dataUrlToBytes(replacement))
    page.drawImage(png,{x:0,y:0,width,height})
  }
  return output.save()
}
