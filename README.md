# Rep4Rep Bot 🤖

## Project Description

Rep4Rep Bot is an automated application for working with the Rep4Rep platform. The bot automatically completes tasks by commenting on Steam profiles.

## [0.2.2] - 06.07.2025

---

### 🛠️ Fixed

- Fixed link to API key.

---

## [0.2.1] - 06.07.2025

---

### 🛠️ Fixed

- Fixed the task limit reset logic: if lastComment = NULL, tasksToday is now automatically set to 10 and lastComment is set to the current time.
- When the posting frequency limit is reached, both tasksToday=10 and lastComment are now updated simultaneously.

### 🚀 Improved

- Improved database update logging for easier debugging of task limits.
- The UI now always correctly displays the task limit and last comment date after changes in the database.

---

# Changelog 📝

## [0.1.0] - 03.07.2025

### ✨ Added

- Basic functionality for Rep4Rep bot
- Steam account management
- Steam authentication with 2FA support
- Saving authorization tokens
- Multithreading (up to 10 accounts in parallel)
- Synchronization of Rep4Rep profiles with the local database
- Modern user interface
- Settings system (API key, timings, operation mode)
- Logging system
- Animations and modern design

## [Planned]

### In Development

- [ ] Edit accounts
- [ ] Advanced statistics
- [ ] Task scheduler
- [ ] UI improvements
- [ ] Program bug fixes (Multithreading! Use sequential mode)

---

## Installation & Setup ⚙️

### Requirements

- Node.js 18+
- pnpm (recommended)
- Git

### Installing Dependencies

```bash
# Clone the repository
git clone <repository-url>
cd rep4rep-bot

# Install dependencies
pnpm install
```

### Run in Development Mode

```bash
pnpm run start
```

### Build the Application

```bash
pnpm run build
```

## Development & Extension 🚀

### Adding New Features

#### 1. Adding a New API Method

1. Open `src/main/rep4rep-api.js`
2. Add a new method to the `Rep4RepAPI` class
3. Update IPC handlers in `main.js`
4. Add the call in `src/renderer/js/app.js`

Example:

```javascript
// In rep4rep-api.js
async getNewFeature() {
    return await this.makeRequest('GET', '/new-endpoint');
}

// In main.js
ipcMain.handle('get-new-feature', async (event) => {
    return await rep4repAPI.getNewFeature();
});

// In app.js
const result = await window.electronAPI.getNewFeature();
```

#### 2. Adding a New UI Page

1. Add HTML markup in `src/renderer/index.html`
2. Add styles in `src/renderer/css/styles.css`
3. Add logic in `src/renderer/js/app.js`
4. Update navigation

#### 3. Adding New Settings

1. Update the database schema in `src/main/database.js`
2. Add fields to the settings form
3. Update save/load methods

### Database Structure 🗄️

#### Table: accounts

```sql
CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    login TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    twoFA TEXT,
    token TEXT,
    steamId TEXT,
    lastComment TEXT,
    tasksToday INTEGER DEFAULT 0,
    rep4repProfileId TEXT,
    personaName TEXT,
    profileUrl TEXT,
    avatar TEXT,
    canReceiveComment BOOLEAN DEFAULT 1,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);
```

#### Table: settings

```sql
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

#### Table: task_logs

```sql
CREATE TABLE task_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    accountId TEXT NOT NULL,
    taskId TEXT NOT NULL,
    targetSteamId TEXT NOT NULL,
    commentId TEXT,
    status TEXT NOT NULL,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### Implementation Features

#### 1. Task Counter Reset

The counter resets 24 hours after the last comment (not at midnight).

#### 2. Multithreading

The bot supports two operation modes:

- **Parallel**: up to 10 accounts simultaneously
- **Sequential**: accounts work one after another

#### 3. Security 🔒

- Use of `contextIsolation` and `preload.js`
- `nodeIntegration` disabled
- Validation of all user data

#### Logging

All logs are displayed in the interface and transmitted via events:

```javascript
// Sending a log
this.emit('log', 'info', 'Message')

// Receiving in main.js
botWorker.on('log', (type, message) => {
	sendLogMessage(type, message)
})
```

### Testing 🧪

#### Manual Testing

1. Run the application in development mode
2. Add a test account
3. Set up the API key
4. Check all interface functions

### Deployment 📦

#### Preparing for Release

1. Update the version in `package.json`
2. Create icons in the `src/assets/` folder
3. Update description and metadata
4. Build for all platforms

### Frequently Used Commands

```bash
# Development
pnpm run start                 # Start

# Build
pnpm run build                 # Build for current platform

# Dependency management
pnpm add <package>             # Add dependency
pnpm add -D <package>          # Add dev dependency
pnpm update                    # Update dependencies
```

### Troubleshooting

#### sqlite3 Issues

```bash
# Rebuild for Electron
pnpm rebuild sqlite3 --runtime=electron --target=<electron-version>
```

### License 📄

MIT License - see LICENSE file for details.

---

## Quick Start for Developers ⚡

1. **Clone the repository**
2. **Install dependencies**: `pnpm install`
3. **Run**: `pnpm run start`
4. **Open DevTools** for debugging
5. **Make changes** in the relevant files
6. **Test** the functionality
7. **Build** the application: `pnpm run build`

Happy coding! 🚀
