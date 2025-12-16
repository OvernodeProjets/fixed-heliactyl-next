/**
 *      __         ___            __        __
 *     / /_  ___  / (_)___ ______/ /___  __/ /
 *    / __ \/ _ \/ / / __ `/ ___/ __/ / / / / 
 *   / / / /  __/ / / /_/ / /__/ /_/ /_/ / /  
 *  /_/ /_/\___/_/_/\__,_/\___/\__/\__, /_/   
 *                               /____/      
 * 
 *     Heliactyl Next 3.2.1-beta.1 (Avalanche)
 * 
 */

const heliactylModule = {
  "name": "Pterodactyl Import Module",
  "target_platform": "latest"
};

module.exports.heliactylModule = heliactylModule;

const express = require('express');
const Client = require('ssh2-sftp-client');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { pipeline } = require('stream/promises');
const { PassThrough } = require('stream');
const loadConfig = require("../../handlers/config");
const settings = loadConfig("./config.toml");
module.exports.load = async function (router, db) {
// Constants
const MAX_SIZE_BYTES = 5 * 1024 * 1024 * 1024; // 5GB in bytes
const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks for memory efficiency
const TEMP_DIR = path.join(__dirname, '../../../temp');

// Create temp directory if it doesn't exist
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// In-memory store for transfer progress
const transfers = new Map();

class Transfer {
  constructor(id) {
    this.id = id;
    this.status = 'preparing';
    this.progress = 0;
    this.totalFiles = 0;
    this.processedFiles = 0;
    this.currentFile = '';
    this.totalSize = 0;
    this.transferredSize = 0;
    this.error = null;
    this.startTime = Date.now();
  }

  updateProgress() {
    if (this.totalSize === 0) return 0;
    this.progress = Math.min(Math.round((this.transferredSize / this.totalSize) * 100), 100);
    
    // Calculate transfer speed
    const elapsedSeconds = (Date.now() - this.startTime) / 1000;
    const mbTransferred = this.transferredSize / (1024 * 1024);
    this.speed = (mbTransferred / elapsedSeconds).toFixed(2);
    
    return this.progress;
  }

  setError(error) {
    this.status = 'failed';
    this.error = error;
    this.progress = 100; // Ensure progress bar shows complete even on error
  }
}

async function calculateDirectorySize(sftp, remotePath) {
  let totalSize = 0;
  const items = await sftp.list(remotePath);
  
  for (const item of items) {
    if (item.type === 'd') {
      totalSize += await calculateDirectorySize(sftp, `${remotePath}/${item.name}`);
    } else {
      totalSize += item.size;
    }
  }
  
  return totalSize;
}

async function downloadDirectory(sftp, remotePath, localPath, transfer) {
  const items = await sftp.list(remotePath);
  
  for (const item of items) {
    const remoteItemPath = `${remotePath}/${item.name}`;
    const localItemPath = path.join(localPath, item.name);

    if (item.type === 'd') {
      fs.mkdirSync(localItemPath, { recursive: true });
      await downloadDirectory(sftp, remoteItemPath, localItemPath, transfer);
    } else {
      transfer.currentFile = item.name;
      transfer.totalFiles++;
      
      const readStream = await sftp.createReadStream(remoteItemPath);
      const writeStream = fs.createWriteStream(localItemPath);
      
      // Create a pass-through stream to track progress
      const progressStream = new PassThrough();
      progressStream.on('data', (chunk) => {
        transfer.transferredSize += chunk.length;
        transfer.updateProgress();
      });

      await pipeline(readStream, progressStream, writeStream);
      transfer.processedFiles++;
    }
  }
}

async function uploadToServer(localPath, serverId, pterodactylDomain, apiKey, transfer) {
  const files = fs.readdirSync(localPath);
  
  for (const file of files) {
    const filePath = path.join(localPath, file);
    const stats = fs.statSync(filePath);
    
    if (stats.isDirectory()) {
      // Create directory on Pterodactyl
      await axios.post(
        `${pterodactylDomain}/api/client/servers/${serverId}/files/create-folder`,
        { root: '/', name: file },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Accept': 'application/json',
          },
        }
      );
      
      // Process directory contents
      await uploadToServer(filePath, serverId, pterodactylDomain, apiKey, transfer);
    } else {
      transfer.currentFile = file;
      
      try {
        // Get signed upload URL
        const uploadUrlResponse = await axios.get(
          `${pterodactylDomain}/api/client/servers/${serverId}/files/upload`,
          {
            params: { directory: '/' },
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Accept': 'application/json',
            },
          }
        );

        // Create form data with proper boundaries
        const form = new FormData();
        const fileStream = fs.createReadStream(filePath);
        form.append('files', fileStream);

        // Get the form boundary
        const boundary = form.getBoundary();
        const contentLength = stats.size + Buffer.byteLength(`--${boundary}--\r\n`) + 
                            Buffer.byteLength(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file}"\r\nContent-Type: application/octet-stream\r\n\r\n`);

        // Upload to the signed URL
        await axios.post(uploadUrlResponse.data.attributes.url, form, {
          headers: {
            ...form.getHeaders(),
            'Content-Length': contentLength
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          // Add timeout settings
          timeout: 30000 // 30 seconds timeout
        });

        transfer.processedFiles++;
        transfer.transferredSize += stats.size;
        transfer.updateProgress();

      } catch (error) {
        let errorMessage = error.message;
        if (error.response) {
          errorMessage = `HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`;
        }
        console.error(`Error uploading file ${file}:`, errorMessage);
        throw new Error(`Failed to upload file ${file}: ${errorMessage}`);
      }
    }
  }
}

