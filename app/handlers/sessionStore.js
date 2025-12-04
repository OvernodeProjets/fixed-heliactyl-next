const cluster = require('cluster');
const SQLiteStore = require('connect-sqlite3')(require('express-session'));

const sessionStoreOptions = {
    dir: './storage',
    db: 'sessions.db',
    table: 'sessions',
    concurrentDB: true
};

const sessionStore = new SQLiteStore(sessionStoreOptions);

// In cluster mode, each worker creates its own timer causing race conditions
// Patch the cleanup to only run in worker #1
if (cluster.isWorker && cluster.worker.id !== 1) {
    // Override the db.run to prevent cleanup in secondary workers
    const originalRun = sessionStore.db.run.bind(sessionStore.db);
    sessionStore.db.run = function(sql, params, callback) {
        // Block DELETE queries from cleanup timer in non-primary workers
        if (typeof sql === 'string' && sql.includes('DELETE FROM') && sql.includes('expired')) {
            if (callback) callback(null);
            return;
        }
        return originalRun(sql, params, callback);
    };
}

module.exports = sessionStore;