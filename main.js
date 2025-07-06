const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const Database = require('./src/main/database')
const SteamManager = require('./src/main/steam-manager')
const Rep4RepAPI = require('./src/main/rep4rep-api')
const BotWorker = require('./src/main/bot-worker')
const isDev = process.env.NODE_ENV === 'development'

let mainWindow
let isWorking = false
let database
let steamManager
let rep4repAPI
let botWorker
const steamGuardCallbacks = new Map()

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1200,
		height: 800,
		resizable: false,
		frame: false,
		icon: path.join(__dirname, 'assets/icon.ico'),
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			preload: path.join(__dirname, 'src/shared/preload.js'),
		},
	})

	mainWindow.loadFile('src/renderer/index.html')

	// Open external links in browser
	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		shell.openExternal(url)
		return { action: 'deny' }
	})
	mainWindow.webContents.on('will-navigate', (event, url) => {
		if (url.startsWith('http')) {
			event.preventDefault()
			shell.openExternal(url)
		}
	})

	mainWindow.on('close', event => {
		if (isWorking) {
			event.preventDefault()
			dialog
				.showMessageBox(mainWindow, {
					type: 'warning',
					title: 'Warning',
					message:
						'The bot is currently active. Are you sure you want to close the application?',
					buttons: ['Cancel', 'Close'],
					defaultId: 0,
					cancelId: 0,
				})
				.then(result => {
					if (result.response === 1) {
						isWorking = false
						app.quit()
					}
				})
		}
	})

	if (isDev) {
		mainWindow.webContents.openDevTools()
	}
}

app.whenReady().then(() => {
	database = new Database()
	steamManager = new SteamManager(database)
	rep4repAPI = new Rep4RepAPI()
	botWorker = new BotWorker(database, steamManager, rep4repAPI)

	// Setting up events
	setupSteamManagerEvents()
	setupBotWorkerEvents()

	createWindow()
})

function setupSteamManagerEvents() {
	steamManager.on('accountLoggedIn', (accountId, login) => {
		sendLogMessage('success', `Account ${login} successfully authorized`)
	})

	steamManager.on('accountLoginError', (accountId, error) => {
		sendLogMessage('error', `Account authorization error: ${error}`)
	})

	steamManager.on('accountError', (accountId, error) => {
		sendLogMessage('error', `Account error: ${error}`)
	})

	steamManager.on('accountDisconnected', accountId => {
		sendLogMessage('warning', `Account disconnected`)
	})

	steamManager.on('steamGuardRequired', (accountId, domain, callback) => {
		steamGuardCallbacks.set(accountId, callback)
		mainWindow.webContents.send('steam-guard-required', { accountId, domain })
	})
}

function setupBotWorkerEvents() {
	botWorker.on('started', () => {
		sendLogMessage('success', 'Bot started and started working')
	})

	botWorker.on('stopped', () => {
		// sendLogMessage('info', 'Bot stopped')
	})

	botWorker.on('taskCompleted', data => {
		sendLogMessage('success', `Task completed for account ${data.accountId}`)
	})

	botWorker.on('taskFailed', data => {
		sendLogMessage('error', `Task execution error: ${data.error}`)
	})

	botWorker.on('log', (type, message) => {
		sendLogMessage(type, message)
	})

	botWorker.on('accountsUpdated', () => {
		if (mainWindow && !mainWindow.isDestroyed()) {
			mainWindow.webContents.send('accounts-updated')
		}
	})
}

function sendLogMessage(type, message) {
	if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
		mainWindow.webContents.send('log-message', type, message)
	}
}

app.on('window-all-closed', async () => {
	if (process.platform !== 'darwin') {
		if (botWorker && typeof botWorker.stop === 'function') {
			await botWorker.stop()
		}
		if (steamManager) {
			await steamManager.cleanup()
		}
		if (database) {
			database.close()
		}
		setTimeout(() => {
			app.quit()
		}, 500)
	}
})

app.on('activate', () => {
	if (BrowserWindow.getAllWindows().length === 0) {
		createWindow()
	}
})

// IPC handlers
ipcMain.handle('minimize-window', () => {
	mainWindow.minimize()
})

ipcMain.handle('close-window', () => {
	mainWindow.close()
})

ipcMain.handle('set-working-status', (event, status) => {
	isWorking = status
})

ipcMain.handle('get-working-status', () => {
	return isWorking
})

// Account management
ipcMain.handle('add-account', async (event, account) => {
	try {
		return await database.addAccount(account)
	} catch (error) {
		throw new Error(`Account addition error: ${error.message}`)
	}
})

ipcMain.handle('get-accounts', async () => {
	try {
		return await database.getAccounts()
	} catch (error) {
		throw new Error(`Accounts retrieval error: ${error.message}`)
	}
})

ipcMain.handle('update-account', async (event, id, updates) => {
	try {
		return await database.updateAccount(id, updates)
	} catch (error) {
		throw new Error(`Account update error: ${error.message}`)
	}
})

ipcMain.handle('delete-account', async (event, id) => {
	try {
		return await database.deleteAccount(id)
	} catch (error) {
		throw new Error(`Account deletion error: ${error.message}`)
	}
})

