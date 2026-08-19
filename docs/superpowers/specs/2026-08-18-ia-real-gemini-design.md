# PromptFlow v2 — Compresión real con IA (Gemini)

**Fecha:** 2026-08-18
**Estado:** Diseño aprobado, pendiente de implementación (esperando API key de Gemini)

## Problema

PromptFlow v1 es un solo `index.html` estático que comprime prompts con reglas
regex en JavaScript. Funciona, pero no "entiende" el texto: no puede reformular,
resumir ni corregir más allá de lo que las reglas anticipan. El usuario quiere
darle un salto profesional: compresión y corrección **reales con IA**.

## Objetivo

Que un modelo de lenguaje (Google Gemini, nivel gratuito) comprima y corrija el
prompt de verdad, manteniendo toda la información, antes de que el usuario lo
copie. La app debe seguir funcionando aunque la IA falle.

## Restricciones

- **Costo $0.** Gemini tiene nivel gratuito sin tarjeta. Supabase (ya conectado)
  y GitHub Pages son gratuitos.
- **La API key nunca debe ser visible** para los visitantes → requiere backend.
- **La app no puede dejar de funcionar** si la IA no responde (cuota agotada,
  sin internet) → fallback al motor de regex actual.

## Arquitectura

```
Navegador (index.html en GitHub Pages)
        │  POST { text }
        ▼
Supabase Edge Function  "optimize"
        │  key de Gemini = secreto de Supabase (GEMINI_API_KEY)
        ▼
Google Gemini API (gemini-flash, free tier)
        │  { optimized }
        ▼
respuesta al navegador → se muestra en el output
```

### Componentes

**1. Edge Function `optimize` (Supabase, Deno/TypeScript)**
- Entrada: `POST { text: string }`.
- Valida: `text` no vacío, longitud ≤ 5000 caracteres (rechaza con 400 si no).
- Llama a Gemini con un prompt de sistema: comprimir y corregir el texto en
  español, sin perder información, devolviendo solo el texto optimizado.
- Salida: `{ optimized: string }` con CORS habilitado.
- Errores de Gemini (cuota, timeout, 5xx) → responde 502; el frontend cae al
  fallback.
- La key vive como secreto (`GEMINI_API_KEY`), nunca en el código.

**2. Frontend (`index.html`)**
- El botón "Comprimir y Corregir" llama a la Edge Function.
- Muestra estado "optimizando…" mientras espera.
- Si la función responde OK → muestra el resultado y marca la fuente como "IA".
- Si la función falla o tarda demasiado → ejecuta `compress()` (regex actual) y
  marca la fuente como "reglas". La app nunca queda sin resultado.
- Se conserva todo lo existente: contadores, toggle Texto/JSON, copiar, stats,
  ahorro.

### Flujo de datos

1. Usuario escribe el prompt y pulsa Comprimir.
2. Frontend hace `fetch` a la Edge Function con el texto.
3. Function llama a Gemini, devuelve el texto optimizado.
4. Frontend calcula stats (palabras/caracteres/ahorro) sobre el resultado —
   igual que hoy, sin importar si vino de IA o de reglas.

### Manejo de errores

| Situación | Comportamiento |
|---|---|
| Texto vacío | Toast "Escribí algo primero" (ya existe) |
| Texto > 5000 chars | Function responde 400; frontend avisa y usa regex |
| Gemini caído / cuota agotada / timeout | Function 502 o fetch falla; frontend usa regex, marca "reglas" |
| Sin internet | fetch falla; frontend usa regex |

## Fuera de alcance (YAGNI)

- Cuentas de usuario / historial (no pedido en esta fase).
- Rate limiting propio (la cuota de Gemini es el límite de facto; se agrega solo
  si hay abuso real).
- Base de datos (no se persiste nada).

## Pendiente del usuario

- Crear API key gratuita en https://aistudio.google.com/apikey y proveerla para
  guardarla como secreto de Supabase.
