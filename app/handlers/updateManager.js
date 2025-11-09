const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const loadConfig = require('./config');
const settings = loadConfig('./config.toml');
const EventEmitter = require('events');
const chalk = require('chalk');

class UpdateManager extends EventEmitter {
    constructor() {
        super();
        this.repoOwner = 'OvernodeProjets';
        this.repoName = 'fixed-heliactyl-next';
        this.updateConfig = settings.update || {
            enabled: true,
            checkReleases: true,
            checkPreReleases: true,
            checkCommits: false,
            autoInstall: false,
            checkInterval: 1800000 // 30 minutes
        };
        this.cache = {
            updates: null,
            lastCheck: 0,
            cacheTimeout: 300000 // 5 minutes cache
        };
        this.db = null;
        this._initialized = false;
    }

    async initialize(db) {
        if (this._initialized) {
            console.warn('[UpdateManager] Already initialized');
            return;
        }

        if (!db) {
            throw new Error('[UpdateManager] Database instance is required');
        }

        try {
            // Load cache from database
            const dbCache = await db.get('system-updateCache');
            if (dbCache) {
                this.cache = dbCache;
            }

            // Set database instance and mark as initialized
            this.db = db;
            this._initialized = true;

            // Start automatic check if enabled
            if (this.updateConfig.enabled) {
                await this.performInitialCheck();
                this.schedulePeriodicChecks();
            }

            console.log(chalk.grey('[UpdateManager] ') + chalk.white('Initialized ') + chalk.green('successfully'));
        } catch (error) {
            this._initialized = false;
            this.db = null;
            console.error('[UpdateManager] Error during initialization:', error);
            throw error;
        }
    }

    async performInitialCheck() {
        if (!this._initialized || !this.db) {
            console.warn('[UpdateManager] Not initialized, cannot perform initial check.');
            return; // Exit early
        }

        console.log(chalk.grey('[UpdateManager] Performing initial update check...'));
        try {
            const updates = await this.checkForUpdates(false);
            if (updates.length > 0) {
                console.log(chalk.grey('[UpdateManager] New updates available:', updates.length));
            }
        } catch (error) {
            console.error('[UpdateManager] Error during initial check:', error);
        }
    }

    schedulePeriodicChecks() {
        if (!this._initialized || !this.db) {
            console.warn('[UpdateManager] Not initialized, cannot schedule periodic checks.');
            return; // Exit early
        }

        console.log(chalk.grey('[UpdateManager] Setting up periodic checks...'));
        
        setInterval(async () => {
            try {
                const updates = await this.checkForUpdates(false);
                if (updates.length > 0) {
                    console.log(chalk.grey('[UpdateManager] New updates available:', updates.length));
                }
            } catch (error) {
                console.error('[UpdateManager] Error during periodic check:', error);
            }
        }, this.updateConfig.checkInterval);

        console.log(chalk.grey(`[UpdateManager] Automatic checks scheduled every ${this.updateConfig.checkInterval / 60000} minutes`));
    }

