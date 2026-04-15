import express from 'express'
import axios from 'axios'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const TARGET_BASE = 'https://cz.e-store.best/index.php'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://cz.e-store.best/',
  'Origin': 'https://cz.e-store.best',
}

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// ── GET 代理（get_stats 等）
app.get('/api/proxy', async (req, res) => {
  try {
    const resp = await axios.get(TARGET_BASE, {
      params: req.query,
      headers: HEADERS,
      timeout: 15000,
    })
    res.json(resp.data)
  } catch (e) {
    if (e.response) res.status(e.response.status).send(e.response.data)
    else res.status(500).json({ status: 'error', message: e.message })
  }
})

// ── GET 代理（get_task_logs，返回纯文本）
app.get('/api/proxy/logs', async (req, res) => {
  try {
    const resp = await axios.get(TARGET_BASE, {
      params: req.query,
      headers: HEADERS,
      timeout: 15000,
      responseType: 'text',
    })
    res.type('text/plain').send(resp.data)
  } catch (e) {
    if (e.response) res.status(e.response.status).send(e.response.data)
    else res.status(500).json({ status: 'error', message: e.message })
  }
})

// ── POST 代理（start_run / query_by_auth_code / rollback_auth_code）
app.post('/api/proxy', async (req, res) => {
  try {
    const formData = new URLSearchParams()
    for (const [k, v] of Object.entries(req.body)) {
      formData.append(k, String(v))
    }
    const resp = await axios.post(TARGET_BASE, formData.toString(), {
      headers: {
        ...HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 15000,
    })
    res.json(resp.data)
  } catch (e) {
    if (e.response) res.status(e.response.status).send(e.response.data)
    else res.status(500).json({ status: 'error', message: e.message })
  }
})

// ── 生产环境：托管 Vite 构建产物
const distPath = join(__dirname, '../dist')
if (existsSync(distPath)) {
  app.use(express.static(distPath))
  app.get('*', (req, res) => {
    res.sendFile(join(distPath, 'index.html'))
  })
}

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
