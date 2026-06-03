import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { readdirSync, statSync, unlinkSync } from 'fs'
import { PORT } from './src/config.js'
import { getExpenses, getStats, getStatsFrom } from './src/services/storage.js'
import { registerRoutes } from './src/routes/api.js'
import { connectToWhatsApp, waEvents } from './src/services/whatsapp.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const httpServer = createServer(app)

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:3000'
const io = new Server(httpServer, { cors: { origin: ALLOWED_ORIGIN } })

app.use(express.json())
app.use(express.static(join(__dirname, 'public')))

registerRoutes(app, io)

const UPLOADS_DIR = join(__dirname, 'public', 'uploads')
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000 // 90 días

function cleanOldUploads() {
  try {
    const now = Date.now()
    const files = readdirSync(UPLOADS_DIR)
    let deleted = 0
    for (const file of files) {
      if (file === '.gitkeep') continue
      const filepath = join(UPLOADS_DIR, file)
      const { mtimeMs } = statSync(filepath)
      if (now - mtimeMs > MAX_AGE_MS) {
        unlinkSync(filepath)
        deleted++
      }
    }
    if (deleted > 0) console.log(`[cleanup] ${deleted} archivo(s) de uploads eliminados`)
  } catch (err) {
    console.error('[cleanup] Error limpiando uploads:', err.message)
  }
}

cleanOldUploads()
setInterval(cleanOldUploads, 24 * 60 * 60 * 1000)

let latestPairingCode = null

io.on('connection', (socket) => {
  socket.emit('init', { expenses: getExpenses(), stats: getStats() })
  if (latestPairingCode) socket.emit('pairing-code', latestPairingCode)
})

waEvents.on('expense', (expense) => {
  const expenses = getExpenses()
  io.emit('new-expense', { expense, stats: getStatsFrom(expenses) })
})

waEvents.on('status', (connected) => {
  if (connected) latestPairingCode = null
  io.emit('wa-status', connected)
})

waEvents.on('pairing-code', (code) => {
  latestPairingCode = code
  io.emit('pairing-code', code)
})

httpServer.listen(PORT, async () => {
  console.log(`\nPanel web → http://localhost:${PORT}\n`)
  try {
    await connectToWhatsApp()
  } catch (err) {
    console.error('Error iniciando WhatsApp:', err.message)
  }
})
