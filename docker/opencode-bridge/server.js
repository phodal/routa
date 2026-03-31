#!/usr/bin/env node
/**
 * OpenCode ACP Bridge Server
 *
 * Wraps the `opencode acp` CLI (JSON-RPC over stdin/stdout) as an HTTP+SSE API.
 * This allows Routa's DockerOpenCodeAdapter to communicate with opencode inside
 * a Docker container without needing a native HTTP server mode.
 *
 * Endpoints:
 *   GET  /health
 *   POST /session/new    { cwd? }               → { sessionId }
 *   POST /session/prompt { sessionId, prompt }  → text/event-stream (SSE)
 *   POST /session/cancel { sessionId }          → { ok: true }
 *   POST /session/delete { sessionId }          → { ok: true }
 *
 * Agent→Client terminal requests (handled over JSON-RPC):
 *   terminal/create       → spawn persistent process, returns { terminalId }
 *   terminal/output       → returns accumulated { output } for a terminal
 *   terminal/wait_for_exit → awaits process exit, returns { exitCode }
 *   terminal/kill          → SIGTERM then SIGKILL after 3s
 *   terminal/release       → kill + remove from managed set
 */
'use strict'

const http = require('http')
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
// execFile removed — terminal/create now uses spawn for persistent terminals

const PORT = parseInt(process.env.PORT || '4321', 10)
const HOST = process.env.HOST || '0.0.0.0'
const WORKSPACE = process.env.WORKSPACE || process.cwd()

// ─── Resolve the opencode binary ─────────────────────────────────────────────

function resolveOpenCodeBin() {
  const envPath = process.env.OPENCODE_BIN_PATH
  if (envPath && fs.existsSync(envPath)) {
    return envPath
  }

  // Walk up from opencode-ai's bin dir looking for the platform binary
  // (same logic as the opencode-ai wrapper script).
  // Prefer glibc binaries over musl since we now use Debian as the base image.
  const platformCandidates = [
    // Linux arm64 glibc (Debian/Ubuntu)
    '/usr/local/lib/node_modules/opencode-ai/node_modules/opencode-linux-arm64/bin/opencode',
    '/usr/local/lib/node_modules/opencode-linux-arm64/bin/opencode',
    // Linux x64 glibc (Debian/Ubuntu)
    '/usr/local/lib/node_modules/opencode-ai/node_modules/opencode-linux-x64/bin/opencode',
    '/usr/local/lib/node_modules/opencode-linux-x64/bin/opencode',
    // Linux arm64 musl (Alpine fallback)
    '/usr/local/lib/node_modules/opencode-ai/node_modules/opencode-linux-arm64-musl/bin/opencode',
    '/usr/local/lib/node_modules/opencode-linux-arm64-musl/bin/opencode',
    // Linux x64 musl (Alpine fallback)
    '/usr/local/lib/node_modules/opencode-ai/node_modules/opencode-linux-x64-musl/bin/opencode',
    '/usr/local/lib/node_modules/opencode-linux-x64-musl/bin/opencode',
    // Fallback system paths
    '/usr/local/bin/opencode',
    '/usr/bin/opencode',
  ]

  for (const p of platformCandidates) {
    if (fs.existsSync(p)) return p
  }

  return 'opencode' // last resort: rely on PATH
}

const OPENCODE_BIN = resolveOpenCodeBin()
console.log(`[bridge] opencode binary: ${OPENCODE_BIN}`)
console.log(`[bridge] workspace:       ${WORKSPACE}`)

// ─── MCP config setup ─────────────────────────────────────────────────────────
//
// Write MCP server configs to opencode's config file before starting sessions.
// ROUTA_MCP_URL env var points to the Routa coordination server on the host
// (e.g. http://host.docker.internal:3000/api/mcp).

const OPENCODE_CONFIG_DIR = path.join(process.env.HOME || '/root', '.config', 'opencode')
const OPENCODE_CONFIG_FILE = path.join(OPENCODE_CONFIG_DIR, 'opencode.json')
const ROUTA_MCP_URL = process.env.ROUTA_MCP_URL || ''

