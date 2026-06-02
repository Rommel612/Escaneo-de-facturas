import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_FILE = join(__dirname, 'data.json')

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

export function getStats() {
  const expenses = load().expenses
  const total = expenses.reduce((sum, e) => sum + (Number(e.total) || 0), 0)
  const count = expenses.length
  return {
    total,
    count,
    average: count > 0 ? total / count : 0,
    lastUpdated: new Date().toISOString()
  }
}
