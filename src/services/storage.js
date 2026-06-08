import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_FILE = join(__dirname, '../../data.json')

function load() {
  if (!existsSync(DB_FILE)) return { expenses: [] }
  try {
    return JSON.parse(readFileSync(DB_FILE, 'utf8'))
  } catch {
    return { expenses: [] }
  }
}

function save(data) {
  writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8')
}

export function getExpenses() {
  return load().expenses
}

export function addExpense(expense) {
  const data = load()
  const item = { id: Date.now().toString(), createdAt: new Date().toISOString(), ...expense }
  data.expenses.unshift(item)
  save(data)
  return item
}

let writeQueue = Promise.resolve()

export function updateExpense(id, fields) {
  const ALLOWED = ['proveedor', 'descripcion', 'categoria', 'banco']

  writeQueue = writeQueue.then(() => {
    const data = load()
    const idx = data.expenses.findIndex(e => e.id === id)
    if (idx === -1) return null
    const patch = Object.fromEntries(
      Object.entries(fields).filter(([k, v]) => ALLOWED.includes(k) && v !== undefined)
    )
    data.expenses[idx] = { ...data.expenses[idx], ...patch, updatedAt: new Date().toISOString() }
    save(data)
    return data.expenses[idx]
  })

  return writeQueue
}

export function deleteExpense(id) {
  const data = load()
  const before = data.expenses.length
  data.expenses = data.expenses.filter(e => e.id !== id)
  if (data.expenses.length === before) return null
  save(data)
  return id
}

function computeStats(expenses) {
  const total = expenses.reduce((sum, e) => sum + (Number(e.total) || 0), 0)
  const count = expenses.length
  return {
    total,
    count,
    average: count > 0 ? total / count : 0,
    lastUpdated: new Date().toISOString()
  }
}

export function getStats() {
  return computeStats(load().expenses)
}

export function getStatsFrom(expenses) {
  return computeStats(expenses)
}

export function findByHash(hash) {
  if (!hash) return null
  return load().expenses.find(e => e.hash === hash) || null
}

export function findByInvoiceNumber(numeroFactura) {
  if (!numeroFactura) return null
  const normalized = String(numeroFactura).trim().toLowerCase()
  return load().expenses.find(e =>
    e.numero_factura && String(e.numero_factura).trim().toLowerCase() === normalized
  ) || null
}