function setupMcpConfig() {
  try {
    fs.mkdirSync(OPENCODE_CONFIG_DIR, { recursive: true })

    let existing = {}
    try {
      existing = JSON.parse(fs.readFileSync(OPENCODE_CONFIG_FILE, 'utf-8'))
    } catch {
      // file doesn't exist yet — start fresh
    }

    // Merge MCP servers (preserving existing user config)
    const mcp = existing.mcp || {}

    // Routa coordination server (HTTP/SSE) — only if URL is provided
    if (ROUTA_MCP_URL) {
      mcp['routa-coordination'] = { type: 'remote', url: ROUTA_MCP_URL, enabled: true }
      console.log(`[bridge]   routa-coordination → ${ROUTA_MCP_URL}`)
    }

    // Playwright MCP (stdio) — available for headless browser testing
    // OpenCode requires type:"local" with command as an array
    mcp['playwright'] = {
      type: 'local',
      command: ['npx', '@playwright/mcp', '--headless', '--no-sandbox'],
      enabled: true,
    }

    existing.mcp = mcp

    // Configure default model if specified via OPENCODE_MODEL env var
    if (process.env.OPENCODE_MODEL) {
      existing.model = process.env.OPENCODE_MODEL
      console.log(`[bridge]   model → ${process.env.OPENCODE_MODEL}`)
    }

    fs.writeFileSync(OPENCODE_CONFIG_FILE, JSON.stringify(existing, null, 2) + '\n', 'utf-8')
    console.log(`[bridge] Config written to ${OPENCODE_CONFIG_FILE}`)
  } catch (err) {
    console.error('[bridge] Failed to write config:', err.message)
  }
}

setupMcpConfig()

// ─── Session management ───────────────────────────────────────────────────────

let nextReqId = 1
const sessions = new Map() // localSessionId → OpenCodeSession

class OpenCodeSession {
  constructor(cwd) {
    this.cwd = cwd || WORKSPACE
    this.proc = null
    this.buffer = ''
    this.pendingRequests = new Map()
    this.sseClients = new Set()
    this.opencodeSessionId = null
    this.alive = false
    // Terminal lifecycle management
    this.terminals = new Map()   // terminalId → ManagedTerminal
    this.terminalCounter = 0
  }

  /**
   * Spawn opencode in ACP mode and establish the JSON-RPC session.
   * Returns the remote opencode session ID.
   */
  async start() {
    console.log(`[session] spawning opencode acp --cwd ${this.cwd}`)

    this.proc = spawn(OPENCODE_BIN, ['acp', '--cwd', this.cwd], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    this.proc.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString('utf8')
      this._drainBuffer()
    })

