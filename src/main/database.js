const sqlite3 = require('sqlite3').verbose()
const path = require('path')
const fs = require('fs')

class Database {
	constructor() {
		// Новый путь: data/rep4rep.db в корне проекта
		const dataDir = path.join(process.cwd(), 'data')
		if (!fs.existsSync(dataDir)) {
			fs.mkdirSync(dataDir, { recursive: true })
		}
		this.dbPath = path.join(dataDir, 'rep4rep.db')
		this.db = null
		this.isClosed = false
		this.init()
	}

	init() {
		// Создаем директорию data если её нет
		const dataDir = path.dirname(this.dbPath)
		if (!fs.existsSync(dataDir)) {
			fs.mkdirSync(dataDir, { recursive: true })
		}

		this.db = new sqlite3.Database(this.dbPath, err => {
			if (err) {
				console.error('Database connection error:', err.message)
			} else {
				console.log('Database connection established')
				this.createTables()
			}
		})
	}

	createTables() {
		// Таблица аккаунтов
		const createAccountsTable = `
            CREATE TABLE IF NOT EXISTS accounts (
                id TEXT PRIMARY KEY,
                login TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                twoFA TEXT,
                token TEXT,
                steamId TEXT,
                lastComment INTEGER,
                tasksToday INTEGER DEFAULT 0,
                status TEXT DEFAULT 'ready',
                createdAt INTEGER DEFAULT (strftime('%s', 'now')),
                updatedAt INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `

		// Таблица настроек
		const createSettingsTable = `
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT,
                updatedAt INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `

		// Таблица логов заданий
		const createTaskLogsTable = `
            CREATE TABLE IF NOT EXISTS task_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                accountId TEXT,
                taskId TEXT,
                targetSteamId TEXT,
                commentId TEXT,
                status TEXT,
                createdAt INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (accountId) REFERENCES accounts (id)
            )
        `

		// Таблица статистики
		const createStatsTable = `
            CREATE TABLE IF NOT EXISTS stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                accountId TEXT,
                date TEXT,
                tasksCompleted INTEGER DEFAULT 0,
                pointsEarned INTEGER DEFAULT 0,
                FOREIGN KEY (accountId) REFERENCES accounts (id),
                UNIQUE(accountId, date)
            )
        `

		this.db.serialize(() => {
			this.db.run(createAccountsTable)
			// Автоматическая миграция: добавляем steamId, если его нет
			this.db.get('PRAGMA table_info(accounts)', (err, row) => {
				if (err) return
				this.db.all('PRAGMA table_info(accounts)', (err, columns) => {
					if (err) return
					const hasSteamId = columns.some(col => col.name === 'steamId')
					if (!hasSteamId) {
						this.db.run('ALTER TABLE accounts ADD COLUMN steamId TEXT;')
					}
				})
			})
			this.db.run(createSettingsTable)
			this.db.run(createTaskLogsTable)
			this.db.run(createStatsTable)
		})
	}

	// Методы для работы с аккаунтами
	async addAccount(account) {
		if (this.isClosed) throw new Error('Database is closed')
		return new Promise((resolve, reject) => {
			const sql = `
                INSERT INTO accounts (id, login, password, twoFA, token, steamId, lastComment, tasksToday, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `

			this.db.run(
				sql,
				[
					account.id,
					account.login,
					account.password,
					account.twoFA,
					account.token,
					account.steamId || null,
					account.lastComment,
					account.tasksToday || 0,
					account.status || 'ready',
				],
				function (err) {
					if (err) {
						reject(err)
					} else {
						resolve({ id: this.lastID })
					}
				}
			)
		})
	}

	async getAccounts() {
		if (this.isClosed) throw new Error('Database is closed')
		return new Promise((resolve, reject) => {
			const sql = 'SELECT * FROM accounts ORDER BY createdAt DESC'

			this.db.all(sql, [], (err, rows) => {
				if (err) {
					reject(err)
				} else {
					resolve(rows)
				}
			})
		})
	}

	async getAccountById(id) {
		if (this.isClosed) throw new Error('Database is closed')
		return new Promise((resolve, reject) => {
			const sql = 'SELECT * FROM accounts WHERE id = ?'

			this.db.get(sql, [id], (err, row) => {
				if (err) {
					reject(err)
				} else {
					resolve(row)
				}
			})
		})
	}

