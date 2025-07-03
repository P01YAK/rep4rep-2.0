const axios = require('axios')
const qs = require('querystring')

class Rep4RepAPI {
	constructor() {
		this.baseURL = 'https://rep4rep.com/pub-api'
		this.apiToken = null
	}

	setApiToken(token) {
		this.apiToken = token
	}

	// Базовый метод для выполнения запросов
	async makeRequest(method, endpoint, data = {}) {
		if (!this.apiToken) {
			throw new Error('API токен не установлен')
		}

		const config = {
			method,
			url: `${this.baseURL}${endpoint}`,
			timeout: 30000,
			headers: {
				'User-Agent': 'Rep4Rep-Bot/1.0.0',
			},
		}

		const params = { ...data, apiToken: this.apiToken }

		if (method.toLowerCase() === 'get') {
			config.params = params
		} else {
			config.headers['Content-Type'] = 'application/x-www-form-urlencoded'
			config.data = qs.stringify(params)
		}

		try {
			const response = await axios(config)
			return response.data
		} catch (error) {
			if (error.response) {
				// Сервер ответил с кодом ошибки
				const errorMessage =
					error.response.data?.error || error.response.statusText
				throw new Error(`API ошибка: ${errorMessage}`)
			} else if (error.request) {
				// Запрос был отправлен, но ответа не получено
				throw new Error('Нет ответа от сервера Rep4Rep')
			} else {
				// Ошибка при настройке запроса
				throw new Error(`Ошибка запроса: ${error.message}`)
			}
		}
	}

	// Получение информации о пользователе
	async getUserInfo() {
		try {
			const data = await this.makeRequest('GET', '/user')
			return {
				uid: data.uid,
				username: data.username,
				email: data.email,
				points: data.points || 0,
				pendingPoints: data.pendingPoints || 0,
				inGroup: data.inGroup || false,
			}
		} catch (error) {
			throw new Error(
				`Ошибка получения информации о пользователе: ${error.message}`
			)
		}
	}

	// Получение списка Steam профилей
	async getSteamProfiles() {
		try {
			const data = await this.makeRequest('GET', '/user/steamprofiles')
			return data.map(profile => ({
				id: profile.id,
				steamId: profile.steamId,
				personaName: profile.personaName,
				profileUrl: profile.profileUrl,
				avatar: profile.avatar,
				communityVisibilityState: profile.communityVisibilityState,
				profileState: profile.profileState,
				commentPermission: profile.commentPermission,
				canReceiveComment: profile.canReceiveComment,
			}))
		} catch (error) {
			throw new Error(`Ошибка получения Steam профилей: ${error.message}`)
		}
	}

	// Добавление Steam профиля
	async addSteamProfile(steamProfile) {
		try {
			const data = await this.makeRequest('POST', '/user/steamprofiles/add', {
				steamProfile,
			})
			return data
		} catch (error) {
			throw new Error(`Ошибка добавления Steam профиля: ${error.message}`)
		}
	}

	// Получение доступных заданий для Steam профиля
	async getTasks(steamProfileId) {
		try {
			const data = await this.makeRequest('GET', '/tasks', {
				steamProfile: steamProfileId,
			})
			return data.map(task => ({
				taskId: task.taskId,
				targetSteamProfileId: task.targetSteamProfileId,
				targetSteamProfileName: task.targetSteamProfileName,
				requiredCommentId: task.requiredCommentId,
				requiredCommentText: task.requiredCommentText,
			}))
		} catch (error) {
			throw new Error(`Ошибка получения заданий: ${error.message}`)
		}
	}

	// Отметка задания как выполненного
	async completeTask(taskId, commentId, authorSteamProfileId) {
		try {
			// Логируем параметры для диагностики
			console.log('[Rep4RepAPI] completeTask params:', {
				taskId,
				commentId,
				authorSteamProfileId,
			})
			const data = await this.makeRequest('POST', '/tasks/complete', {
				taskId,
				commentId,
				authorSteamProfileId,
			})
			// Логируем ответ
			console.log('[Rep4RepAPI] completeTask response:', data)
			return data
		} catch (error) {
			console.error('[Rep4RepAPI] completeTask error:', error)
			throw new Error(`Ошибка завершения задания: ${error.message}`)
		}
	}

