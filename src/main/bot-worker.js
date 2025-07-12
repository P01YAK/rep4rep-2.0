const EventEmitter = require('events')

class BotWorker extends EventEmitter {
	constructor(database, steamManager, rep4repAPI) {
		super()
		this.database = database
		this.steamManager = steamManager
		this.rep4repAPI = rep4repAPI

		this.isRunning = false
		this.workers = new Map() // accountId -> worker info
		this.settings = {
			taskDelay: 30,
			commentDelay: 5,
			workMode: 'parallel',
			maxConcurrentAccounts: 10,
		}

		this.taskQueue = []
		this.completedTasks = 0
		this.failedTasks = 0
		this.startStatusUpdater()
	}

	async start(settings) {
		if (this.isRunning) {
			throw new Error('Bot is already running')
		}

		this.settings = { ...this.settings, ...settings }
		this.isRunning = true
		this.completedTasks = 0
		this.failedTasks = 0

		this.emit('started')
		this.log('info', 'Bot started')

		try {
			// Get all accounts
			let accounts = await this.database.getAccounts()
			// Log account statuses
			this.log('info', 'List of accounts before filtering:')
			accounts.forEach(acc => {
				const client = this.steamManager.getSteamClient(acc.id)
				this.log(
					'info',
					`id=${acc.id}, login=${acc.login}, status=${acc.status}, isLoggedIn=${
						client && client.isLoggedIn
					}`
				)
			})
			// Take only accounts with steamId
			accounts = accounts.filter(acc => acc.steamId)
			if (accounts.length === 0) {
				this.log(
					'error',
					'No accounts with steamId to start. Add at least one account with steamId.'
				)
				throw new Error('No accounts with steamId to start')
			}
			// Set API token
			this.rep4repAPI.setApiToken(this.settings.apiKey)
			// Start work depending on mode
			if (this.settings.workMode === 'parallel') {
				await this.startParallelMode(accounts)
			} else {
				await this.startSequentialMode(accounts)
			}
			// After work update statuses
			for (const acc of accounts) {
				await this.database.updateAccount(acc.id, { status: 'offline' })
			}
		} catch (error) {
			this.log('error', `Bot start error: ${error.message}`)
			this.stop()
			throw error
		}
	}

	async stop() {
		if (!this.isRunning) {
			return
		}

		this.isRunning = false

		// Stop all workers
		for (const [accountId, worker] of this.workers.entries()) {
			if (worker.timeout) {
				clearTimeout(worker.timeout)
			}
			worker.isActive = false
		}

		this.workers.clear()
		this.taskQueue = []

		this.emit('stopped')
		this.log('info', 'Bot stopped')
	}

	async startParallelMode(accounts) {
		this.log(
			'info',
			`Starting in parallel mode for ${accounts.length} accounts`
		)
		const maxAccounts = Math.max(
			1,
			Math.min(10, this.settings.maxConcurrentAccounts || 10)
		)
		// Очередь аккаунтов
		const queue = [...accounts]
		let running = 0
		const next = async () => {
			if (!this.isRunning) return
			if (queue.length === 0) return
			if (running >= maxAccounts) return
			const account = queue.shift()
			const canWork = await this.canAccountWork(account)
			if (!canWork) {
				this.log('warning', `Account ${account.login} cannot work now`)
				// Если аккаунт не может работать, сразу пробуем следующий
				await next()
				return
			}
			running++
			this.log('info', `Worker started for account ${account.login}`)
			await this.startAccountWorkerWithCallback(account, async () => {
				running--
				await next()
			})
		}
		// Запускаем первые maxAccounts воркеров
		const starters = []
		for (let i = 0; i < maxAccounts && i < queue.length; i++) {
			starters.push(next())
		}
		await Promise.all(starters)
		// После завершения всех аккаунтов пробуем снова через 5 минут, если бот не остановлен
		if (this.isRunning && queue.length === 0 && running === 0) {
			this.log('info', 'All accounts processed, restarting in 5 minutes')
			setTimeout(() => {
				if (this.isRunning) {
					this.startParallelMode(accounts)
				}
			}, 5 * 60 * 1000)
		}
	}