// Settings
ipcMain.handle('get-settings', async () => {
	try {
		return await database.getAllSettings()
	} catch (error) {
		throw new Error(`Settings retrieval error: ${error.message}`)
	}
})

ipcMain.handle('save-settings', async (event, settings) => {
	try {
		return await database.saveSettings(settings)
	} catch (error) {
		throw new Error(`Settings saving error: ${error.message}`)
	}
})

// Steam authorization
ipcMain.handle('steam-login', async (event, credentials) => {
	try {
		return await steamManager.loginAccount(credentials.accountId)
	} catch (error) {
		throw new Error(`Steam authorization error: ${error.message}`)
	}
})

ipcMain.handle('steam-logout', async (event, accountId) => {
	try {
		return await steamManager.logoutAccount(accountId)
	} catch (error) {
		throw new Error(`Steam logout error: ${error.message}`)
	}
})

ipcMain.handle('get-account-status', async (event, accountId) => {
	try {
		return await steamManager.getAccountStatus(accountId)
	} catch (error) {
		throw new Error(`Account status retrieval error: ${error.message}`)
	}
})

ipcMain.handle('can-perform-tasks', async (event, accountId) => {
	try {
		return await steamManager.canPerformTasks(accountId)
	} catch (error) {
		throw new Error(`Task execution check error: ${error.message}`)
	}
})

ipcMain.handle('get-time-until-reset', async (event, accountId) => {
	try {
		return await steamManager.getTimeUntilReset(accountId)
	} catch (error) {
		throw new Error(`Time until reset retrieval error: ${error.message}`)
	}
})

// Rep4Rep API
ipcMain.handle('get-user-info', async (event, apiToken) => {
	try {
		rep4repAPI.setApiToken(apiToken)
		return await rep4repAPI.getUserInfo()
	} catch (error) {
		throw new Error(`User info retrieval error: ${error.message}`)
	}
})

ipcMain.handle('get-steam-profiles', async (event, apiToken) => {
	try {
		rep4repAPI.setApiToken(apiToken)
		return await rep4repAPI.getSteamProfiles()
	} catch (error) {
		throw new Error(`Steam profiles retrieval error: ${error.message}`)
	}
})

ipcMain.handle('get-tasks', async (event, apiToken, steamProfile) => {
	try {
		rep4repAPI.setApiToken(apiToken)
		return await rep4repAPI.getTasks(steamProfile)
	} catch (error) {
		throw new Error(`Tasks retrieval error: ${error.message}`)
	}
})

ipcMain.handle('complete-task', async (event, apiToken, taskData) => {
	try {
		rep4repAPI.setApiToken(apiToken)
		return await rep4repAPI.completeTask(
			taskData.taskId,
			taskData.commentId,
			taskData.authorSteamProfileId
		)
	} catch (error) {
		throw new Error(`Task completion error: ${error.message}`)
	}
})

ipcMain.handle('sync-steam-profiles', async (event, apiToken) => {
	try {
		rep4repAPI.setApiToken(apiToken)
		return await rep4repAPI.syncSteamProfiles(database)
	} catch (error) {
		throw new Error(`Steam profiles synchronization error: ${error.message}`)
	}
})

ipcMain.handle('validate-api-token', async (event, apiKey) => {
	try {
		rep4repAPI.setApiToken(apiKey)
		return await rep4repAPI.validateApiToken()
	} catch (error) {
		return false
	}
})

// Bot management
ipcMain.handle('start-bot', async event => {
	// sendLogMessage('info', '[DEBUG] Received start-bot call')
	// console.log('[DEBUG] Received start-bot call')
	try {
		const settings = await database.getAllSettings()
		// sendLogMessage(
		// 'info',
		// '[DEBUG] Received settings: ' + JSON.stringify(settings)
		// )
		// console.log('[DEBUG] Received settings:', settings)
		return await botWorker.start(settings)
	} catch (error) {
		// sendLogMessage('error', '[DEBUG] Bot start error: ' + error.message)
		// console.error('[DEBUG] Bot start error:', error)
		throw new Error(`Bot start error: ${error.message}`)
	}
})

ipcMain.handle('stop-bot', async event => {
	try {
		return await botWorker.stop()
	} catch (error) {
		throw new Error(`Bot stop error: ${error.message}`)
	}
})

ipcMain.handle('get-bot-status', async event => {
	try {
		return botWorker.getStatus()
	} catch (error) {
		throw new Error(`Bot status retrieval error: ${error.message}`)
	}
})

ipcMain.handle('get-bot-statistics', async event => {
	try {
		return botWorker.getStatistics()
	} catch (error) {
		throw new Error(`Bot statistics retrieval error: ${error.message}`)
	}
})

ipcMain.handle('steam-guard-code', async (event, { accountId, code }) => {
	const callback = steamGuardCallbacks.get(accountId)
	if (callback) {
		callback(code)
		steamGuardCallbacks.delete(accountId)
		return { success: true }
	} else {
		return { success: false, error: 'Callback not found' }
	}
})

process.on('unhandledRejection', (reason, promise) => {
	if (reason && reason.message === 'Database is closed') {
		console.warn('Attempted DB access after close (safe to ignore):', reason)
	} else {
		console.error('Unhandled Rejection:', reason)
	}
})
