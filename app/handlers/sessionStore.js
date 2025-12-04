const cluster = require('cluster');
const SQLiteStore = require('connect-sqlite3')(require('express-session'));

const sessionStoreOptions = {
    dir: './storage',
    db: 'sessions.db',
    table: 'sessions',
    concurrentDB: true
};

// Disable auto-cleanup in workers to prevent "Cannot read properties of undefined (reading 'db')" error
// Only the first worker should handle cleanup
if (cluster.isWorker && cluster.worker.id !== 1) {
    sessionStoreOptions.cleanupInterval = 0; // Disable cleanup timer
}

const sessionStore = new SQLiteStore(sessionStoreOptions);

module.exports = sessionStore;