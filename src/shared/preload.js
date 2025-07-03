const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
	minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
	closeWindow: () => ipcRenderer.invoke('close-window'),
	setWorkingStatus: status => ipcRenderer.invoke('set-working-status', status),
	getWorkingStatus: () => ipcRenderer.invoke('get-working-status'),

	// Account management
	addAccount: account => ipcRenderer.invoke('add-account', account),
	getAccounts: () => ipcRenderer.invoke('get-accounts'),
	updateAccount: (id, account) =>
		ipcRenderer.invoke('update-account', id, account),
	deleteAccount: id => ipcRenderer.invoke('delete-account', id),

	// Settings
	getSettings: () => ipcRenderer.invoke('get-settings'),
	saveSettings: settings => ipcRenderer.invoke('save-settings', settings),

	// Steam authorization
	steamLogin: credentials => ipcRenderer.invoke('steam-login', credentials),
	steamLogout: accountId => ipcRenderer.invoke('steam-logout', accountId),

	// Rep4Rep API
	getUserInfo: apiToken => ipcRenderer.invoke('get-user-info', apiToken),
	getSteamProfiles: apiToken =>
		ipcRenderer.invoke('get-steam-profiles', apiToken),
	getTasks: (apiToken, steamProfile) =>
		ipcRenderer.invoke('get-tasks', apiToken, steamProfile),
	completeTask: (apiToken, taskData) =>
		ipcRenderer.invoke('complete-task', apiToken, taskData),
	validateApiToken: apiKey => ipcRenderer.invoke('validate-api-token', apiKey),

	// Logs
	onLogMessage: callback => ipcRenderer.on('log-message', callback),

	// Bot work
	startBot: () => ipcRenderer.invoke('start-bot'),
	stopBot: () => ipcRenderer.invoke('stop-bot'),
	getBotStatus: () => ipcRenderer.invoke('get-bot-status'),

	// Steam Guard
	onSteamGuardRequest: callback =>
		ipcRenderer.on('steam-guard-request', callback),
	sendSteamGuardCode: data => ipcRenderer.invoke('steam-guard-code', data),
	onSteamGuardRequired: callback =>
		ipcRenderer.on('steam-guard-required', (event, data) =>
			callback(event, data)
		),
})