	async updateAccount(id, updates) {
		if (this.isClosed) throw new Error('Database is closed')
		return new Promise((resolve, reject) => {
			const fields = Object.keys(updates)
			const values = Object.values(updates)
			const setClause = fields.map(field => `${field} = ?`).join(', ')

			const sql = `UPDATE accounts SET ${setClause}, updatedAt = strftime('%s', 'now') WHERE id = ?`

			this.db.run(sql, [...values, id], function (err) {
				if (err) {
					reject(err)
				} else {
					resolve({ changes: this.changes })
				}
			})
		})
	}

	async deleteAccount(id) {
		if (this.isClosed) throw new Error('Database is closed')
		return new Promise((resolve, reject) => {
			const sql = 'DELETE FROM accounts WHERE id = ?'

			this.db.run(sql, [id], function (err) {
				if (err) {
					reject(err)
				} else {
					resolve({ changes: this.changes })
				}
			})
		})
	}

	// Методы для работы с настройками
	async getSetting(key) {
		if (this.isClosed) throw new Error('Database is closed')
		return new Promise((resolve, reject) => {
			const sql = 'SELECT value FROM settings WHERE key = ?'

			this.db.get(sql, [key], (err, row) => {
				if (err) {
					reject(err)
				} else {
					resolve(row ? row.value : null)
				}
			})
		})
	}

	async setSetting(key, value) {
		if (this.isClosed) throw new Error('Database is closed')
		return new Promise((resolve, reject) => {
			const sql = `
                INSERT OR REPLACE INTO settings (key, value, updatedAt)
                VALUES (?, ?, strftime('%s', 'now'))
            `

			this.db.run(sql, [key, value], function (err) {
				if (err) {
					reject(err)
				} else {
					resolve({ changes: this.changes })
				}
			})
		})
	}

	async getAllSettings() {
		if (this.isClosed) throw new Error('Database is closed')
		return new Promise((resolve, reject) => {
			const sql = 'SELECT key, value FROM settings'

			this.db.all(sql, [], (err, rows) => {
				if (err) {
					reject(err)
				} else {
					const settings = {}
					rows.forEach(row => {
						try {
							settings[row.key] = JSON.parse(row.value)
						} catch {
							settings[row.key] = row.value
						}
					})
					resolve(settings)
				}
			})
		})
	}

	async saveSettings(settings) {
		if (this.isClosed) throw new Error('Database is closed')
		return new Promise((resolve, reject) => {
			this.db.serialize(() => {
				const stmt = this.db.prepare(`
                    INSERT OR REPLACE INTO settings (key, value, updatedAt)
                    VALUES (?, ?, strftime('%s', 'now'))
                `)

				let errors = []
				let completed = 0
				const total = Object.keys(settings).length

				for (const [key, value] of Object.entries(settings)) {
					stmt.run([key, JSON.stringify(value)], function (err) {
						if (err) {
							errors.push(err)
						}
						completed++

						if (completed === total) {
							stmt.finalize()
							if (errors.length > 0) {
								reject(errors[0])
							} else {
								resolve({ success: true })
							}
						}
					})
				}
			})
		})
	}

	// Методы для работы с логами заданий
	async addTaskLog(log) {
		if (this.isClosed) throw new Error('Database is closed')
		return new Promise((resolve, reject) => {
			const sql = `
                INSERT INTO task_logs (accountId, taskId, targetSteamId, commentId, status)
                VALUES (?, ?, ?, ?, ?)
            `

			this.db.run(
				sql,
				[
					log.accountId,
					log.taskId,
					log.targetSteamId,
					log.commentId,
					log.status,
				],
				function (err) {
					if (err) {
						reject(err)
					} else {
						resolve({ id: this.lastID })
					}
				}
			)
		})
	}

	async getTaskLogs(accountId = null, limit = 100) {
		if (this.isClosed) throw new Error('Database is closed')
		return new Promise((resolve, reject) => {
			let sql = 'SELECT * FROM task_logs'
			let params = []

			if (accountId) {
				sql += ' WHERE accountId = ?'
				params.push(accountId)
			}

			sql += ' ORDER BY createdAt DESC LIMIT ?'
			params.push(limit)

			this.db.all(sql, params, (err, rows) => {
				if (err) {
					reject(err)
				} else {
					resolve(rows)
				}
			})
		})
	}