    async checkForUpdates(ignoreCache = false) {
        if (!this._initialized || !this.db) {
            throw new Error('[UpdateManager] Not initialized. Call initialize() first');
        }

        console.log(chalk.grey('[UpdateManager] Checking for updates...'));
        const now = Date.now();

        // Load cache from database if not loaded
        if (!this.cache.lastCheck) {
            const dbCache = await this.db.get('system-updateCache');
            if (dbCache) {
                this.cache = dbCache;
            }
        }
        
        // Return filtered cached results if within cache timeout
        if (!ignoreCache && this.cache.updates && (now - this.cache.lastCheck) < this.cache.cacheTimeout) {
            console.log(chalk.grey('[UpdateManager] Returning cached updates.'));
            // Filter cached updates based on current configuration
            const filteredUpdates = this.cache.updates.filter(update => 
                (update.type === 'release' && this.updateConfig.checkReleases) ||
                (update.type === 'commit' && this.updateConfig.checkCommits)
            );
            return filteredUpdates;
        }

        try {
            let updates = [];

            if (this.updateConfig.checkReleases) {
                const releases = await this.checkReleases();
                updates = updates.concat(releases);
            }

            if (this.updateConfig.checkCommits) {
                const commits = await this.checkCommits();
                updates = updates.concat(commits);
            }

            // Filter and update cache based on current configuration
            const filteredUpdates = updates.filter(update => 
                (update.type === 'release' && this.updateConfig.checkReleases) ||
                (update.type === 'commit' && this.updateConfig.checkCommits)
            );
            
            this.cache.updates = filteredUpdates;
            this.cache.lastCheck = now;
            
            // Save cache to database
            await this.db.set('system-updateCache', this.cache);

            this.emit('update.checked', {
                updates,
                timestamp: now,
                hasUpdates: updates.length > 0
            });

            if (updates.length > 0) {
                this.emit('update.available', updates);
            }

            return updates;
        } catch (error) {
            console.error('Error checking for updates:', error);
            // If error, return cached results if available
            return this.cache.updates || [];
        }
    }

    async checkReleases() {
        const response = await axios.get(`https://api.github.com/repos/${this.repoOwner}/${this.repoName}/releases`);
        return response.data
            .filter(release => this.updateConfig.checkPreReleases || !release.prerelease)
            .map(release => ({
                type: 'release',
                version: release.tag_name,
                name: release.name,
                description: release.body,
                date: release.published_at,
                url: release.html_url
            }));
    }

    async checkCommits() {
        const response = await axios.get(`https://api.github.com/repos/${this.repoOwner}/${this.repoName}/commits`);
        return response.data.map(commit => ({
            type: 'commit',
            version: commit.sha.substring(0, 7),
            name: commit.commit.message.split('\n')[0],
            description: commit.commit.message,
            date: commit.commit.author.date,
            url: commit.html_url
        }));
    }

    async detectPackageManager() {
        const rootDir = path.join(__dirname, '../..');
        
        if (fs.existsSync(path.join(rootDir, 'pnpm-lock.yaml'))) {
            return 'pnpm';
        } else if (fs.existsSync(path.join(rootDir, 'yarn.lock'))) {
            return 'yarn';
        } else if (fs.existsSync(path.join(rootDir, 'bun.lockb'))) {
            return 'bun';
        } else if (fs.existsSync(path.join(rootDir, 'package-lock.json'))) {
            return 'npm';
        }
        
        return 'npm'; // default to npm if no lock file is found
    }

    async installUpdate(update) {
        if (!this.db) {
            throw new Error('UpdateManager not initialized. Call initialize() first');
        }

        if (!update || !update.url) {
            throw new Error('Invalid update information');
        }

        try {
            // Create backup (excluding node_modules)
            const backupDir = path.join(__dirname, '../..', 'backup');
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir);
            }

            const backupDate = new Date().toISOString().replace(/[:.]/g, '-');
            const backupPath = path.join(backupDir, `backup-${backupDate}`);
            
            // Get list of files tracked by git
            const filesToBackup = await new Promise((resolve, reject) => {
                exec('git ls-files', 
                    { cwd: path.join(__dirname, '../..') },
                    (error, stdout) => {
                        if (error) reject(error);
                        else resolve(stdout.split('\n').filter(file => file && !file.includes('node_modules')));
                    }
                );
            });

            // Create backup using native Node.js functions
            const archiver = require('archiver');
            const output = fs.createWriteStream(backupPath + '.zip');
            const archive = archiver('zip', {
                zlib: { level: 9 } // Compression maximum
            });

