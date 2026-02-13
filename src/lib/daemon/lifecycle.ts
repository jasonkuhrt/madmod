import { type ChildProcess, fork } from 'node:child_process'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const CACHE_DIR = 'node_modules/.cache/crossmod'

const pidFilePath = (cwd: string): string => resolve(cwd, CACHE_DIR, 'daemon.pid')
const logFilePath = (cwd: string): string => resolve(cwd, CACHE_DIR, 'daemon.log')

function ensureCacheDir(cwd: string): void {
  const dir = resolve(cwd, CACHE_DIR)
  mkdirSync(dir, { recursive: true })
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readPid(cwd: string): number | null {
  const path = pidFilePath(cwd)
  if (!existsSync(path)) return null
  const raw = readFileSync(path, 'utf-8').trim()
  const pid = Number.parseInt(raw, 10)
  if (Number.isNaN(pid)) return null
  return pid
}

export interface DaemonStatus {
  readonly running: boolean
  readonly pid: number | null
  readonly logFile: string
}

export function getDaemonStatus(cwd: string): DaemonStatus {
  const pid = readPid(cwd)
  if (pid === null) {
    return { running: false, pid: null, logFile: logFilePath(cwd) }
  }
  const alive = isProcessAlive(pid)
  return { running: alive, pid: alive ? pid : null, logFile: logFilePath(cwd) }
}

export function isDaemonRunning(cwd: string): boolean {
  return getDaemonStatus(cwd).running
}

export function startDaemon(cwd: string, configPath?: string): DaemonStatus {
  const status = getDaemonStatus(cwd)
  if (status.running) {
    return status
  }

  ensureCacheDir(cwd)

  // Clean up stale PID file if process is dead
  const stalePid = readPid(cwd)
  if (stalePid !== null) {
    unlinkSync(pidFilePath(cwd))
  }

  const logFile = logFilePath(cwd)

  // Truncate log file on daemon start
  if (existsSync(logFile)) {
    truncateSync(logFile, 0)
  }

  // Open log file for writing
  const logFd = openSync(logFile, 'a')

  // Resolve the daemon entry point
  const thisDir = dirname(fileURLToPath(import.meta.url))
  const entryPoint = resolve(thisDir, '../../bin/daemon-entry.js')

  const args: string[] = ['--cwd', cwd]
  if (configPath) {
    args.push('--config', configPath)
  }

  const child: ChildProcess = fork(entryPoint, args, {
    detached: true,
    stdio: ['ignore', logFd, logFd, 'ipc'],
    cwd,
  })

  const pid = child.pid
  if (pid === undefined) {
    closeSync(logFd)
    throw new Error('Failed to start daemon: no PID returned')
  }

  // Write PID file
  writeFileSync(pidFilePath(cwd), String(pid), 'utf-8')

  // Detach the child so the parent can exit
  child.unref()
  child.disconnect()
  closeSync(logFd)

  return { running: true, pid, logFile }
}

export function stopDaemon(cwd: string): DaemonStatus {
  const pid = readPid(cwd)
  if (pid === null) {
    return { running: false, pid: null, logFile: logFilePath(cwd) }
  }

  const alive = isProcessAlive(pid)
  if (alive) {
    process.kill(pid, 'SIGTERM')
  }

  // Remove PID file
  const path = pidFilePath(cwd)
  if (existsSync(path)) {
    unlinkSync(path)
  }

  return { running: false, pid: null, logFile: logFilePath(cwd) }
}