	async startSequentialMode(accounts) {
		this.log(
			'info',
			`Starting in sequential mode for ${accounts.length} accounts`
		)

		for (const account of accounts) {
			if (!this.isRunning) break

			const canWork = await this.canAccountWork(account)
			if (!canWork) {
				this.log('warning', `Account ${account.login} skipped`)
				continue
			}

			// Авторизация по токену/паролю, если не авторизован
			if (!this.steamManager.isAccountLoggedIn(account.id)) {
				this.log('info', `Authorizing account ${account.login}`)
				try {
					await this.steamManager.loginAccount(account.id)
				} catch (err) {
					this.log(
						'error',
						`Account ${account.login} authorization error: ${err.message}`
					)
					continue // Переходим к следующему аккаунту
				}
			}

			// Выполнение задач с обработкой 429
			let retry = true
			while (retry && this.isRunning) {
				retry = false
				try {
					await this.processAccountTasks(account)
				} catch (error) {
					if (
						(error && error.code === 429) ||
						(typeof error.message === 'string' &&
							error.message.includes('429')) ||
						(typeof error.message === 'string' &&
							error.message.includes('Too Many Requests'))
					) {
						this.log(
							'warning',
							'Received 429 Too Many Requests. Pausing for 5 minutes...'
						)
						await this.delay(5 * 60 * 1000)
						retry = true
						continue
					} else {
						throw error
					}
				}
			}

			// Логаут после завершения
			this.log('info', `Account ${account.login} finished work, logging out`)
			await this.steamManager.logoutAccount(account.id)

			// Задержка между аккаунтами (если не последний)
			if (this.isRunning && accounts.indexOf(account) < accounts.length - 1) {
				await this.delay(this.settings.taskDelay * 1000)
			}
		}

		if (this.isRunning) {
			this.log('info', 'All accounts processed, restarting in 5 minutes')
			setTimeout(() => {
				if (this.isRunning) {
					this.startSequentialMode(accounts)
				}
			}, 5 * 60 * 1000)
		}
	}

	async startAccountWorker(account) {
		if (this.workers.has(account.id)) {
			const worker = this.workers.get(account.id)
			if (worker.isProcessing) return // Уже работает
		}
		const worker = {
			accountId: account.id,
			login: account.login,
			isActive: true,
			isProcessing: true,
			tasksProcessed: 0,
			lastActivity: Date.now(),
			timeout: null,
		}
		this.workers.set(account.id, worker)
		this.log('info', `Worker started for account ${account.login}`)
		this.processAccountTasksLoop(account, worker).finally(() => {
			worker.isProcessing = false
		})
	}

	async startAccountWorkerWithCallback(account, onFinish) {
		if (this.workers.has(account.id)) {
			const worker = this.workers.get(account.id)
			if (worker.isProcessing) return
		}
		const worker = {
			accountId: account.id,
			login: account.login,
			isActive: true,
			isProcessing: true,
			tasksProcessed: 0,
			lastActivity: Date.now(),
			timeout: null,
		}
		this.workers.set(account.id, worker)
		this.processAccountTasksLoop(account, worker).finally(() => {
			worker.isProcessing = false
			if (typeof onFinish === 'function') onFinish()
		})
	}

	async processAccountTasksLoop(account, worker) {
		while (this.isRunning && worker.isActive) {
			try {
				await this.processAccountTasks(account)
				worker.tasksProcessed++
				worker.lastActivity = Date.now()
				const hasReachedLimit = await this.steamManager.hasReachedDailyLimit(
					account.id
				)
				if (hasReachedLimit) {
					this.log('info', `Account ${account.login} reached daily limit`)
					worker.isActive = false
					break
				}
				await this.delay(this.settings.taskDelay * 1000)
			} catch (error) {
				this.log('error', `Worker error for ${account.login}: ${error.message}`)
				await this.delay(this.settings.taskDelay * 2000)
			}
		}
		worker.isProcessing = false
		await this.steamManager.logoutAccount(account.id)
		this.workers.delete(account.id)
		this.log(
			'info',
			`Worker for account ${account.login} finished and account logged out`
		)
	}

