import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import qrcode from 'qrcode'
import xlsx from 'xlsx'
import { connectToWhatsApp } from './whatsapp.js'
import { getExpenses, getStats } from './db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, { cors: { origin: '*' } })

app.use(express.json())
app.use(express.static(join(__dirname, 'public')))

app.get('/api/expenses', (_req, res) => {
  res.json(getExpenses())
})

app.get('/api/stats', (_req, res) => {
  res.json(getStats())
})

app.get('/api/export', (_req, res) => {
  const expenses = getExpenses()

  const rows = expenses.map(e => ({
    'Proveedor':      e.proveedor     || '',
    'No. Factura':    e.numero_factura || '',
    'Fecha':          e.fecha         || '',
    'Total':          Number(e.total) || 0,
    'Subtotal':       Number(e.subtotal) || 0,
    'IVA':            Number(e.iva)   || 0,
    'Moneda':         e.moneda        || 'USD',
    'Categoría':      e.categoria     || '',
    'Descripción':    e.descripcion   || '',
    'Imagen':         e.imageFile ? `uploads/${e.imageFile}` : '',
    'Registrado':     e.createdAt     || '',
  }))

  const wb = xlsx.utils.book_new()
  const ws = xlsx.utils.json_to_sheet(rows)

  // Column widths
  ws['!cols'] = [
    { wch: 28 }, { wch: 18 }, { wch: 12 }, { wch: 12 },
    { wch: 12 }, { wch: 10 }, { wch: 8  }, { wch: 16 },
    { wch: 40 }, { wch: 30 }, { wch: 22 },
  ]

  xlsx.utils.book_append_sheet(wb, ws, 'Facturas')

  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' })
  const filename = `facturas_${new Date().toISOString().slice(0,10)}.xlsx`

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.send(buf)
})

app.get('/api/whatsapp-qr', async (_req, res) => {
  const phone = process.env.WHATSAPP_PHONE
  if (!phone) return res.json({ qr: null, url: null })
  const url = `https://wa.me/${phone}`
  const qr = await qrcode.toDataURL(url, { width: 256, margin: 2 })
  res.json({ qr, url, phone })
})

let latestPairingCode = null

io.on('connection', (socket) => {
  socket.emit('init', { expenses: getExpenses(), stats: getStats() })
  if (latestPairingCode) socket.emit('pairing-code', latestPairingCode)
})

function broadcastExpense(expense) {
  io.emit('new-expense', { expense, stats: getStats() })
}

function broadcastWaStatus(connected) {
  if (connected) latestPairingCode = null
  io.emit('wa-status', connected)
}

function broadcastPairingCode(code) {
  latestPairingCode = code
  io.emit('pairing-code', code)
}

const PORT = process.env.PORT || 3000

httpServer.listen(PORT, async () => {
  console.log(`\nPanel web → http://localhost:${PORT}\n`)
  try {
    await connectToWhatsApp(broadcastExpense, broadcastWaStatus, broadcastPairingCode)
  } catch (err) {
    console.error('Error iniciando WhatsApp:', err.message)
  }
})
