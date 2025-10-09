const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class CustomDBHandler {
  constructor(dbPath) {
    this.db = new sqlite3.Database(path.resolve(dbPath.replace('sqlite://', '')));
    this.namespace = 'keyv';
    this.ttlSupport = false;
    this.queue = [];
    this.isProcessing = false;
    this.totalOperationTime = 0;
    this.operationCount = 0;

    // Initialize the database table
    this.initializeDatabase().catch(err => {
      console.error('Failed to initialize database:', err);
    });

    // Log queue stats every 5 seconds
    setInterval(() => this.logQueueStats(), 5000);
  }

  async initializeDatabase() {
    return this.executeQuery(() => new Promise((resolve, reject) => {
      const createTableSQL = `
        CREATE TABLE IF NOT EXISTS keyv (
          [key] TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )`;
      
      this.db.run(createTableSQL, (err) => {
        if (err) {
          reject(err);
        } else {
          // Optionally create an index on the key column
          this.db.run('CREATE INDEX IF NOT EXISTS idx_keyv_key ON keyv ([key])', (indexErr) => {
            if (indexErr) {
              reject(indexErr);
            } else {
              resolve();
            }
          });
        }
      });
    }));
  }

  async executeQuery(operation) {
    return new Promise((resolve, reject) => {
      this.queue.push({ operation, resolve, reject });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;
    const { operation, resolve, reject } = this.queue.shift();

    const startTime = Date.now();

    try {
      const result = await operation();
      const operationTime = Date.now() - startTime;
      this.updateStats(operationTime);
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.isProcessing = false;
      this.processQueue();
    }
  }

  updateStats(operationTime) {
    this.totalOperationTime += operationTime;
    this.operationCount++;
  }

  logQueueStats() {
    const avgOperationTime = this.operationCount > 0 ? this.totalOperationTime / this.operationCount : 0;
    //console.log(`Queue length: ${this.queue.length}, Average DB operation time: ${avgOperationTime.toFixed(2)}ms`);
  }

  async get(key) {
    return this.executeQuery(() => new Promise((resolve, reject) => {
      this.db.get('SELECT value FROM keyv WHERE [key] = ?', [`${this.namespace}:${key}`], (err, row) => {
        if (err) {
          reject(err);
        } else {
          if (row) {
            const parsed = JSON.parse(row.value);
            resolve(parsed.value);
          } else {
            resolve(undefined);
          }
        }
      });
    }));
  }

  async set(key, value, ttl) {
    const expires = this.ttlSupport && ttl ? Date.now() + ttl : undefined;
    const data = JSON.stringify({
      value,
      expires
    });

    return this.executeQuery(() => new Promise((resolve, reject) => {
      this.db.run('INSERT OR REPLACE INTO keyv ([key], value) VALUES (?, ?)', [`${this.namespace}:${key}`, data], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    }));
  }

  async delete(key) {
    return this.executeQuery(() => new Promise((resolve, reject) => {
      this.db.run('DELETE FROM keyv WHERE [key] = ?', [`${this.namespace}:${key}`], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    }));
  }

  async clear() {
    return this.executeQuery(() => new Promise((resolve, reject) => {
      this.db.run('DELETE FROM keyv WHERE [key] LIKE ?', [`${this.namespace}:%`], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    }));
  }

  async has(key) {
    return this.executeQuery(() => new Promise((resolve, reject) => {
      this.db.get('SELECT 1 FROM keyv WHERE [key] = ?', [`${this.namespace}:${key}`], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(!!row);
        }
      });
    }));
  }

  close() {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

module.exports = CustomDBHandler;