	async processAccountTasks(account) {
		this.rep4repAPI.setApiToken(this.settings.apiKey)
		const steamProfiles = await this.rep4repAPI.getSteamProfiles()
		let accountProfile = steamProfiles.find(
			profile => profile.steamId === account.steamId
		)
		if (!accountProfile) {
			this.log(
				'info',
				`Profile for account ${account.login} not found in Rep4Rep, trying to add...`
			)
			try {
				this.rep4repAPI.setApiToken(this.settings.apiKey)
				await this.rep4repAPI.addSteamProfile(account.steamId)
				this.log(
					'success',
					`Profile for ${account.login} successfully added to Rep4Rep`
				)
				await this.delay(3000)
				this.rep4repAPI.setApiToken(this.settings.apiKey)
				const updatedProfiles = await this.rep4repAPI.getSteamProfiles()
				const newProfile = updatedProfiles.find(
					profile => profile.steamId === account.steamId
				)
				if (!newProfile) {
					this.log(
						'error',
						`Failed to find profile for ${account.login} even after adding`
					)
					return
				}
				accountProfile = newProfile
			} catch (err) {
				this.log(
					'error',
					`Error adding profile for ${account.login}: ${err.message}`
				)
				return
			}
		}

		if (!this.steamManager.isAccountLoggedIn(account.id)) {
			this.log('info', `Authorizing account ${account.login}`)
			await this.steamManager.loginAccount(account.id)
		}

		await this.steamManager.resetTaskCounterIfNeeded(account.id)

		// Get all available tasks
		const tasks = await this.rep4repAPI.getTasks(accountProfile.id)
		if (tasks.length === 0) {
			this.log('info', `No available tasks for account ${account.login}`)
			return
		}

		// Get how many have been done today
		let tasksToday = account.tasksToday || 0
		const maxTasks = 10

		for (const task of tasks) {
			if (!this.isRunning) break
			if (tasksToday >= maxTasks) {
				this.log('info', `Task limit reached for ${account.login}`)
				break
			}
			const result = await this.executeTask(account, accountProfile, task)
			if (result === 'limit' || account._stopTasks) {
				break // Exit loop
			}
			tasksToday++
			// Pause between tasks not touch (leaving as is)
		}
		// After loop: if limit reached, stop worker
		if (tasksToday >= maxTasks) {
			this.log(
				'info',
				`Account ${account.login} reached daily limit (by tasksToday), stopping worker`
			)
			const worker = this.workers.get(account.id)
			if (worker) worker.isActive = false
		}
	}

	async executeTask(account, accountProfile, task) {
		try {
			this.log(
				'info',
				`Executing task for ${account.login}: comment for ${task.targetSteamProfileName}`
			)

			// Send comment
			const commentId = await this.steamManager.postComment(
				account.id,
				task.targetSteamProfileId,
				task.requiredCommentText
			)

			// Log postComment result
			this.log('info', `Comment ID: ${commentId}`)

			// If comment was not left, do not send completeTask
			if (!commentId) {
				this.log(
					'error',
					'Comment was not posted, completeTask will not be sent'
				)
				return
			}

			// Delay between comment and marking as completed
			await this.delay(this.settings.commentDelay * 1000)

			// Mark task as completed
			await this.rep4repAPI.completeTask(
				task.taskId,
				task.requiredCommentId,
				accountProfile.id
			)

			// Update account information
			await this.steamManager.updateLastCommentTime(account.id)

			// Log task
			await this.database.addTaskLog({
				accountId: account.id,
				taskId: task.taskId,
				targetSteamId: task.targetSteamProfileId,
				commentId: commentId,
				status: 'completed',
			})

			this.completedTasks++
			this.emit('taskCompleted', {
				accountId: account.id,
				taskId: task.taskId,
				commentId: commentId,
			})

			this.log(
				'success',
				`Task completed for ${account.login} (comment ${commentId})`
			)
		} catch (error) {
			// Posting frequency limit
			if (
				typeof error.message === 'string' &&
				error.message.includes("You've been posting too frequently")
			) {
				const now = Date.now()
				try {
					const res = await this.database.updateAccount(account.id, {
						tasksToday: 10,
						lastComment: now,
					})
					this.log(
						'info',
						`DB updated: tasksToday=10, lastComment=${now} for ${
							account.login
						}, result: ${JSON.stringify(res)}`
					)
					account.lastComment = now
				} catch (err) {
					this.log(
						'error',
						`DB update failed for ${account.login}: ${err.message}`
					)
				}
				account.tasksToday = 10
				this.log(
					'warning',
					`Account ${account.login} reached posting frequency limit, skipping for 24h`
				)
				this.emit('accountsUpdated')
				if (typeof this.loadAccounts === 'function') {
					await this.loadAccounts()
				}
				// Stop worker
				const worker = this.workers.get(account.id)
				if (worker) worker.isActive = false
				account._stopTasks = true
				return 'limit'
			}
			// Error "do not allow you to add comments"
			if (
				typeof error.message === 'string' &&
				error.message.includes('do not allow you to add comments')
			) {
				this.log(
					'warning',
					`Account ${account.login} cannot comment on this profile, skipping task`
				)
				// Just skip to next task
				return
			}
			this.log(
				'error',
				`Task execution error for ${account.login}: ${error.message}`
			)
			this.emit('taskFailed', {
				accountId: account.id,
				taskId: task.taskId,
				error: error.message,
			})
			// If critical error, stop worker
			if (typeof this.loadAccounts === 'function') {
				await this.loadAccounts()
			}
		}
	}