	// Методы для работы со статистикой
	async updateDailyStats(accountId, tasksCompleted = 0, pointsEarned = 0) {
		if (this.isClosed) throw new Error('Database is closed')
		return new Promise((resolve, reject) => {
			const today = new Date().toISOString().split('T')[0]

			const sql = `
                INSERT OR REPLACE INTO stats (accountId, date, tasksCompleted, pointsEarned)
                VALUES (?, ?, 
                    COALESCE((SELECT tasksCompleted FROM stats WHERE accountId = ? AND date = ?), 0) + ?,
                    COALESCE((SELECT pointsEarned FROM stats WHERE accountId = ? AND date = ?), 0) + ?
                )
            `

			this.db.run(
				sql,
				[
					accountId,
					today,
					accountId,
					today,
					tasksCompleted,
					accountId,
					today,
					pointsEarned,
				],
				function (err) {
					if (err) {
						reject(err)
					} else {
						resolve({ changes: this.changes })
					}
				}
			)
		})
	}

	async getDailyStats(accountId, date = null) {
		if (this.isClosed) throw new Error('Database is closed')
		return new Promise((resolve, reject) => {
			const targetDate = date || new Date().toISOString().split('T')[0]
			const sql = 'SELECT * FROM stats WHERE accountId = ? AND date = ?'

			this.db.get(sql, [accountId, targetDate], (err, row) => {
				if (err) {
					reject(err)
				} else {
					resolve(row || { tasksCompleted: 0, pointsEarned: 0 })
				}
			})
		})
	}

	// Сброс счетчика заданий для аккаунта (если прошло 24 часа с последнего комментария)
	async resetTaskCounterIfNeeded(accountId) {
		if (this.isClosed) throw new Error('Database is closed')
		return new Promise((resolve, reject) => {
			// Получаем аккаунт
			this.db.get(
				'SELECT * FROM accounts WHERE id = ?',
				[accountId],
				(err, account) => {
					if (err) {
						reject(err)
						return
					}

					if (!account) {
						reject(new Error('Account not found'))
						return
					}

					// Если никогда не комментировал, сбрасываем счетчик
					if (!account.lastComment) {
						this.db.run(
							'UPDATE accounts SET tasksToday = 0 WHERE id = ?',
							[accountId],
							function (err) {
								if (err) {
									reject(err)
								} else {
									resolve({ reset: true, changes: this.changes })
								}
							}
						)
						return
					}

					// Проверяем, прошло ли 24 часа
					const lastCommentTime = new Date(account.lastComment)
					const now = new Date()
					const hoursSinceLastComment =
						(now - lastCommentTime) / (1000 * 60 * 60)

					if (hoursSinceLastComment >= 24) {
						this.db.run(
							'UPDATE accounts SET tasksToday = 0 WHERE id = ?',
							[accountId],
							function (err) {
								if (err) {
									reject(err)
								} else {
									resolve({ reset: true, changes: this.changes })
								}
							}
						)
					} else {
						resolve({
							reset: false,
							hoursRemaining: 24 - hoursSinceLastComment,
						})
					}
				}
			)
		})
	}

	// Проверка возможности выполнения заданий (прошло ли 24 часа с последнего комментария)
	async canPerformTasks(accountId) {
		if (this.isClosed) throw new Error('Database is closed')
		return new Promise((resolve, reject) => {
			this.db.get(
				'SELECT lastComment FROM accounts WHERE id = ?',
				[accountId],
				(err, account) => {
					if (err) {
						reject(err)
						return
					}

					if (!account) {
						resolve(false)
						return
					}

					// Если никогда не комментировал, может выполнять задания
					if (!account.lastComment) {
						resolve(true)
						return
					}

					// Проверяем, прошло ли 24 часа
					const lastCommentTime = new Date(account.lastComment)
					const now = new Date()
					const hoursSinceLastComment =
						(now - lastCommentTime) / (1000 * 60 * 60)

					resolve(hoursSinceLastComment >= 24)
				}
			)
		})
	}

	// Получение времени до следующего сброса счетчика
	async getTimeUntilReset(accountId) {
		if (this.isClosed) throw new Error('Database is closed')
		return new Promise((resolve, reject) => {
			this.db.get(
				'SELECT lastComment FROM accounts WHERE id = ?',
				[accountId],
				(err, account) => {
					if (err) {
						reject(err)
						return
					}

					if (!account || !account.lastComment) {
						resolve(0) // Может выполнять задания сразу
						return
					}

					const lastCommentTime = new Date(account.lastComment)
					const resetTime = new Date(
						lastCommentTime.getTime() + 24 * 60 * 60 * 1000
					)
					const now = new Date()

					resolve(Math.max(0, resetTime - now))
				}
			)
		})
	}

	// Закрытие соединения с базой данных
	close() {
		if (this.db) {
			this.db.close(err => {
				if (err) {
					console.error('Database connection close error:', err.message)
				} else {
					console.log('Database connection closed')
				}
			})
			this.isClosed = true
		}
	}
}

module.exports = Database
