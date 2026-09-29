# OpenPDF Editor

Primera versión funcional de un editor PDF gratuito y local.

## Funciones actuales

- Abrir PDFs desde el equipo.
- Visualizar todas las páginas.
- Zoom.
- Insertar texto haciendo clic sobre la página.
- Dibujar a mano alzada.
- Deshacer la última anotación de la página.
- Rotar páginas.
- Eliminar páginas.
- Reordenar páginas.
- Guardar un PDF nuevo con los cambios aplicados.
- Procesamiento local: el documento no se sube a ningún servidor.

## Limitación importante de esta versión

Todavía no edita directamente los objetos de texto que ya existen dentro del PDF. La edición de texto PDF existente requiere reconstrucción de fuentes, operadores de contenido, posiciones y, en ciertos documentos, OCR. Esta función pertenece a la siguiente fase.

## Ejecutar ahora mismo en Windows (modo desarrollo)

Instala Node.js 20+ y después abre PowerShell dentro de esta carpeta:

```powershell
npm install
npm run dev
```

Abre la dirección que muestra Vite (normalmente `http://localhost:1420`).

## Ejecutar como aplicación Tauri

Para compilar la aplicación de escritorio también necesitas:

1. Rust (rustup)
2. Microsoft C++ Build Tools / Visual Studio Build Tools con "Desktop development with C++"
3. WebView2 (incluido normalmente en Windows 10/11)

Luego:

```powershell
npm install
npm run tauri dev
```

Para crear un instalador:

```powershell
npm run tauri build
```

El instalador aparecerá dentro de `src-tauri/target/release/bundle/`.

## Arquitectura

- React + TypeScript: interfaz.
- PDF.js (`pdfjs-dist`): renderizado/lectura del PDF.
- pdf-lib: escritura y modificación del archivo PDF.
- Tauri 2: empaquetado como aplicación nativa de escritorio.

## Próximos pasos sugeridos

1. Seleccionar/mover/editar anotaciones ya agregadas.
2. Insertar imágenes.
3. Resaltador y figuras.
4. Miniaturas reales de cada página.
5. Guardar con diálogo nativo de Windows.
6. Combinar y dividir PDFs.
7. Formularios PDF.
8. OCR para documentos escaneados.
9. Edición real de texto ya existente.
10. Firmas digitales y redacción segura.
