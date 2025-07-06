const SteamUser = require('steam-user')
const SteamCommunity = require('steamcommunity')
const EventEmitter = require('events')

class SteamManager extends EventEmitter {
	constructor(database) {
		super()
		this.database = database
		this.steamClients = new Map() // accountId -> { user, community, isLoggedIn }
		this.loginQueue = []
		this.isProcessingQueue = false
		this._authorizing = new Map()
	}

	// Авторизация в Steam
	async loginAccount(accountId) {
		if (!this._authorizing) this._authorizing = new Map()
		if (this._authorizing.get(accountId) || this.isAccountLoggedIn(accountId)) {
			return {
				success: true,
				message: 'Аккаунт уже авторизуется или авторизован',
			}
		}
		this._authorizing.set(accountId, true)
		try {
			const account = await this.database.getAccountById(accountId)
			if (!account) {
				throw new Error('Аккаунт не найден')
			}

			// Проверяем, не авторизован ли уже аккаунт
			if (
				this.steamClients.has(accountId) &&
				this.steamClients.get(accountId).isLoggedIn
			) {
				return { success: true, message: 'Аккаунт уже авторизован' }
			}

			const steamUser = new SteamUser({
				autoRelogin: true,
				renewRefreshTokens: true,
			})
			const steamCommunity = new SteamCommunity()

			this.setupSteamEventHandlers(
				steamUser,
				steamCommunity,
				accountId,
				account
			)

			let loginDetails
			let loginByToken = false
			if (account.token) {
				try {
					const tokenData = JSON.parse(account.token)
					loginDetails = { refreshToken: tokenData.refreshToken }
					loginByToken = true
				} catch (error) {
					console.log('Ошибка парсинга токена, используем логин/пароль')
					loginDetails = {
						accountName: account.login,
						password: account.password,
					}
				}
			} else {
				loginDetails = {
					accountName: account.login,
					password: account.password,
				}
			}
			if (account.twoFA) {
				loginDetails.twoFactorCode = account.twoFA
			}

			return await new Promise((resolve, reject) => {
				let isLoggedOn = false
				let isTokenRefreshed = false
				let steamId = null
				let refreshToken = null
				let finished = false

				function finishIfReady() {
					if (
						!finished &&
						((loginByToken && isLoggedOn) ||
							(!loginByToken && isLoggedOn && isTokenRefreshed))
					) {
						finished = true
						// Сохраняем токен и steamId в базу
						const updateData = {
							status: 'ready',
						}
						if (refreshToken) {
							updateData.token = JSON.stringify({
								refreshToken,
								createdAt: Date.now(),
							})
						}
						if (steamId) {
							updateData.steamId = steamId
						}
						this.database
							.updateAccount(accountId, updateData)
							.then(() => {
								this.steamClients.set(accountId, {
									user: steamUser,
									community: steamCommunity,
									isLoggedIn: true,
									steamId: steamId,
								})
								this.emit('accountLoggedIn', accountId, account.login)
								// Обновляем список аккаунтов в памяти (для интерфейса)
								if (typeof this.loadAccounts === 'function') {
									this.loadAccounts()
								}
								resolve({ success: true, steamId })
							})
							.catch(reject)
					}
				}

				steamUser.on('loggedOn', () => {
					isLoggedOn = true
					steamId = steamUser.steamID.getSteamID64()
					finishIfReady.call(this)
				})

				steamUser.on('refreshToken', token => {
					isTokenRefreshed = true
					refreshToken = token
					finishIfReady.call(this)
				})

				steamUser.once('webSession', (sessionID, cookies) => {
					steamCommunity.setCookies(cookies)
				})

				steamUser.on('error', err => {
					if (!finished) {
						finished = true
						// Если ошибка LogonSessionReplaced — удаляем токен из базы, чтобы пользователь мог заново авторизоваться
						if (
							err &&
							err.message &&
							err.message.includes('LogonSessionReplaced')
						) {
							this.database
								.updateAccount(accountId, { token: null, status: 'error' })
								.finally(() => {
									this.emit('accountLoginError', accountId, err.message)
									reject(
										new Error(
											'Ошибка авторизации Steam: LogonSessionReplaced. Токен сброшен, попробуйте войти заново через логин и пароль.'
										)
									)
								})
						} else {
							this.database
								.updateAccount(accountId, { status: 'error' })
								.finally(() => {
									this.emit('accountLoginError', accountId, err.message)
									reject(err)
								})
						}
					}
				})

				steamUser.logOn(loginDetails)
			})
		} finally {
			this._authorizing.set(accountId, false)
		}
	}

	setupSteamEventHandlers(steamUser, steamCommunity, accountId, account) {
		steamUser.on('steamGuard', (domain, callback) => {
			this.emit('steamGuardRequired', accountId, domain, callback)
		})

		steamUser.on('error', async err => {
			await this.database.updateAccount(accountId, { status: 'error' })
			this.emit('accountError', accountId, err.message)
		})

		steamUser.on('disconnected', async () => {
			if (this.steamClients.has(accountId)) {
				this.steamClients.get(accountId).isLoggedIn = false
			}
			await this.database.updateAccount(accountId, { status: 'offline' })
			this.emit('accountDisconnected', accountId)
		})
	}

