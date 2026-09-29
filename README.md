# OpenPDF v0.3

Editor PDF local y gratuito construido con React + TypeScript + PDF.js + pdf-lib, preparado también para Tauri 2.

## Ejecutar

```powershell
npm install
npm run dev
```

Después abre la dirección que muestre Vite (normalmente `http://localhost:1420`).

## Novedades de v0.3

- Selección de objetos con el cursor.
- Arrastrar objetos insertados o editados.
- Redimensionar imágenes, gráficos, resaltados, redacciones y texto reemplazado.
- Eliminar objetos seleccionados con el botón contextual o `Delete/Supr`.
- Undo/Redo real para cambios en páginas y objetos (`Ctrl+Z`, `Ctrl+Y`).
- División del PDF por grupos de rangos, por ejemplo `1-3; 4-6; 8,10-12`.
- Gráficos de barras, líneas y pastel a partir de datos pegados desde Excel/CSV.
- Detección experimental de tablas/columnas en la página actual para precargar los datos del gráfico.
- Redacción segura al exportar: las páginas que contienen zonas redactadas se rasterizan después de aplicar las ediciones, por lo que el contenido original situado debajo no se conserva en esas páginas del PDF final.

## Importante sobre la redacción segura

La seguridad se obtiene reconstruyendo como imagen las páginas que contienen redacciones. Esto elimina de esas páginas el texto y los objetos PDF subyacentes, pero también hace que el texto de esas páginas deje de ser seleccionable/buscable y que los elementos vectoriales se conviertan en píxeles.

## Gráficos

Pulsa **Gráfico** y pega una tabla como esta:

```text
Mes\tVentas\tCostos
Enero\t120\t80
Febrero\t180\t105
Marzo\t155\t95
```

También puedes copiar directamente un rango de Excel y pegarlo en el cuadro de datos. La primera columna se usa como categoría y las siguientes como series numéricas.

El botón **Detectar tabla de esta página** intenta agrupar texto por filas y columnas usando las coordenadas que entrega PDF.js. Es una heurística: funciona bien con tablas sencillas, pero debes revisar los datos antes de crear el gráfico.

## Limitación importante de edición de texto

La edición de texto existente sigue funcionando como reemplazo visual del bloque detectado. Todavía no reconstruye el `content stream` ni hace reflow de párrafos como un procesador de texto. Esa será una fase posterior.

## Build de escritorio con Tauri

Con Rust y los requisitos de Tauri instalados:

```powershell
npm run tauri dev
npm run tauri build
```
