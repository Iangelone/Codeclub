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

## Release beta

1. Revisar `git status` y cambios de documentación.
2. Ejecutar build completo.
3. Probar una instalación limpia.
4. Verificar icono, bandeja, links externos y permisos.
5. Crear tag y release de GitHub.
6. Adjuntar instalador y notas de cambios.

> La conexión Android por QR y la ejecución automática de tareas quedan como trabajo futuro hasta que exista su backend/runtime completo.

## Estilo de cambios

- Usar `apply_patch` para editar archivos.
- Preferir cambios pequeños y reversibles.
- No sumar dependencias si ya existe una API del proyecto.
- Documentar eventos y persistencia cuando se agrega una feature.