	// Проверка валидности API токена
	async validateApiToken() {
		try {
			await this.getUserInfo()
			return true
		} catch (error) {
			return false
		}
	}

	// Получение статистики по заданиям
	async getTasksStatistics(steamProfileId) {
		try {
			const tasks = await this.getTasks(steamProfileId)
			return {
				availableTasks: tasks.length,
				tasks: tasks,
			}
		} catch (error) {
			throw new Error(`Ошибка получения статистики заданий: ${error.message}`)
		}
	}

	// Синхронизация Steam профилей с локальной базой
	async syncSteamProfiles(database) {
		try {
			const remoteProfiles = await this.getSteamProfiles()
			const localAccounts = await database.getAccounts()

			const syncResults = {
				synced: 0,
				errors: 0,
				details: [],
			}

			for (const account of localAccounts) {
				try {
					// Ищем соответствующий профиль на Rep4Rep
					const matchingProfile = remoteProfiles.find(
						profile => profile.steamId === account.steamId
					)

					if (matchingProfile) {
						// Обновляем информацию об аккаунте
						await database.updateAccount(account.id, {
							rep4repProfileId: matchingProfile.id,
							personaName: matchingProfile.personaName,
							profileUrl: matchingProfile.profileUrl,
							avatar: matchingProfile.avatar,
							canReceiveComment: matchingProfile.canReceiveComment,
						})

						syncResults.synced++
						syncResults.details.push({
							accountId: account.id,
							status: 'synced',
							profileId: matchingProfile.id,
						})
					} else {
						syncResults.details.push({
							accountId: account.id,
							status: 'not_found',
							message: 'Профиль не найден на Rep4Rep',
						})
					}
				} catch (error) {
					syncResults.errors++
					syncResults.details.push({
						accountId: account.id,
						status: 'error',
						message: error.message,
					})
				}
			}

			return syncResults
		} catch (error) {
			throw new Error(`Ошибка синхронизации профилей: ${error.message}`)
		}
	}

	// Автоматическое добавление Steam профиля в Rep4Rep
	async autoAddSteamProfile(steamId, profileUrl) {
		try {
			// Пробуем добавить по Steam ID
			let result
			try {
				result = await this.addSteamProfile(steamId)
			} catch (error) {
				// Если не получилось по Steam ID, пробуем по URL
				if (profileUrl) {
					result = await this.addSteamProfile(profileUrl)
				} else {
					throw error
				}
			}

			return result
		} catch (error) {
			throw new Error(
				`Ошибка автоматического добавления профиля: ${error.message}`
			)
		}
	}

	// Получение подробной информации о задании
	async getTaskDetails(taskId) {
		// Rep4Rep API не предоставляет отдельный endpoint для деталей задания
		// Возвращаем базовую информацию
		return {
			taskId,
			status: 'pending',
		}
	}

	// Проверка лимитов API
	async checkApiLimits() {
		try {
			const userInfo = await this.getUserInfo()
			return {
				hasAccess: true,
				points: userInfo.points,
				pendingPoints: userInfo.pendingPoints,
				inGroup: userInfo.inGroup,
			}
		} catch (error) {
			return {
				hasAccess: false,
				error: error.message,
			}
		}
	}

	// Получение истории заданий (эмуляция, так как API не предоставляет)
	async getTaskHistory() {
		// Rep4Rep API не предоставляет историю заданий
		// Возвращаем пустой массив
		return []
	}

	// Форматирование ошибок API
	formatApiError(error) {
		if (error.response && error.response.data) {
			const data = error.response.data
			if (data.error) {
				return data.error
			}
		}
		return error.message || 'Неизвестная ошибка API'
	}
}

module.exports = Rep4RepAPI
