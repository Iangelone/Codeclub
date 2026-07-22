# Spinner

El spinner del compositor usa una paleta pastel que transiciona automáticamente cuando está en estado `idle`.

## Paleta idle

- `#C7CBFF` — lavanda base.
- `#7DD3FC` — celeste.
- `#86EFAC` — verde.
- `#FDE68A` — amarillo.
- `#F9A8D4` — rosa.
- `#D8B4FE` — violeta.

## Estados

- `streaming`: `#7DD3FC`
- `tool_call`: `#86EFAC`
- `approval`: `#FDE68A`
- `running`: `#D8B4FE`
- `error`: `#FCA5A5`

El spinner no utiliza sombra luminosa; solo cambia de color y mantiene la animación de sus glifos Braille.
