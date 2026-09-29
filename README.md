# OpenPDF Editor v0.2

Editor PDF gratuito, local y experimental construido con React + TypeScript, PDF.js, pdf-lib y preparado para Tauri 2.

## Qué incluye esta versión

- Abrir y visualizar PDFs localmente.
- Zoom y navegación por páginas.
- Reordenar, rotar, duplicar y eliminar páginas.
- Extraer la página actual a un PDF independiente.
- Combinar varios PDFs en un solo documento y continuar editándolo.
- Añadir texto nuevo.
- **Editar visualmente texto existente:** OpenPDF detecta bloques de texto mediante PDF.js; permite sustituirlos u ocultarlos y guarda el cambio superponiendo contenido nuevo.
- Resaltar áreas.
- Dibujar a mano alzada / firma rápida.
- Insertar imágenes PNG/JPG.
- Detectar y rellenar formularios AcroForm compatibles.
- Marcar áreas para redacción.
- Guardar el resultado como un PDF nuevo.

## Importante sobre "Editar texto"

La v0.2 todavía no reescribe los `content streams` del PDF como un editor de maquetación completo. Para ofrecer una edición útil desde ya, detecta el bloque original, lo cubre y coloca el texto nuevo encima. Es ideal para correcciones cortas, nombres, números y frases pequeñas.

La futura capa de edición avanzada deberá reconstruir líneas/párrafos, conservar fuentes incrustadas y modificar directamente los operadores de contenido del PDF.

## Importante sobre redacción

**La herramienta Redactar de v0.2 es solamente visual.** No debe utilizarse todavía para información confidencial. Un rectángulo negro puede ocultar el contenido a simple vista, pero el texto subyacente puede seguir presente en el archivo.

La siguiente etapa implementará redacción segura rasterizando o reconstruyendo las páginas afectadas antes de guardar, de forma que el contenido oculto no pueda recuperarse mediante selección/extracción de texto.

## Ejecutar en Windows

Necesitas Node.js 20.19+ (o una versión moderna de Node 22).

Desde PowerShell en esta carpeta:

```powershell
npm install
npm run dev
```

O ejecuta:

```text
run_dev.bat
```

Abre la dirección que muestre Vite, normalmente:

```text
http://localhost:1420/
```

## Ejecutar como aplicación Tauri

Para Tauri también necesitas Rust y las Build Tools de Visual Studio para C++.

```powershell
npm install
npm run tauri dev
```

Para compilar instaladores:

```powershell
npm run tauri build
```

## Hoja de ruta

### v0.3
- Redacción segura real.
- Seleccionar, mover, redimensionar y eliminar objetos agregados.
- Historial Undo/Redo completo.
- Guardar rangos de páginas / dividir PDF.
- Miniaturas reales de páginas.

### v0.4
- OCR local para documentos escaneados.
- Crear una capa de texto buscable sobre escaneos.
- Edición de texto asistida por OCR.
- Panel de propiedades: fuente, tamaño, color, alineación y opacidad.

### v0.5+
- Edición avanzada de `content streams`.
- Reconstrucción de párrafos y ajuste automático de línea.
- Fuentes incrustadas y sustitución inteligente de fuentes.
- Firmas digitales criptográficas.
- PDF/A y herramientas de accesibilidad.
- Comparación de documentos.

## Privacidad

El editor está pensado para funcionar localmente. La apertura, renderizado y exportación del PDF no requieren enviar el documento a un servidor.
