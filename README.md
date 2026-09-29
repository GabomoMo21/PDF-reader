# OpenPDF v0.5

Editor PDF local y gratuito construido con React + TypeScript + PDF.js + pdf-lib + Tesseract.js, preparado también para Tauri 2.

## Ejecutar

```powershell
npm install
npm run dev
```

Después abre la dirección que muestre Vite (normalmente `http://localhost:1420`).

## Novedades de v0.5

- OCR de la página actual o de todo el documento con Tesseract.js.
- Español, inglés o español + inglés.
- El PDF no se envía a un servicio de OCR: el reconocimiento ocurre en el equipo. En el primer uso pueden descargarse los modelos de idioma de Tesseract.js.
- Capa OCR guardada dentro del PDF para volver escaneos buscables/seleccionables.
- Vista opcional de cajas OCR y confianza aproximada de cada palabra.
- Corrección de palabras OCR con la herramienta **Editar texto**.
- Detección de tablas mejorada usando alineación vertical y posiciones X recurrentes entre filas.
- Detección desde texto PDF, desde OCR o selección automática de la fuente más útil.
- Mini hoja de cálculo dentro del editor para corregir los datos detectados celda por celda.
- Añadir/eliminar filas y columnas antes de crear el gráfico.
- Gráficos de barras, líneas y pastel desde la tabla reconstruida.
- Conserva las funciones de v0.3: selección y transformación de objetos, Undo/Redo, dividir, combinar, formularios, imágenes y redacción segura.

## Flujo recomendado para un PDF escaneado

1. Abre el PDF.
2. Pulsa **OCR**.
3. Elige español, inglés o ambos.
4. Ejecuta **OCR página** o **OCR documento**.
5. Activa **Ver OCR** si quieres revisar visualmente las palabras reconocidas.
6. Usa **Editar texto** para corregir palabras OCR equivocadas cuando la página no tenía texto nativo.
7. Pulsa **Tabla / Gráfico** y luego **Desde OCR** para intentar reconstruir una tabla.
8. Corrige las celdas en la mini hoja de cálculo.
9. Inserta un gráfico si lo necesitas.
10. Guarda el PDF para incluir la capa OCR.

## Detección de tablas

La v0.5 ya no depende únicamente de espacios grandes entre fragmentos. Ahora:

- agrupa elementos por líneas visuales;
- fusiona palabras cercanas en una misma celda;
- busca coordenadas X que se repiten en varias filas;
- usa esas coordenadas como anclas de columnas;
- elimina columnas y filas demasiado vacías;
- detecta filas numéricas y conserva una posible cabecera;
- muestra una estimación de confianza;
- permite corregir cada celda antes de usar los datos.

No existe una estructura universal de “tabla” dentro de un PDF, así que documentos complejos todavía pueden requerir corrección manual.

## OCR y privacidad

Tesseract.js realiza el reconocimiento en el navegador/app. El contenido de la página se procesa localmente. En el primer uso Tesseract.js puede necesitar descargar archivos de modelo del idioma; esto no implica subir el documento para reconocerlo.

## OCR y redacción segura

La redacción segura tiene prioridad sobre la capa OCR. Las páginas que contienen redacciones se rasterizan al exportar, por lo que el texto que estaba debajo y cualquier capa OCR previa de esa página dejan de estar presentes como texto seleccionable. Esto evita que datos redactados reaparezcan al buscar o copiar.

## Limitación de edición profunda

La edición del texto vectorial original todavía funciona como reemplazo visual del bloque detectado. La siguiente fase grande del proyecto es reconstruir content streams, conservar fuentes incrustadas y permitir reflow real de párrafos.

## Build de escritorio con Tauri

Con Rust y los requisitos de Tauri instalados:

```powershell
npm run tauri dev
npm run tauri build
```


## Novedades v0.5

- Navegación por rueda: desplázate dentro de la página y, al llegar arriba/abajo, pasa automáticamente a la página anterior/siguiente.
- Page Up / Page Down, controles anterior/siguiente, salto directo a página y ajuste al ancho.
- Botón **Analizar** con detección semántica de títulos, párrafos, listas, tablas, encabezados, pies de página e imágenes del PDF.
- Detección de objetos insertados (imágenes, gráficos y firmas/dibujos) y acciones contextuales.
- Las tablas detectadas pueden abrirse en la hoja editable o copiarse como TSV compatible con Excel.

La detección semántica es heurística: los PDF no guardan necesariamente conceptos como “párrafo” o “tabla”. OpenPDF reconstruye estas estructuras a partir de posiciones, tamaños de texto, alineación y operaciones de dibujo.