    this.proc.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8').trim()
      if (text) process.stderr.write(`[opencode] ${text}\n`)
    })

    this.proc.on('exit', (code, signal) => {
      console.log(`[session] exited code=${code} signal=${signal}`)
      this.alive = false
      for (const [, { reject, timer }] of this.pendingRequests) {
        clearTimeout(timer)
        reject(new Error(`opencode exited (code=${code})`))
      }
      this.pendingRequests.clear()
      for (const { res } of this.sseClients) {
        try { res.end() } catch {} // eslint-disable-line no-empty
      }
      this.sseClients.clear()
    })

    this.proc.on('error', (err) => {
      console.error(`[session] spawn error:`, err)
      this.alive = false
    })

    await new Promise(r => setTimeout(r, 600))

    if (!this.proc.pid) {
      throw new Error(`Failed to spawn opencode (bin: ${OPENCODE_BIN})`)
    }
    this.alive = true

    // ACP handshake
    await this._request('initialize', {
      protocolVersion: 1,
      clientInfo: { name: 'routa-docker-bridge', version: '1.0.0' },
    })

    const result = await this._request('session/new', { cwd: this.cwd, mcpServers: [] })
    this.opencodeSessionId = result.sessionId
    console.log(`[session] ACP session: ${this.opencodeSessionId}`)
    return this.opencodeSessionId
  }

  addSSEClient(res) {
    this.sseClients.add({ res })
  }

  removeSSEClient(res) {
    for (const client of this.sseClients) {
      if (client.res === res) { this.sseClients.delete(client); break }
    }
  }

  /** Send prompt; session/update notifications stream to SSE clients. */
  async sendPrompt(text) {
    return this._request('session/prompt', {
      sessionId: this.opencodeSessionId,
      prompt: [{ type: 'text', text }],
    }, 300000) // 5-minute timeout
  }

  cancel() {
    if (this.alive && this.proc && this.proc.stdin) {
      this._write({
        jsonrpc: '2.0',
        method: 'session/cancel',
        params: { sessionId: this.opencodeSessionId },
      })
    }
  }

  kill() {
    this.alive = false
    // Kill all managed terminal processes
    for (const [termId, terminal] of this.terminals) {
      if (!terminal.exited) {
        console.log(`[terminal] session cleanup — killing ${termId}`)
        try { terminal.process.kill('SIGTERM') } catch {} // eslint-disable-line no-empty
        setTimeout(() => {
          if (!terminal.exited) {
            try { terminal.process.kill('SIGKILL') } catch {} // eslint-disable-line no-empty
          }
        }, 3000)
      }
    }
    this.terminals.clear()
    if (this.proc) {
      try { this.proc.kill('SIGTERM') } catch {} // eslint-disable-line no-empty
      setTimeout(() => {
        if (this.proc && this.proc.exitCode === null) {
          try { this.proc.kill('SIGKILL') } catch {} // eslint-disable-line no-empty
        }
      }, 5000)
    }
  }

  // ── private ──────────────────────────────────────────────────────────────

  _write(msg) {
    if (this.proc && this.proc.stdin) {
      try { this.proc.stdin.write(JSON.stringify(msg) + '\n') } catch {} // eslint-disable-line no-empty
    }
  }

  _drainBuffer() {
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() // keep incomplete last line
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        this._handleMsg(JSON.parse(line))
      } catch {
        // Try to extract embedded JSON objects (some agents mix debug text)
        this._tryExtractJson(line)
      }
    }
  }

  _tryExtractJson(line) {
    let depth = 0, start = -1
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '{') { if (!depth) start = i; depth++ }
      else if (line[i] === '}') {
        depth--
        if (!depth && start >= 0) {
          try { this._handleMsg(JSON.parse(line.slice(start, i + 1))) } catch {} // eslint-disable-line no-empty
          start = -1
        }
      }
    }
  }

  _handleMsg(msg) {
    // Response to a pending request
    if (msg.id != null && (msg.result !== undefined || msg.error !== undefined)) {
      const pending = this.pendingRequests.get(msg.id)
      if (pending) {
        clearTimeout(pending.timer)
        this.pendingRequests.delete(msg.id)
        if (msg.error) {
          pending.reject(new Error(`ACP Error [${msg.error.code}]: ${msg.error.message}`))
        } else {
          pending.resolve(msg.result)
        }
        return
      }
    }

    // Agent→Client request (needs a response)
    if (msg.id != null && msg.method) {
      this._handleAgentRequest(msg)
      return
    }

    // Notification (session/update etc.)
    if (msg.method === 'session/update') {
      this._broadcastSSE(msg)
    }
  }

  _handleAgentRequest(msg) {
    const { method, id, params } = msg

    switch (method) {
      case 'session/request_permission':
        this._write({ jsonrpc: '2.0', id, result: { outcome: { outcome: 'approved' } } })
        break

      case 'fs/read_text_file': {
        const filePath = (params || {}).path
        if (!filePath) {
          this._write({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Missing path' } })
          break
        }
        fs.readFile(filePath, 'utf8', (err, content) => {
          if (err) {
            this._write({ jsonrpc: '2.0', id, error: { code: -32000, message: err.message } })
          } else {
            this._write({ jsonrpc: '2.0', id, result: { content } })
          }
        })
        break
      }

      case 'fs/write_text_file': {
        const { path: writePath, content } = params || {}
        if (!writePath) {
          this._write({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Missing path' } })
          break
        }
        fs.mkdir(path.dirname(writePath), { recursive: true }, () => {
          fs.writeFile(writePath, content || '', 'utf8', (err) => {
            if (err) {
              this._write({ jsonrpc: '2.0', id, error: { code: -32000, message: err.message } })
            } else {
              this._write({ jsonrpc: '2.0', id, result: {} })
            }
          })
        })
        break
      }

      case 'fs/list_directory': {
        const dirPath = (params || {}).path || '.'
        fs.readdir(dirPath, { withFileTypes: true }, (err, entries) => {
          if (err) {
            this._write({ jsonrpc: '2.0', id, error: { code: -32000, message: err.message } })
          } else {
            this._write({
              jsonrpc: '2.0', id,
              result: {
                entries: entries.map(e => ({
                  name: e.name,
                  type: e.isDirectory() ? 'directory' : 'file',
                }))
              }
            })
          }
        })
        break
      }

      case 'terminal/create': {
        const MAX_TERMINALS = 10
        const MAX_OUTPUT_BYTES = 1024 * 1024 // 1 MB

        if (this.terminals.size >= MAX_TERMINALS) {
          this._write({ jsonrpc: '2.0', id, error: { code: -32000, message: `Terminal limit reached (max ${MAX_TERMINALS})` } })
          break
        }

        const p = params || {}
        const command = typeof p.command === 'string' ? p.command
          : Array.isArray(p.command) ? p.command.join(' ') : ''
        const terminalId = `term-${++this.terminalCounter}-${Date.now()}`

        if (!command) {
          this._write({ jsonrpc: '2.0', id, result: { terminalId } })
          break
        }

        // Broadcast terminal_created event
        this._broadcastSSE({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: this.opencodeSessionId,
            update: { sessionUpdate: 'terminal_created', terminalId, command },
          },
        })

        let exitResolve
        const exitPromise = new Promise((resolve) => { exitResolve = resolve })

        const termProc = spawn(command, [], {
          shell: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: (p.cwd) || this.cwd,
          env: { ...process.env, ...(p.env || {}), FORCE_COLOR: '1', TERM: 'xterm-256color' },
        })

        const managed = {
          terminalId,
          process: termProc,
          output: '',
          exitCode: null,
          exited: false,
          exitPromise,
          exitResolve,
        }

        const appendOutput = (data) => {
          if (managed.output.length < MAX_OUTPUT_BYTES) {
            managed.output += data.substring(0, MAX_OUTPUT_BYTES - managed.output.length)
          }
          this._broadcastSSE({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              sessionId: this.opencodeSessionId,
              update: { sessionUpdate: 'terminal_output', terminalId, data },
            },
          })
        }

        termProc.stdout.on('data', (chunk) => appendOutput(chunk.toString('utf-8')))
        termProc.stderr.on('data', (chunk) => appendOutput(chunk.toString('utf-8')))

        termProc.on('exit', (code, signal) => {
          console.log(`[terminal] ${terminalId} exited code=${code} signal=${signal}`)
          managed.exitCode = code ?? (signal ? 128 : 0)
          managed.exited = true
          exitResolve(managed.exitCode)
          this._broadcastSSE({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              sessionId: this.opencodeSessionId,
              update: { sessionUpdate: 'terminal_exited', terminalId, exitCode: managed.exitCode },
            },
          })
        })

        termProc.on('error', (err) => {
          console.error(`[terminal] ${terminalId} error:`, err)
          managed.exited = true
          managed.exitCode = 1
          exitResolve(1)
        })

        this.terminals.set(terminalId, managed)
        this._write({ jsonrpc: '2.0', id, result: { terminalId } })
        break
      }

      case 'terminal/output': {
        const termId = (params || {}).terminalId
        const terminal = termId ? this.terminals.get(termId) : null
        this._write({ jsonrpc: '2.0', id, result: { output: terminal ? terminal.output : '' } })
        break
      }

      case 'terminal/wait_for_exit': {
        const termId = (params || {}).terminalId
        const terminal = termId ? this.terminals.get(termId) : null

        if (!terminal) {
          this._write({ jsonrpc: '2.0', id, result: { exitCode: -1 } })
          break
        }

        if (terminal.exited) {
          this._write({ jsonrpc: '2.0', id, result: { exitCode: terminal.exitCode ?? 0 } })
          break
        }

        terminal.exitPromise.then((exitCode) => {
          this._write({ jsonrpc: '2.0', id, result: { exitCode } })
        })
        break
      }

      case 'terminal/kill': {
        const termId = (params || {}).terminalId
        const terminal = termId ? this.terminals.get(termId) : null

        if (terminal && !terminal.exited) {
          console.log(`[terminal] killing ${termId}`)
          try {
            terminal.process.kill('SIGTERM')
            setTimeout(() => {
              if (!terminal.exited) {
                try { terminal.process.kill('SIGKILL') } catch {} // eslint-disable-line no-empty
              }
            }, 3000)
          } catch (err) {
            console.error(`[terminal] error killing ${termId}:`, err)
          }
        }
        this._write({ jsonrpc: '2.0', id, result: {} })
        break
      }

      case 'terminal/release': {
        const termId = (params || {}).terminalId
        const terminal = termId ? this.terminals.get(termId) : null

        if (terminal) {
          console.log(`[terminal] releasing ${termId}`)
          if (!terminal.exited) {
            try {
              terminal.process.kill('SIGTERM')
              setTimeout(() => {
                if (!terminal.exited) {
                  try { terminal.process.kill('SIGKILL') } catch {} // eslint-disable-line no-empty
                }
              }, 3000)
            } catch {} // eslint-disable-line no-empty
          }
          this.terminals.delete(termId)
        }
        this._write({ jsonrpc: '2.0', id, result: {} })
        break
      }

      default:
        console.warn(`[session] unhandled agent request: ${method}`)
        this._write({ jsonrpc: '2.0', id, result: {} })
        break
    }
  }

  _broadcastSSE(msg) {
    const frame = `data: ${JSON.stringify(msg)}\n\n`
    for (const { res } of this.sseClients) {
      try { res.write(frame) } catch { this.sseClients.delete({ res }) }
    }
  }

  _request(method, params, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const id = nextReqId++
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Timeout waiting for "${method}" (${timeout}ms)`))
      }, timeout)
      this.pendingRequests.set(id, { resolve, reject, timer })
      this._write({ jsonrpc: '2.0', id, method, params })
    })
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) }
      catch { resolve({}) }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, body) {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
    'Access-Control-Allow-Origin': '*',
  })
  res.end(json)
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0]

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
    res.end()
    return
  }

  try {
    // ── GET /health ────────────────────────────────────────────────────────
    if (req.method === 'GET' && urlPath === '/health') {
      return sendJson(res, 200, {
        status: 'ok',
        bin: OPENCODE_BIN,
        binExists: fs.existsSync(OPENCODE_BIN),
        sessions: sessions.size,
      })
    }

    // ── POST /session/new ──────────────────────────────────────────────────
    if (req.method === 'POST' && urlPath === '/session/new') {
      const body = await readBody(req)
      const cwd = body.cwd || WORKSPACE
      const session = new OpenCodeSession(cwd)

      await session.start() // may throw — lets HTTP handler return 500

      const localId = `bridge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      sessions.set(localId, session)

      return sendJson(res, 200, { sessionId: localId })
    }

    // ── POST /session/prompt → SSE ─────────────────────────────────────────
    if (req.method === 'POST' && urlPath === '/session/prompt') {
      const body = await readBody(req)
      const { sessionId, prompt } = body

      const session = sessions.get(sessionId)
      if (!session) return sendJson(res, 404, { error: `Session not found: ${sessionId}` })
      if (!session.alive) return sendJson(res, 409, { error: 'Session process has exited' })

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      })

      session.addSSEClient(res)

      const cleanup = () => session.removeSSEClient(res)
      req.on('close', cleanup)
      req.on('error', cleanup)

      try {
        await session.sendPrompt(prompt)
        // DockerOpenCodeAdapter appends its own turn_complete after SSE ends
      } catch (err) {
        const errEvent = {
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId,
            update: { sessionUpdate: 'error', error: err.message },
          },
        }
        res.write(`data: ${JSON.stringify(errEvent)}\n\n`)
      } finally {
        cleanup()
        res.end()
      }
      return
    }

    // ── POST /session/cancel ───────────────────────────────────────────────
    if (req.method === 'POST' && urlPath === '/session/cancel') {
      const body = await readBody(req)
      const session = sessions.get(body.sessionId)
      if (session) session.cancel()
      return sendJson(res, 200, { ok: true })
    }

    // ── POST /session/delete ───────────────────────────────────────────────
    if (req.method === 'POST' && urlPath === '/session/delete') {
      const body = await readBody(req)
      const session = sessions.get(body.sessionId)
      if (session) {
        session.kill()
        sessions.delete(body.sessionId)
      }
      return sendJson(res, 200, { ok: true })
    }

    sendJson(res, 404, { error: 'Not found' })
  } catch (err) {
    console.error('[server] unhandled error:', err)
    if (!res.headersSent) sendJson(res, 500, { error: err.message })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`[bridge] listening on http://${HOST}:${PORT}`)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[bridge] SIGTERM — shutting down')
  for (const session of sessions.values()) session.kill()
  server.close(() => process.exit(0))
})
