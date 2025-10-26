/**
 *      __         ___            __        __
 *     / /_  ___  / (_)___ ______/ /___  __/ /
 *    / __ \/ _ \/ / / __ `/ ___/ __/ / / / / 
 *   / / / /  __/ / / /_/ / /__/ /_/ /_/ / /  
 *  /_/ /_/\___/_/_/\__,_/\___/\__/\__, /_/   
 *                               /____/      
 * 
 *     Heliactyl Next 3.2.0 (Avalanche)
 * 
 */

const heliactylModule = {
  "name": "Subdomain Server Module",
  "target_platform": "3.2.0"
};

module.exports.heliactylModule = heliactylModule;

const express = require('express');
const router = express.Router();
const loadConfig = require("../../handlers/config.js");
const settings = loadConfig("./config.toml");
const axios = require('axios');
const { requireAuth, ownsServer } = require("../../handlers/checkMiddleware.js");

module.exports.load = async function(app, db) {
// Filter and map enabled domains from config
const DOMAINS = (settings.cloudflare.domains || [])
  .filter(domain => domain.enabled)
  .reduce((acc, domain) => {
    acc[domain.name] = {
      domain: domain.domain,
      zoneId: domain.zone_id,
      isDefault: domain.is_default || false
    };
    return acc;
  }, {});

// Validate at least one domain is configured
if (Object.keys(DOMAINS).length === 0) {
  console.error('No enabled Cloudflare domains found in configuration');
}

const CF_API_TOKEN = settings.cloudflare.api_token;
const CF_API_URL = "https://api.cloudflare.com/client/v4";
// Helper function to format SRV record name for Cloudflare
 function formatSRVRecord(subdomain) {
   return `_minecraft._tcp.${subdomain}`;
 }
// Helper function to check if subdomain exists across all enabled domains
async function checkSubdomainExists(subdomain) {
  try {
    // Check all enabled domains in parallel
    const domainChecks = Object.values(DOMAINS).map(domain => 
      checkDomainExists(subdomain, domain)
    );
    
    const results = await Promise.all(domainChecks);
    return results.some(exists => exists);
  } catch (error) {
    console.error('Error checking subdomain:', error);
    throw error;
  }
}

async function checkDomainExists(subdomain, domainConfig) {
  try {
    console.log(domainConfig)
    const response = await axios.get(
      `${CF_API_URL}/zones/${domainConfig.zone_id}/dns_records`,
      {
        headers: {
          'Authorization': `Bearer ${CF_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        params: {
          type: 'SRV',
          name: `${formatSRVRecord(subdomain)}.${domainConfig.domain}`
        }
      }
    );
    
    return response.data.success && response.data.result.length > 0;
  } catch (error) {
    console.error('Error checking domain:', error.response?.data || error.message);
    return false;
  }
}

// Updated function to get server's existing subdomains
async function getServerSubdomains(serverId) {
  try {
    const subdomains = await db.get(`subdomains-${serverId}`) || [];
    const verifiedSubdomains = [];

    for (const subdomain of subdomains) {
      try {
        // Check if the subdomain exists in either domain
        const exists = await checkSubdomainExists(subdomain.name);
        if (exists) {
          verifiedSubdomains.push({
            ...subdomain,
            domain: subdomain.domain || DOMAINS.LEGACY.domain // Support legacy entries
          });
        }
      } catch (error) {
        console.error(`Error verifying subdomain ${subdomain.name}:`, error);
      }
    }

    if (verifiedSubdomains.length !== subdomains.length) {
      await db.set(`subdomains-${serverId}`, verifiedSubdomains);
    }

    return verifiedSubdomains;
  } catch (error) {
    console.error('Error getting server subdomains:', error);
    throw error;
  }
}

// Updated function to create DNS record
async function createDNSRecord(serverId, subdomain, serverDetails) {
  const allocation = serverDetails.attributes.relationships.allocations.data[0].attributes;
  const port = allocation.port;
  const nodeSubdomain = allocation.ip_alias;

  // Get the target domain from settings
  const targetDomain = settings.cloudflare.domains.find(d => d.is_default) || settings.cloudflare.domains[0];
  if (!targetDomain) {
    throw new Error('No available domains configured for DNS records');
  }

  // Create SRV record using Cloudflare API
  const response = await axios.post(
    `${CF_API_URL}/zones/${targetDomain.zone_id}/dns_records`,
    {
      type: "SRV",
      name: `${formatSRVRecord(subdomain)}.${targetDomain.domain}`,
      ttl: 1,
      priority: 0,
      weight: 5,
      port: port,
      target: nodeSubdomain,
      proxied: false,
      comment: "Created for server ID " + serverId
    },
    {
      headers: {
        'Authorization': `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!response.data.success) {
    throw new Error('Failed to create DNS record');
  }

  return {
    recordId: response.data.result.id,
    domain: targetDomain.domain
  };
}

// Updated router endpoints
router.post('/server/:id/subdomains', requireAuth, ownsServer, async (req, res) => {
  try {
    const serverId = req.params.id;
    const { subdomain } = req.body;
    
    if (!subdomain || !/^[a-z0-9-]+$/i.test(subdomain)) {
      return res.status(400).json({ error: 'Invalid subdomain format' });
    }

    const existingSubdomains = await getServerSubdomains(serverId);
    if (existingSubdomains.length >= 2) {
      return res.status(400).json({ error: 'Maximum number of subdomains (2) reached' });
    }

    if (await checkSubdomainExists(subdomain)) {
      return res.status(400).json({ error: 'Subdomain already exists' });
    }

    const serverDetails = await pterodactylClient.getServerDetails(serverId);
    const { recordId, domain } = await createDNSRecord(serverId, subdomain, serverDetails);

    const newSubdomain = {
      name: subdomain,
      recordId: recordId,
      domain: domain,
      createdAt: new Date().toISOString()
    };
    
    existingSubdomains.push(newSubdomain);
    await db.set(`subdomains-${serverId}`, existingSubdomains);
    await serverActivityLog(db, serverId, 'Create Subdomain', { subdomain, domain });
    
    res.status(201).json({
      message: 'Subdomain created successfully',
      subdomain: newSubdomain
    });
  } catch (error) {
    console.error('Error creating subdomain:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

router.get('/server/:id/subdomains', requireAuth, ownsServer, async (req, res) => {
  try {
    const serverId = req.params.id;
    const subdomains = await getServerSubdomains(serverId);
    
    res.json({ subdomains });
  } catch (error) {
    console.error('Error listing subdomains:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/server/:id/subdomains/:subdomain', requireAuth, ownsServer, async (req, res) => {
  try {
    const serverId = req.params.id;
    const subdomainToDelete = req.params.subdomain;

    const subdomains = await getServerSubdomains(serverId);
    const subdomain = subdomains.find(s => s.name === subdomainToDelete);

    if (!subdomain) {
      return res.status(404).json({ error: 'Subdomain not found' });
    }

    // Find the matching domain configuration
    const domainConfig = Object.values(DOMAINS).find(d => d.domain === subdomain.domain);
    if (!domainConfig) {
      throw new Error('Domain configuration not found for the subdomain');
    }
    const zoneId = domainConfig.zoneId;

    const response = await axios.delete(
      `${CF_API_URL}/zones/${zoneId}/dns_records/${subdomain.recordId}`,
      {
        headers: {
          'Authorization': `Bearer ${CF_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.data.success) {
      throw new Error('Failed to delete DNS record');
    }

    const updatedSubdomains = subdomains.filter(s => s.name !== subdomainToDelete);
    await db.set(`subdomains-${serverId}`, updatedSubdomains);
    await serverActivityLog(db, serverId, 'Delete Subdomain', { 
      subdomain: subdomainToDelete,
      domain: subdomain.domain 
    });
    
    res.json({ message: 'Subdomain deleted successfully' });
  } catch (error) {
    console.error('Error deleting subdomain:', error);
    res.status(500).json({ error: 'Failed to delete subdomain' });
  }
});

app.use('/api', router);
};