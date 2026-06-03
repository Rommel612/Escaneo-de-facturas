# Factura Bot — Guía operacional

## Descripción

Bot de WhatsApp que recibe imágenes o PDFs de facturas, extrae sus datos con Gemini AI (proveedor, fecha, total, IVA, categoría, etc.) y los registra automáticamente. Incluye panel web en tiempo real con exportación a Excel.

## Cuándo usar este bot

- "Procesar una factura desde WhatsApp"
- "Registrar gastos escaneando documentos"
- "Ver el resumen de facturas del mes"
- "Exportar todas las facturas a Excel"

## Prerequisitos

| Requisito | Detalle |
|---|---|
| Node.js | >= 20 |
| `GEMINI_API_KEY` | Gratis en [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `WHATSAPP_PHONE` | Número en formato internacional sin `+` (ej: `521234567890`) |

```bash
npm install
cp .env.example .env
# Editar .env con las credenciales reales
```

## Cómo ejecutar

### Inicio normal
```bash
npm start
```

### Desarrollo con hot-reload
```bash
npm run dev
```

### Primera vinculación de WhatsApp

1. Ejecutar `npm start`
2. Esperar el código de vinculación (aparece en terminal y en el panel web)
3. En el teléfono: WhatsApp → Dispositivos vinculados → Vincular dispositivo → "Vincular con número de teléfono"
4. Ingresar el código de 8 dígitos mostrado en terminal
5. La sesión queda guardada en `auth_info_baileys/` — no se repite en reinicios

### Re-vincular (si la sesión expiró)
```bash
rm -rf auth_info_baileys/   # Linux/Mac
rd /s /q auth_info_baileys  # Windows CMD
npm start
```

## Salida esperada

```
Panel web → http://localhost:3000

╔══════════════════════════════╗
║  CÓDIGO DE VINCULACIÓN       ║
║                              ║
║       XXXX-XXXX              ║
╚══════════════════════════════╝

WhatsApp conectado.
```

Tras vincular, el panel web en `http://localhost:3000` muestra las facturas en tiempo real.

## Parámetros de entorno

| Variable | Tipo | Requerida | Default | Descripción |
|---|---|---|---|---|
| `GEMINI_API_KEY` | string | Sí | — | API key de Google Gemini |
| `WHATSAPP_PHONE` | string | Sí | — | Número internacional sin `+` |
| `PORT` | number | No | `3000` | Puerto del servidor HTTP |

## Errores comunes

| Error | Causa | Solución |
|---|---|---|
| `Falta WHATSAPP_PHONE en .env` | Variable no definida | Añadirla al `.env` |
| `API key de Gemini inválida` | Key inválida o sin cuota | Generar nueva en aistudio.google.com |
| El código de vinculación no aparece | Sesión previa activa | Borrar `auth_info_baileys/` y reiniciar |
| `Connection Failure (401)` | Sesión expirada por WhatsApp | Borrar `auth_info_baileys/` y re-vincular |
| Gemini devuelve 429 | Rate limit de la API gratuita | El bot reintenta automáticamente (hasta 3 veces con backoff) |
| `Cannot find module` | Dependencias no instaladas | Ejecutar `npm install` |

## Notas

- Baileys no es oficial de WhatsApp/Meta. Usar número de prueba para evitar bans.
- `auth_info_baileys/` y `.env` están en `.gitignore` — nunca comitear esas carpetas.
- El modelo de IA es `gemini-2.5-flash` (configurado en `src/vision/gemini.js`).
- La "base de datos" es `data.json` en la raíz — suficiente para volúmenes pequeños; migrar a SQLite si supera 10k registros.
