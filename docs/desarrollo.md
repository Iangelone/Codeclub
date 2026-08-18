# Desarrollo y releases

## Requisitos

- Windows.
- Node.js 24 recomendado.
- npm 11 recomendado.
- Dependencias instaladas con `npm install`.

## Comandos

| Comando | Uso |
| --- | --- |
| `npm run dev` | Next.js + Electron en desarrollo. |
| `npm run next:dev` | Solo renderer. |
| `npm run electron:dev` | Compila Electron y abre la app. |
| `npm run next:build` | Build del renderer. |
| `npm run electron:compile` | Compila TypeScript de Electron. |
| `npm run desktop:build` | Build completo de escritorio. |
| `npm run package:win` | Genera el instalador NSIS de Windows en `release/`. |

## Verificación mínima

```bash
npm run next:build
npm run electron:compile
git diff --check
```

Después probar manualmente:

- chat y streaming;
- Inicio versus proyecto;
- persistencia de chats y tareas;
- sidebar derecha y resize;
- navegador, selección y referencias;
- artifacts y terminal;
- idioma español/inglés;
- update, recarga y controles de ventana.

## Release beta en criollo

La versión vive en `package.json` y `package-lock.json`. No se debe subir la versión para
cada prueba local: primero se puede construir e instalar localmente.

### 1. Probar el instalador localmente

```bash
npm install
npm run package:win
```

El instalador aparece en `release/Codeclub Setup X.Y.Z.exe`. Para una prueba limpia,
desinstalar una instalación anterior y ejecutar ese `.exe`. `release/` está ignorado por Git.

`package:win` hace tres cosas: compila Next.js, compila Electron y ejecuta electron-builder
para Windows x64. La opción `--publish never` evita que electron-builder intente publicar
por su cuenta.

### 2. Publicar en GitHub

Cuando la build local está verificada:

```bash
git status
git add .
git commit -m "Describe el cambio"
git push origin main
git tag -a v0.1.1 -m "Codeclub v0.1.1 beta"
git push origin v0.1.1
```

El tag `vX.Y.Z` dispara `.github/workflows/release.yml`. GitHub Actions instala las dependencias,
ejecuta `npm run package:win` en `windows-latest` y publica una release beta con:

- `Codeclub Setup X.Y.Z.exe`: archivo que descarga el usuario final;
- `.blockmap`: soporte técnico para actualizaciones diferenciales;
- `latest.yml`: metadatos del actualizador;
- `builder-debug.yml`: diagnóstico del build;
- hashes SHA-256 y código fuente: verificación o desarrollo.

Para un usuario normal se descarga únicamente el `.exe`.

### 3. Revisar el workflow

```bash
gh run list --workflow release.yml --limit 3
gh run view ID --log-failed
gh release list
```

La release no aparece mientras el job está en `Build installer`. Si falla, corregir el código,
subir una nueva versión/tag y repetir. No reutilizar un tag que ya tenga una release publicada.

### Errores conocidos

- `preload.cjs` debe estar incluido en `build.files`; si falta, la app instalada muestra
  `Unable to load preload script` y el bridge de Electron queda desactivado.
- El build local puede fallar dentro de OneDrive por locks de archivos temporales. Si ocurre,
  usar una carpeta de salida temporal fuera del proyecto con `--config.directories.output`.
- GitHub Actions necesita permisos `contents: write`, ya declarados en el workflow. El token
  de GitHub no debe guardarse en el repositorio.

> La conexión Android por QR y la ejecución automática de tareas quedan como trabajo futuro hasta que exista su backend/runtime completo.

## Estilo de cambios

- Usar `apply_patch` para editar archivos.
- Preferir cambios pequeños y reversibles.
- No sumar dependencias si ya existe una API del proyecto.
- Documentar eventos y persistencia cuando se agrega una feature.
