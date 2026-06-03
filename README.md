# Factura Bot — WhatsApp Invoice Tracker

Bot de WhatsApp que extrae automáticamente datos de facturas y recibos usando Gemini AI, los almacena en JSON y los presenta en un panel web en tiempo real.

## Arquitectura

```
ESP/
├── index.js                  ← Entry point (lanza el servidor)
├── src/
│   ├── api/server.js         ← Express + Socket.io (REST API + panel web)
│   ├── whatsapp/whatsapp.js  ← Conexión Baileys (WhatsApp Web no oficial)
│   ├── facturas/db.js        ← Base de datos JSON (data.json)
│   └── vision/gemini.js      ← Extracción de datos con Gemini 2.5 Flash
├── public/
│   ├── index.html            ← Panel web (Vanilla JS + Socket.io)
│   └── uploads/              ← Imágenes y PDFs recibidos por WhatsApp
├── data.json                 ← Base de datos (ignorado en git)
├── auth_info_baileys/        ← Sesión WhatsApp (ignorado en git)
├── .env                      ← Credenciales (ignorado en git)
└── .env.example              ← Plantilla de variables de entorno
```

## Variables de entorno

Copia `.env.example` a `.env` y rellena los valores:

| Variable | Requerida | Descripción |
|---|---|---|
| `GEMINI_API_KEY` | Sí | API Key de Google Gemini — obtener en [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `WHATSAPP_PHONE` | Sí | Número de WhatsApp en formato internacional sin `+` (ej: `521234567890`) |
| `PORT` | No | Puerto del servidor web (default: `3000`) |

## Instalación

```bash
npm install
cp .env.example .env
# Edita .env con tus credenciales
```

## Ejecución

```bash
# Producción
npm start

# Desarrollo (hot-reload)
npm run dev
```

Al iniciar:
1. El servidor levanta en `http://localhost:3000`
2. Se genera un **código de vinculación** de WhatsApp en la terminal (y en el panel web)
3. En WhatsApp → Dispositivos vinculados → Vincular dispositivo → "Vincular con número de teléfono" → ingresa el código
4. Tras vincular, la sesión se guarda en `auth_info_baileys/` — los reinicios posteriores no piden código

## Uso del bot

| Acción | Descripción |
|---|---|
| Enviar imagen de factura | El bot extrae proveedor, fecha, total, IVA, categoría y descripción |
| Enviar PDF de factura | Igual que imagen |
| Escribir `ayuda` | Muestra los comandos disponibles |
| Escribir `resumen` | Muestra el total de facturas del día actual |

## API REST

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/expenses` | Lista todas las facturas |
| `GET` | `/api/stats` | Estadísticas agregadas (total, count, average) |
| `GET` | `/api/export` | Descarga Excel con todas las facturas |
| `DELETE` | `/api/expenses/:id` | Elimina una factura por ID |
| `GET` | `/api/whatsapp-qr` | QR para abrir chat con el bot (requiere `WHATSAPP_PHONE`) |

## Eventos Socket.io

| Evento | Dirección | Payload |
|---|---|---|
| `init` | server → client | `{ expenses[], stats }` — estado inicial al conectar |
| `new-expense` | server → client | `{ expense, stats }` — nueva factura procesada |
| `delete-expense` | server → client | `{ id, stats }` — factura eliminada |
| `wa-status` | server → client | `boolean` — estado de conexión WhatsApp |
| `pairing-code` | server → client | `string` — código de vinculación |

## Categorías reconocidas

`alimentacion` · `transporte` · `oficina` · `servicios` · `tecnologia` · `salud` · `otro`

## Errores comunes

| Error | Causa | Solución |
|---|---|---|
| `Falta WHATSAPP_PHONE en .env` | Variable no configurada | Añadir número internacional sin `+` al `.env` |
| `API key de Gemini inválida` | Key expirada o incorrecta | Generar nueva en aistudio.google.com/apikey |
| Código de vinculación no aparece | Sesión anterior almacenada | Borrar `auth_info_baileys/` y reiniciar |
| WhatsApp se desconecta seguido | Número baneado o error de red | Revisar logs; si es ban usar otro número |
| `Cannot find module` | Dependencias no instaladas | Ejecutar `npm install` |

## Notas de seguridad

- `auth_info_baileys/` contiene las claves de la sesión de WhatsApp — **nunca subir al repositorio**
- `.env` con las API keys — **nunca subir al repositorio**
- Baileys es una librería no oficial; usar número de prueba, no el personal
