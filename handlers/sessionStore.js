const SQLiteStore = require('connect-sqlite3')(require('express-session'));

const sessionStore = new SQLiteStore({
    dir: './storage',
    db: 'sessions.db',
    table: 'sessions',
    concurrentDB: true
});

module.exports = sessionStore;