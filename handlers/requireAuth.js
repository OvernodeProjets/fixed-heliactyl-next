const requireAuth = (req, res, next) => {
  if (!req.session.userinfo || !req.session.pterodactyl) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

module.exports = {
  requireAuth
};