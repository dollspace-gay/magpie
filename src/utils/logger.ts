// src/utils/logger.ts
import chalk from 'chalk'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

class Logger {
  private level: LogLevel

  constructor() {
    const envLevel = process.env.MAGPIE_LOG_LEVEL?.toLowerCase()
    this.level = envLevel && envLevel in LEVEL_ORDER ? envLevel as LogLevel : 'info'
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.level]
  }

  debug(...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.error(chalk.dim('[DEBUG]'), ...args)
    }
  }

  info(...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.error(chalk.blue('[INFO]'), ...args)
    }
  }

  warn(...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.error(chalk.yellow('[WARN]'), ...args)
    }
  }

  error(...args: unknown[]): void {
    if (this.shouldLog('error')) {
      console.error(chalk.red('[ERROR]'), ...args)
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level
  }

  getLevel(): LogLevel {
    return this.level
  }
}

export const logger = new Logger()