	async canAccountWork(account) {
		try {
			// Reset tasksToday if 24 hours have passed since last comment
			await this.steamManager.resetTaskCounterIfNeeded(account.id)
			// Check task limit
			const hasReachedLimit = await this.steamManager.hasReachedDailyLimit(
				account.id
			)
			if (hasReachedLimit) {
				// If limit reached, check if 24 hours have passed since last comment
				const canPerform = await this.steamManager.canPerformTasks(account.id)
				if (!canPerform) {
					this.log(
						'warning',
						`Account ${account.login} skipped: limit, waiting 24h since last comment`
					)
					return false
				} else {
					// Reset already happened, tasksToday = 0, can work
					return true
				}
			}
			return true
		} catch (error) {
			this.log(
				'error',
				`Account check error ${account.login}: ${error.message}`
			)
			return false
		}
	}

	getStatus() {
		return {
			isRunning: this.isRunning,
			activeWorkers: this.workers.size,
			completedTasks: this.completedTasks,
			failedTasks: this.failedTasks,
			workers: Array.from(this.workers.values()).map(worker => ({
				accountId: worker.accountId,
				login: worker.login,
				tasksProcessed: worker.tasksProcessed,
				lastActivity: worker.lastActivity,
			})),
		}
	}

	async delay(ms) {
		return new Promise(resolve => setTimeout(resolve, ms))
	}

	log(type, message) {
		this.emit('log', type, message)
	}

	// Get work statistics
	getStatistics() {
		return {
			totalCompleted: this.completedTasks,
			totalFailed: this.failedTasks,
			successRate:
				this.completedTasks + this.failedTasks > 0
					? (
							(this.completedTasks / (this.completedTasks + this.failedTasks)) *
							100
					  ).toFixed(1)
					: 0,
			activeWorkers: this.workers.size,
			isRunning: this.isRunning,
		}
	}

	// Force stop worker account
	async stopAccountWorker(accountId) {
		const worker = this.workers.get(accountId)
		if (worker) {
			worker.isActive = false
			if (worker.timeout) {
				clearTimeout(worker.timeout)
			}
			this.workers.delete(accountId)
			this.log('info', `Account worker ${worker.login} forcibly stopped`)
		}
	}

	// Restart worker account
	async restartAccountWorker(accountId) {
		await this.stopAccountWorker(accountId)

		const account = await this.database.getAccountById(accountId)
		if (account && this.isRunning) {
			const canWork = await this.canAccountWork(account)
			if (canWork) {
				this.startAccountWorker(account)
			}
		}
	}

	startStatusUpdater() {
		if (this.statusUpdater) return
		this.statusUpdater = setInterval(async () => {
			const accounts = await this.database.getAccounts()
			for (const account of accounts) {
				await this.steamManager.resetTaskCounterIfNeeded(account.id)
			}
		}, 10 * 1000) // every 10 seconds
	}

	stopStatusUpdater() {
		if (this.statusUpdater) {
			clearInterval(this.statusUpdater)
			this.statusUpdater = null
		}
	}
}

module.exports = BotWorker