router.post('/server/:id/import', async (req, res) => {
  const { id: serverId } = req.params;
  const { host, port, username, password } = req.body;
  
  if (!host || !port || !username || !password) {
    return res.status(400).json({ error: 'Missing SFTP credentials' });
  }

  const transferId = `import_${Date.now()}`;
  const transfer = new Transfer(transferId);
  transfers.set(transferId, transfer);

  // Start the import process in the background
  (async () => {
    const sftp = new Client();
    const tempPath = path.join(TEMP_DIR, transferId);
    
    try {
      transfer.status = 'connecting';
      await sftp.connect({
        host,
        port: parseInt(port),
        username,
        password,
        readyTimeout: 10000,
        retries: 3
      });

      // Calculate total size
      transfer.status = 'calculating';
      transfer.totalSize = await calculateDirectorySize(sftp, '/');
      
      if (transfer.totalSize > MAX_SIZE_BYTES) {
        throw new Error(`Server size exceeds maximum limit of 5GB (Found: ${(transfer.totalSize / 1024 / 1024 / 1024).toFixed(2)}GB)`);
      }

      // Create temp directory
      fs.mkdirSync(tempPath, { recursive: true });

      // Download files
      transfer.status = 'downloading';
      await downloadDirectory(sftp, '/', tempPath, transfer);
      
      // Upload to new server
      transfer.status = 'uploading';
      await uploadToServer(
        tempPath, 
        serverId, 
        settings.pterodactyl.domain,
        settings.pterodactyl.client_key,
        transfer
      );

      transfer.status = 'completed';
      
    } catch (error) {
      transfer.setError(error.message);
      console.error('Import error:', error);
    } finally {
      // Cleanup
      try {
        await sftp.end();
        fs.rmSync(tempPath, { recursive: true, force: true });
      } catch (cleanupError) {
        console.error('Cleanup error:', cleanupError);
      }
    }
  })();

  res.json({ 
    message: 'Import started',
    transferId
  });
});

// Route to check import status
router.get('/server/import/:transferId/status', (req, res) => {
  const { transferId } = req.params;
  const transfer = transfers.get(transferId);
  
  if (!transfer) {
    return res.status(404).json({ error: 'Transfer not found' });
  }

  const status = {
    status: transfer.status,
    progress: transfer.progress,
    totalFiles: transfer.totalFiles,
    processedFiles: transfer.processedFiles,
    currentFile: transfer.currentFile,
    error: transfer.error
  };

  // Clean up completed or failed transfers after 1 hour
  if (transfer.status === 'completed' || transfer.status === 'failed') {
    setTimeout(() => {
      transfers.delete(transferId);
    }, 3600000);
  }

  res.json(status);
});
};