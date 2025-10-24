const requireAuth = (req, res, next) => {
  if (!req.session.userinfo || !req.session.pterodactyl) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

const ownsServer = async (req, res, next) => {
  const serverId = req.params.id || req.params.serverId || req.params.instanceId;
  const userServers = req.session.pterodactyl.relationships.servers.data;
  const serverOwned = userServers.some(server => server.attributes.identifier === serverId);

  const userId = req.session.pterodactyl.username;
  const username = req.session.pterodactyl.first_name;

  if (serverOwned) {
    console.log(`User ${username} (${userId}) owns server ${serverId}`);
    return next();
  }

  // Check if the user is a subuser of the server
  try {
    const subuserServers = await db.get(`subuser-servers-${userId}`) || [];
    const hasAccess = subuserServers.some(server => server.id === serverId);
    if (hasAccess) {
      console.log(`User ${username} (${userId}) is a subuser of server ${serverId}`);
      return next();
    }
  } catch (error) {
    console.error('Error checking subuser status:', error);
  }

  res.status(403).json({ error: 'Forbidden.' });
};

module.exports = {
  requireAuth,
  ownsServer
};