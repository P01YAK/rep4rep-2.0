class Rep4RepBot {
	constructor() {
		this.currentPage = 'home'
		this.isWorking = false
		this.accounts = []
		this.settings = {
			apiKey: '',
			taskDelay: 30,
			commentDelay: 15,
			workMode: 'sequential',
			maxConcurrentAccounts: 2,
		}
		this.accountIdToDelete = null
		this.accountsFirstRender = true
		if (
			window.electronAPI &&
			typeof window.electronAPI.onAccountsUpdated === 'function'
		) {
			window.electronAPI.onAccountsUpdated(() => {
				this.loadAccounts()
			})
		}
		this.init()
	}

	init() {
		this.setupEventListeners()
		this.loadSettings()
		this.loadAccounts()
		this.updateStats()
		this.addLog('info', 'App started')
		this.startPeriodicUpdates()
		this.startPeriodicAccountUpdates()
	}

	setupEventListeners() {
		// Window management
		document.getElementById('minimizeBtn').addEventListener('click', () => {
			window.electronAPI.minimizeWindow()
		})

		document.getElementById('closeBtn').addEventListener('click', () => {
			window.electronAPI.closeWindow()
		})

		// Navigation
		document.querySelectorAll('.nav-item').forEach(item => {
			item.addEventListener('click', e => {
				const page = e.currentTarget.dataset.page
				this.switchPage(page)
			})
		})

		// Bot management
		document.getElementById('startBtn').addEventListener('click', () => {
			this.startBot()
		})

		document.getElementById('stopBtn').addEventListener('click', () => {
			this.stopBot()
		})

		// Clear logs
		document.getElementById('clearLogsBtn').addEventListener('click', () => {
			this.clearLogs()
		})

		// Account management
		document.getElementById('addAccountBtn').addEventListener('click', () => {
			this.showAddAccountModal()
		})

		document
			.getElementById('closeAddAccountModal')
			.addEventListener('click', () => {
				this.hideAddAccountModal()
			})

		document
			.getElementById('cancelAddAccount')
			.addEventListener('click', () => {
				this.hideAddAccountModal()
			})

		document.getElementById('addAccountForm').addEventListener('submit', e => {
			e.preventDefault()
			this.addAccount()
		})

		// Settings
		document.getElementById('saveSettingsBtn').addEventListener('click', () => {
			this.saveSettings()
		})

		// API key validation
		document.getElementById('apiKey').addEventListener('blur', () => {
			this.validateApiKey()
		})

		// Close modal by clicking outside of it
		document.getElementById('addAccountModal').addEventListener('click', e => {
			if (e.target === e.currentTarget) {
				this.hideAddAccountModal()
			}
		})

		// Steam Guard modal
		document.getElementById('closeSteamGuardModal').onclick = () =>
			this.hideSteamGuardModal()
		document.getElementById('cancelSteamGuard').onclick = () =>
			this.hideSteamGuardModal()
		document.getElementById('steamGuardOverlay').onclick = e => {
			if (e.target === e.currentTarget) this.hideSteamGuardModal()
		}
		document.getElementById('steamGuardForm').onsubmit = e => {
			e.preventDefault()
			const code = document.getElementById('steamGuardCode').value.trim()
			if (this._steamGuardCallback) {
				this._steamGuardCallback(code)
				this._steamGuardCallback = null
				this.hideSteamGuardModal()
			}
		}

		// Steam Guard inline
		document.getElementById('cancelSteamGuardInline').onclick = () =>
			this.hideSteamGuardInline()
		document.getElementById('steamGuardInlineForm').onsubmit = e => {
			e.preventDefault()
			const code = document.getElementById('steamGuardInlineCode').value.trim()
			if (this._steamGuardCallback) {
				this._steamGuardCallback(code)
				this.hideSteamGuardInline()
			}
		}

		// Кастомное окно удаления аккаунта
		document
			.getElementById('closeDeleteAccountModal')
			.addEventListener('click', () => {
				this.hideDeleteAccountModal()
			})
		document
			.getElementById('cancelDeleteAccount')
			.addEventListener('click', () => {
				this.hideDeleteAccountModal()
			})
		document
			.getElementById('confirmDeleteAccount')
			.addEventListener('click', () => {
				if (this.accountIdToDelete) {
					this.deleteAccountConfirmed(this.accountIdToDelete)
				}
				this.hideDeleteAccountModal()
			})
	}

	switchPage(page) {
		// Remove active class from all pages and navigation items
		document
			.querySelectorAll('.page')
			.forEach(p => p.classList.remove('active'))
		document
			.querySelectorAll('.nav-item')
			.forEach(n => n.classList.remove('active'))

		// Add active class to the selected page and navigation item
		document.getElementById(`${page}-page`).classList.add('active')
		document.querySelector(`[data-page="${page}"]`).classList.add('active')

		this.currentPage = page

		// Update data for the current page
		if (page === 'accounts') {
			this.accountsFirstRender = true
			this.renderAccounts()
		} else if (page === 'settings') {
			this.loadSettingsForm()
		}
	}

	async startBot() {
		if (this.isWorking) return
		if (!this.settings.apiKey) {
			this.showNotification(
				'error',
				'You need to specify the API key in the settings'
			)
			this.switchPage('settings')
			return
		}
		if (this.accounts.length === 0) {
			this.showNotification('error', 'You need to add at least one account')
			this.switchPage('accounts')
			return
		}
		const isValidToken = await window.electronAPI.validateApiToken(
			this.settings.apiKey
		)
		if (!isValidToken) {
			this.showNotification('error', 'Invalid API key')
			this.switchPage('settings')
			return
		}
		this.isWorking = true
		await window.electronAPI.setWorkingStatus(true)
		document.getElementById('startBtn').disabled = true
		document.getElementById('stopBtn').disabled = false
		document.getElementById('startBtn').classList.add('working')
		this.addLog('info', 'Starting bot...')
		this.showNotification('success', 'Bot started')
		try {
			await window.electronAPI.startBot()
		} catch (error) {
			this.addLog('error', `Error starting: ${error.message}`)
			this.stopBot()
		}
	}

	async stopBot() {
		if (!this.isWorking) return

		this.isWorking = false
		await window.electronAPI.setWorkingStatus(false)

		document.getElementById('startBtn').disabled = false
		document.getElementById('stopBtn').disabled = true
		document.getElementById('startBtn').classList.remove('working')

		this.addLog('info', 'Stopping bot...')
		this.showNotification('info', 'Bot stopped')

		try {
			await window.electronAPI.stopBot()
		} catch (error) {
			this.addLog('error', `Error stopping: ${error.message}`)
		}
	}

	addLog(type, message) {
		const logsContent = document.getElementById('logsContent')
		const logEntry = document.createElement('div')
		logEntry.className = `log-entry ${type}`

		const now = new Date()
		const time = now.toLocaleTimeString('ru-RU', { hour12: false })

		logEntry.innerHTML = `
            <span class="log-time">[${time}]</span>
            <span class="log-message">${message}</span>
        `

		logsContent.appendChild(logEntry)
		logsContent.scrollTop = logsContent.scrollHeight

		// Limit the number of logs
		const logs = logsContent.querySelectorAll('.log-entry')
		if (logs.length > 100) {
			logs[0].remove()
		}
	}

	clearLogs() {
		const logsContent = document.getElementById('logsContent')
		logsContent.innerHTML = ''
		this.addLog('info', 'Logs cleared')
	}

	showAddAccountModal() {
		const modal = document.getElementById('addAccountModal')
		modal.classList.add('active')
		document.getElementById('steamGuardOverlay').style.display = 'none'
		// Сбросить disabled через requestAnimationFrame
		requestAnimationFrame(() => {
			const loginInput = document.getElementById('accountLogin')
			const passInput = document.getElementById('accountPassword')
			const submitBtn = document.querySelector('#addAccountForm .submit-btn')
			loginInput.disabled = false
			loginInput.removeAttribute('disabled')
			passInput.disabled = false
			passInput.removeAttribute('disabled')
			submitBtn.disabled = false
			submitBtn.removeAttribute('disabled')
			loginInput.blur()
			passInput.blur()
			submitBtn.blur()
			setTimeout(() => {
				loginInput.focus()
			}, 10)
		})
	}

	hideAddAccountModal() {
		document.getElementById('addAccountModal').classList.remove('active')
		document.getElementById('addAccountForm').reset()
		// Always unlock fields and button
		document.getElementById('accountLogin').disabled = false
		document.getElementById('accountPassword').disabled = false
		document.querySelector('#addAccountForm .submit-btn').disabled = false
	}

	async addAccount() {
		const login = document.getElementById('accountLogin').value.trim()
		const password = document.getElementById('accountPassword').value

		if (!login || !password) {
			this.showNotification('error', 'Login and password are required')
			return
		}

		// Check if an account with the same login already exists
		if (this.accounts.find(acc => acc.login === login)) {
			this.showNotification('error', 'Account with this login already exists')
			return
		}

		const account = {
			id: Date.now().toString(),
			login,
			password,
			token: null,
			lastComment: null,
			tasksToday: 0,
			status: 'offline',
		}

		try {
			await window.electronAPI.addAccount(account)
			this.accounts.push(account)
			this.hideAddAccountModal()
			this.renderAccounts()
			this.updateStats()
			this.addLog('success', `Account ${login} added`)
			this.showNotification('success', 'Account added successfully')
		} catch (error) {
			this.addLog('error', `Error adding account: ${error.message}`)
			this.showNotification('error', 'Error adding account')
		}
	}

	async loadAccounts() {
		try {
			this.accounts = (await window.electronAPI.getAccounts()) || []
			this.renderAccounts()
			this.updateStats()
		} catch (error) {
			this.addLog('error', `Error loading accounts: ${error.message}`)
		}
	}

	async renderAccounts() {
		const accountsList = document.getElementById('accountsList')
		if (this.accountsFirstRender) {
			accountsList.classList.remove('no-animate')
		} else {
			accountsList.classList.add('no-animate')
		}
		accountsList.innerHTML = this.accounts
			.map(
				account => `
            <div class="account-card${
							this.accountsFirstRender ? ' hover-lift' : ''
						}" data-account-id="${account.id}">
                <div class="account-header">
                    <div class="account-login">
                        ${
													account.profileUrl &&
													account.profileUrl.startsWith('http')
														? `<a href="${account.profileUrl}" target="_blank" style="color: #aaf; text-decoration: underline;">${account.login}</a>`
														: account.steamId
														? `<a href="https://steamcommunity.com/profiles/${account.steamId}" target="_blank" style="color: #aaf; text-decoration: underline;">${account.login}</a>`
														: `<span style="color: #888; cursor: not-allowed;" title="Profile link is not available">${account.login}</span>`
												}
                    </div>
                    <div class="account-status" style="display: flex; align-items: center;">
                        <span class="status-indicator" style="width: 12px; height: 12px; border-radius: 50%; margin-right: 8px; box-shadow: 0 0 8px 2px ${
													account.tasksToday >= 10 ? '#ff2222' : '#00ff88'
												}; background: ${
					account.tasksToday >= 10 ? '#ff2222' : '#00ff88'
				};"></span>
                    </div>
                </div>
                <div class="account-info">
                    <div class="account-info-item">
                        <span class="account-info-label">Tasks today:</span>
                        <span class="account-info-value">${
													account.tasksToday
												}/10</span>
                    </div>
                    <div class="account-info-item">
                        <span class="account-info-label">Last comment:</span>
                        <span class="account-info-value">${
													account.lastComment
														? new Date(account.lastComment).toLocaleString(
																'en-EN'
														  )
														: 'Never'
												}</span>
                    </div>
                    <div class="account-info-item">
                        <span class="account-info-label">Token:</span>
                        <span class="account-info-value">${
													account.token ? 'Yes' : 'No'
												}</span>
                    </div>
                    ${
											account.timeUntilReset > 0
												? `
                    <div class="account-info-item">
                        <span class="account-info-label">Until reset:</span>
                        <span class="account-info-value">${this.formatTimeUntilReset(
													account.timeUntilReset
												)}</span>
                    </div>
                    `
												: ''
										}
                </div>
                <div class="account-actions">
                    <button class="account-btn login-btn" onclick="bot.loginAccount('${
											account.id
										}')" ${
					account.status === 'ready' || account.status === 'working'
						? 'disabled'
						: ''
				}>
                        ${
													account.status === 'ready' ||
													account.status === 'working'
														? 'Authorized'
														: 'Login'
												}
                    </button>
                    <button class="account-btn edit-btn" onclick="bot.editAccount('${
											account.id
										}')">Edit</button>
                    <button class="account-btn delete-btn" onclick="bot.showDeleteAccountModal('${
											account.id
										}')">Delete</button>
                </div>
            </div>
        `
			)
			.join('')
		this.accountsFirstRender = false
	}

	getStatusText(status) {
		const statusTexts = {
			ready: 'Ready',
			completed: 'Completed',
			working: 'Working',
			waiting: 'Waiting',
			offline: 'Offline',
			error: 'Error',
		}
		return statusTexts[status] || 'Unknown'
	}

	formatTimeUntilReset(milliseconds) {
		const hours = Math.floor(milliseconds / (1000 * 60 * 60))
		const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60))
		return `${hours}h ${minutes}m`
	}

	async loginAccount(accountId) {
		const loginBtn = document.querySelector(
			`.account-card[data-account-id="${accountId}"] .login-btn`
		)
		if (loginBtn) loginBtn.disabled = true
		try {
			this.addLog('info', 'Account authorization...')
			let guardCode = this._steamGuardCodes?.[accountId] || undefined
			await window.electronAPI.steamLogin({
				accountId,
				twoFactorCode: guardCode,
			})
			await this.loadAccounts() // Ensure status and token are updated
			this.renderAccounts()
			// Check for token presence after login
			const account = this.accounts.find(acc => acc.id === accountId)
			if (!account?.token) {
				this.showNotification(
					'warning',
					'Attention: unable to get token for automatic authorization. Check that Steam Guard is enabled and you are entering the code when logging in.'
				)
			} else {
				this.showNotification('success', 'Account authorized')
			}
		} catch (error) {
			this.addLog('error', `Error authorizing: ${error.message}`)
			this.showNotification('error', 'Error authorizing')
		} finally {
			if (loginBtn) loginBtn.disabled = false
		}
	}

	showDeleteAccountModal(accountId) {
		this.accountIdToDelete = accountId
		document.getElementById('deleteAccountModal').classList.add('active')
	}

	hideDeleteAccountModal() {
		this.accountIdToDelete = null
		document.getElementById('deleteAccountModal').classList.remove('active')
	}

	async deleteAccountConfirmed(accountId) {
		try {
			await window.electronAPI.deleteAccount(accountId)
			this.accounts = this.accounts.filter(acc => acc.id !== accountId)
			this.renderAccounts()
			this.updateStats()
			this.addLog('info', 'Account deleted')
			this.showNotification('success', 'Account deleted')
			// Если окно добавления аккаунта открыто, разблокировать поля и кнопку полностью
			if (
				document.getElementById('addAccountModal').classList.contains('active')
			) {
				const loginInput = document.getElementById('accountLogin')
				const passInput = document.getElementById('accountPassword')
				const submitBtn = document.querySelector('#addAccountForm .submit-btn')
				loginInput.disabled = false
				loginInput.removeAttribute('disabled')
				passInput.disabled = false
				passInput.removeAttribute('disabled')
				submitBtn.disabled = false
				submitBtn.removeAttribute('disabled')
			}
		} catch (error) {
			this.addLog('error', `Error deleting account: ${error.message}`)
			this.showNotification('error', 'Error deleting account')
		}
	}

	editAccount(accountId) {
		// TODO: Implement account editing
		this.showNotification(
			'info',
			'The function of editing will be added in the next version'
		)
	}

	async loadSettings() {
		try {
			const settings = await window.electronAPI.getSettings()
			if (settings) {
				this.settings = { ...this.settings, ...settings }
			}
			if (settings.maxConcurrentAccounts) {
				this.settings.maxConcurrentAccounts = Math.max(
					1,
					Math.min(10, parseInt(settings.maxConcurrentAccounts) || 10)
				)
			}
		} catch (error) {
			this.addLog('error', `Error loading settings: ${error.message}`)
		}
	}

	loadSettingsForm() {
		document.getElementById('apiKey').value = this.settings.apiKey || ''
		document.getElementById('taskDelay').value = this.settings.taskDelay || 30
		document.getElementById('commentDelay').value =
			this.settings.commentDelay || 5

		const workModeRadios = document.querySelectorAll('input[name="workMode"]')
		workModeRadios.forEach(radio => {
			radio.checked = radio.value === this.settings.workMode
		})
		document.getElementById('maxConcurrentAccounts').value =
			this.settings.maxConcurrentAccounts || 10
	}

	async validateApiKey() {
		const apiKey = document.getElementById('apiKey').value.trim()
		if (!apiKey) return

		try {
			const isValid = await window.electronAPI.validateApiToken(apiKey)
			const apiKeyInput = document.getElementById('apiKey')

			if (isValid) {
				apiKeyInput.style.borderColor = '#10b981'
				this.showNotification('success', 'API key is valid')
			} else {
				apiKeyInput.style.borderColor = '#ef4444'
				this.showNotification('error', 'Invalid API key')
			}
		} catch (error) {
			this.addLog('error', `Error validating API key: ${error.message}`)
		}
	}

	async saveSettings() {
		const apiKey = document.getElementById('apiKey').value.trim()
		const taskDelay = parseInt(document.getElementById('taskDelay').value)
		const commentDelay = parseInt(document.getElementById('commentDelay').value)
		const workMode = document.querySelector(
			'input[name="workMode"]:checked'
		).value
		let maxConcurrentAccounts = document
			.getElementById('maxConcurrentAccounts')
			.value.replace(/\D/g, '')
		maxConcurrentAccounts = Math.max(
			1,
			Math.min(10, parseInt(maxConcurrentAccounts) || 10)
		)

		this.settings = {
			apiKey,
			taskDelay,
			commentDelay,
			workMode,
			maxConcurrentAccounts,
		}

		try {
			await window.electronAPI.saveSettings(this.settings)
			this.addLog('success', 'Settings saved')
			this.showNotification('success', 'Settings saved')
		} catch (error) {
			this.addLog('error', `Error saving settings: ${error.message}`)
			this.showNotification('error', 'Error saving settings')
		}
	}

	async updateStats() {
		try {
			// Считаем аккаунты с лимитом (tasksToday >= 10)
			const limitedAccounts = this.accounts.filter(
				acc => acc.tasksToday >= 10
			).length
			const totalAccounts = this.accounts.length
			// Обновляем блок Active Accounts
			const activeAccountsBlock = document.getElementById('activeAccounts')
			if (activeAccountsBlock) {
				activeAccountsBlock.innerHTML = `<span class="gradient-text">${limitedAccounts}</span><span class="gradient-text">/</span><span class="gradient-text">${totalAccounts}</span>`
			}
			
			if (this.settings.apiKey) {
				const userInfo = await window.electronAPI.getUserInfo(
					this.settings.apiKey
				)
				if (userInfo) {
					document.getElementById(
						'totalPoints'
					).innerHTML = `<span class="gradient-text">${
						userInfo.points || 0
					}</span>`
					document.getElementById(
						'pendingTasks'
					).innerHTML = `<span class="gradient-text">${
						userInfo.pendingPoints || 0
					}</span>`
					this.animateCounter('totalPoints', userInfo.points || 0)
					this.animateCounter('pendingTasks', userInfo.pendingPoints || 0)
				}
			}
		} catch (error) {
			if (this.settings.apiKey) {
				this.addLog('warning', 'Unable to update statistics')
			}
		}
	}

	animateCounter(elementId, targetValue) {
		const element = document.getElementById(elementId)
		const currentValue = parseInt(element.textContent) || 0
		const increment = Math.ceil((targetValue - currentValue) / 10)

		if (currentValue !== targetValue) {
			element.textContent = Math.min(currentValue + increment, targetValue)
			element.classList.add('counter-animation')

			setTimeout(() => {
				element.classList.remove('counter-animation')
				if (parseInt(element.textContent) !== targetValue) {
					this.animateCounter(elementId, targetValue)
				}
			}, 50)
		}
	}

	startPeriodicUpdates() {
		// Update statistics every 30 seconds
		setInterval(() => {
			this.updateStats()
			if (this.currentPage === 'accounts') {
				this.renderAccounts()
			}
		}, 30000)
	}

	startPeriodicAccountUpdates() {
		setInterval(() => {
			if (this.currentPage === 'accounts') {
				this.loadAccounts()
			}
		}, 2000) // обновление каждые 2 секунды
	}

	showNotification(type, message) {
		const notification = document.createElement('div')
		notification.className = `notification ${type}`
		notification.innerHTML = `
            <div class="notification-content">
                <div class="notification-icon">
                    ${this.getNotificationIcon(type)}
                </div>
                <span class="notification-message">${message}</span>
            </div>
        `

		document.body.appendChild(notification)

		setTimeout(() => {
			notification.style.opacity = '0'
			notification.style.transform = 'translateX(100%)'
			setTimeout(() => {
				if (document.body.contains(notification)) {
					document.body.removeChild(notification)
				}
			}, 300)
		}, 3000)
	}

	getNotificationIcon(type) {
		const icons = {
			success:
				'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20,6 9,17 4,12"/></svg>',
			error:
				'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
			warning:
				'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
			info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
		}
		return icons[type] || icons.info
	}

	showSteamGuardModal(callback) {
		this._steamGuardCallback = callback
		const modal = document.getElementById('steamGuardModal')
		const overlay = document.getElementById('steamGuardOverlay')
		console.log('Showing Steam Guard modal', modal, overlay)
		document.getElementById('steamGuardCode').value = ''
		overlay.style.display = 'block'
		modal.style.display = 'block'
		modal.style.zIndex = 1001
		overlay.style.zIndex = 1000
		// fallback: if it doesn't appear, set it through 100ms
		setTimeout(() => {
			if (modal.style.display !== 'block') {
				modal.style.display = 'block'
				console.log('Forcibly set display:block for modal')
			}
		}, 100)
	}

	hideSteamGuardModal() {
		document.getElementById('steamGuardOverlay').style.display = 'none'
		document.getElementById('steamGuardModal').style.display = 'none'
	}

	saveGuardCode(accountId, code) {
		if (!this._steamGuardCodes) this._steamGuardCodes = {}
		this._steamGuardCodes[accountId] = code.trim()
	}

	showSteamGuardInline(callback) {
		this._steamGuardCallback = callback
		document.getElementById('steamGuardInlineCode').value = ''
		document.getElementById('steamGuardInline').style.display = 'block'
	}

	hideSteamGuardInline() {
		document.getElementById('steamGuardInline').style.display = 'none'
		this._steamGuardCallback = null
	}
}

// App initialization
const bot = new Rep4RepBot()
window.bot = bot // Make bot global for access from other scripts

// Handle messages from the main process
if (window.electronAPI && window.electronAPI.onLogMessage) {
	window.electronAPI.onLogMessage((event, type, message) => {
		bot.addLog(type, message)
	})
}

window.electronAPI.onSteamGuardRequired((event, { accountId, domain }) => {
	bot.showSteamGuardInline(code => {
		window.electronAPI.sendSteamGuardCode({ accountId, code })
	})
})