            await new Promise((resolve, reject) => {
                output.on('close', resolve);
                archive.on('error', reject);
                archive.pipe(output);

                const rootDir = path.join(__dirname, '../..');

                const findCriticalFiles = (dir) => {
                    let files = [];
                    const entries = fs.readdirSync(dir, { withFileTypes: true });
                    
                    for (const entry of entries) {
                        const fullPath = path.join(dir, entry.name);
                        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
                            files = files.concat(findCriticalFiles(fullPath));
                        } else if (entry.isFile()) {
                            if (entry.name.endsWith('.db') || 
                                entry.name.endsWith('.sqlite') || 
                                entry.name === 'config.toml') {
                                files.push(fullPath);
                            }
                        }
                    }
                    return files;
                };

                const criticalFiles = findCriticalFiles(path.join(__dirname, '../..'));

                console.log('[Backup] Backing up critical files...');
                
                for (const filePath of criticalFiles) {
                    const relativePath = path.relative(rootDir, filePath);
                    console.log(`[Backup] Adding critical file: ${relativePath}`);
                    archive.file(filePath, { name: `critical/${relativePath}` });
                }

                console.log('[Backup] Backing up application files...');

                for (const file of filesToBackup) {
                    const filePath = path.join(rootDir, file);
                    if (fs.existsSync(filePath) && !file.includes('node_modules')) {
                        archive.file(filePath, { name: `app/${file}` });
                    }
                }

                archive.finalize();
            });

            console.log('[Update] Backing up critical files before update...');
            const tempDir = path.join(__dirname, '../..', 'temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir);
            }

            const findCriticalFiles = (dir) => {
                let files = [];
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
                        files = files.concat(findCriticalFiles(fullPath));
                    } else if (entry.isFile()) {
                        if (entry.name.endsWith('.db') || 
                            entry.name.endsWith('.sqlite') || 
                            entry.name === 'config.toml') {
                            files.push(fullPath);
                        }
                    }
                }
                return files;
            };

            const criticalFiles = findCriticalFiles(path.join(__dirname, '../..'));
            for (const sourcePath of criticalFiles) {
                const relativePath = path.relative(path.join(__dirname, '../..'), sourcePath);
                const tempPath = path.join(tempDir, relativePath);
                
                fs.mkdirSync(path.dirname(tempPath), { recursive: true });

                console.log(`[Backup] Save temporary file: ${relativePath}`);
                fs.copyFileSync(sourcePath, tempPath);
            }

            // Pull updates
            console.log('[Update] Pulling updates...');
            await new Promise((resolve, reject) => {
                exec('git fetch && git pull', (error) => {
                    if (error) reject(error);
                    else resolve();
                });
            });

            console.log('[Update] Restoring critical files...');
            const restoreCriticalFiles = (dir) => {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                
                for (const entry of entries) {
                    const tempPath = path.join(dir, entry.name);
                    const relativePath = path.relative(tempDir, tempPath);
                    const targetPath = path.join(__dirname, '../..', relativePath);

                    if (entry.isDirectory()) {
                        if (!fs.existsSync(targetPath)) {
                            fs.mkdirSync(targetPath, { recursive: true });
                        }
                        restoreCriticalFiles(tempPath);
                    } else if (entry.isFile()) {
                        console.log(`[Update] Restoring: ${relativePath}`);
                        fs.copyFileSync(tempPath, targetPath);
                        fs.unlinkSync(tempPath);
                    }
                }
            };

            if (fs.existsSync(tempDir)) {
                restoreCriticalFiles(tempDir);
                fs.rmdirSync(tempDir, { recursive: true });
            }

            // Install dependencies using detected package manager
            const packageManager = await this.detectPackageManager();
            const installCommand = {
                'npm': 'npm install',
                'pnpm': 'pnpm install',
                'yarn': 'yarn install',
                'bun': 'bun install'
            }[packageManager];

            await new Promise((resolve, reject) => {
                exec(installCommand, (error) => {
                    if (error) reject(error);
                    else resolve();
                });
            });

            await this.db.set("system-lastUpdate", {
                version: update.version,
                date: new Date().toISOString(),
                type: update.type
            });

            const result = {
                success: true,
                message: 'Update installed successfully',
                backupPath: `${backupPath}.zip`
            };

            this.emit('update.installed', {
                ...result,
                update,
                packageManager
            });

            return result;
        } catch (error) {
            console.error('Error installing update:', error);
            throw error;
        }
    }
}

module.exports = new UpdateManager();