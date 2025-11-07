const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const loadConfig = require('./config');
const settings = loadConfig('./config.toml');
const EventEmitter = require('events');

class UpdateManager extends EventEmitter {
    constructor() {
        super();
        
        this.repoOwner = 'OvernodeProjets';
        this.repoName = 'fixed-heliactyl-next';
        this.updateConfig = settings.update || {
            enabled: true,
            checkReleases: true,
            checkCommits: false,
            autoInstall: false,
            checkInterval: 1800000 // 30 minutes
        };
        this.cache = {
            updates: null,
            lastCheck: 0,
            cacheTimeout: 300000 // 5 minutes cache
        };
        
        // Start automatic check
        if (this.updateConfig.enabled) {
            this.startAutoCheck();
        }
    }

    startAutoCheck() {
        // Initial check
        this.checkForUpdates().then(updates => {
            if (updates.length > 0) {
                console.log('[UpdateManager] New updates available:', updates.length);
            }
        });

        // Set interval for periodic checks
        setInterval(() => {
            this.checkForUpdates().then(updates => {
                if (updates.length > 0) {
                    console.log('[UpdateManager] New updates available:', updates.length);
                }
            });
        }, this.updateConfig.checkInterval);
    }

    async checkForUpdates(ignoreCache = false) {
        console.log('[UpdateManager] Checking for updates...');
        const now = Date.now();
        
        // Return cached results if within cache timeout
        if (!ignoreCache && this.cache.updates && (now - this.cache.lastCheck) < this.cache.cacheTimeout) {
            console.log('[UpdateManager] Returning cached updates.');
            return this.cache.updates;
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

            // Update cache
            this.cache.updates = updates;
            this.cache.lastCheck = now;

            console.log(updates)
            return updates;
        } catch (error) {
            console.error('Error checking for updates:', error);
            // If error, return cached results if available
            return this.cache.updates || [];
        }
    }

    async checkReleases() {
        const response = await axios.get(`https://api.github.com/repos/${this.repoOwner}/${this.repoName}/releases`);
        return response.data.map(release => ({
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
            
            // Get list of files to backup
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

                for (const file of filesToBackup) {
                    const filePath = path.join(__dirname, '../..', file);
                    if (fs.existsSync(filePath) && !file.includes('node_modules')) {
                        archive.file(filePath, { name: file });
                    }
                }

                archive.finalize();
            });

            // Pull updates
            await new Promise((resolve, reject) => {
                exec('git fetch && git pull', (error) => {
                    if (error) reject(error);
                    else resolve();
                });
            });

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

            return {
                success: true,
                message: 'Update installed successfully',
                backupPath: `${backupPath}.zip`
            };
        } catch (error) {
            console.error('Error installing update:', error);
            throw error;
        }
    }
}

module.exports = new UpdateManager();