	// Выход из аккаунта
	async logoutAccount(accountId) {
		if (this.steamClients.has(accountId)) {
			const client = this.steamClients.get(accountId)
			if (client.user) {
				client.user.logOff()
			}
			this.steamClients.delete(accountId)
		}
		// После логаута выставляем статус offline
		await this.database.updateAccount(accountId, { status: 'offline' })
		this.emit('accountLoggedOut', accountId)
	}

	// Получение клиента Steam для аккаунта
	getSteamClient(accountId) {
		return this.steamClients.get(accountId)
	}

	// Проверка авторизации аккаунта
	isAccountLoggedIn(accountId) {
		const client = this.steamClients.get(accountId)
		return client && client.isLoggedIn
	}

	// Отправка комментария
	async postComment(accountId, targetSteamId, commentText) {
		const client = this.getSteamClient(accountId)
		if (!client || !client.isLoggedIn) {
			throw new Error('Аккаунт не авторизован')
		}

		return new Promise((resolve, reject) => {
			client.community.postUserComment(
				targetSteamId,
				commentText,
				(err, cid) => {
					if (err) {
						reject(err)
					} else {
						resolve(cid)
					}
				}
			)
		})
	}

	// Проверка возможности выполнения заданий (24 часа с последнего комментария)
	async canPerformTasks(accountId) {
		const account = await this.database.getAccountById(accountId)
		if (!account) {
			return false
		}

		// Если никогда не комментировал, может выполнять задания
		if (!account.lastComment) {
			return true
		}

		// Проверяем, прошло ли 24 часа с последнего комментария
		const lastCommentTime = new Date(account.lastComment)
		const now = new Date()
		const hoursSinceLastComment = (now - lastCommentTime) / (1000 * 60 * 60)

		return hoursSinceLastComment >= 24
	}

	// Сброс счетчика заданий если прошло 24 часа
	async resetTaskCounterIfNeeded(accountId) {
		const account = await this.database.getAccountById(accountId)
		if (!account) return false
		if (!account.lastComment) {
			return false
		}
		const canPerform = await this.canPerformTasks(accountId)
		if (canPerform) {
			await this.database.updateAccount(accountId, { tasksToday: 0 })
			return true
		}
		return false
	}

	// Получение времени до следующего сброса счетчика
	async getTimeUntilReset(accountId) {
		const account = await this.database.getAccountById(accountId)
		if (!account || !account.lastComment) {
			return 0 // Может выполнять задания сразу
		}

		const lastCommentTime = new Date(account.lastComment)
		const resetTime = new Date(lastCommentTime.getTime() + 24 * 60 * 60 * 1000)
		const now = new Date()

		return Math.max(0, resetTime - now)
	}

	// Обновление времени последнего комментария
	async updateLastCommentTime(accountId) {
		const now = Date.now()
		await this.database.updateAccount(accountId, {
			lastComment: now,
			tasksToday: (await this.getTasksToday(accountId)) + 1,
		})
	}

	// Получение количества выполненных заданий сегодня
	async getTasksToday(accountId) {
		const account = await this.database.getAccountById(accountId)
		return account ? account.tasksToday : 0
	}

	// Проверка лимита заданий (20 в день)
	async hasReachedDailyLimit(accountId) {
		const tasksToday = await this.getTasksToday(accountId)
		return tasksToday >= 10
	}

	// Получение статуса аккаунта для отображения
	async getAccountStatus(accountId) {
		const account = await this.database.getAccountById(accountId)
		if (!account) {
			return 'error'
		}

		// Проверяем авторизацию
		if (!this.isAccountLoggedIn(accountId)) {
			return 'offline'
		}

		// Проверяем лимит заданий
		if (await this.hasReachedDailyLimit(accountId)) {
			return 'completed'
		}

		// Проверяем возможность выполнения заданий (24 часа)
		if (!(await this.canPerformTasks(accountId))) {
			return 'waiting'
		}

		return 'ready'
	}

	// Массовая авторизация аккаунтов
	async loginAllAccounts() {
		const accounts = await this.database.getAccounts()
		const results = []

		for (const account of accounts) {
			try {
				const result = await this.loginAccount(account.id)
				results.push({ accountId: account.id, success: true, result })
			} catch (error) {
				results.push({
					accountId: account.id,
					success: false,
					error: error.message,
				})
			}
		}

		return results
	}

	// Выход из всех аккаунтов
	async logoutAllAccounts() {
		const accountIds = Array.from(this.steamClients.keys())

		for (const accountId of accountIds) {
			await this.logoutAccount(accountId)
		}
	}

	// Получение информации о всех подключенных аккаунтах
	getConnectedAccounts() {
		const connected = []
		for (const [accountId, client] of this.steamClients.entries()) {
			if (client.isLoggedIn) {
				connected.push({
					accountId,
					steamId: client.steamId,
				})
			}
		}
		return connected
	}

	// Очистка ресурсов
	async cleanup() {
		await this.logoutAllAccounts()
		this.steamClients.clear()
		this.removeAllListeners()
	}
}

module.exports = SteamManager
