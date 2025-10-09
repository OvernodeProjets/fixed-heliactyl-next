const requireAuth = (req, res, next) => {
    if (!req.session.userinfo || !req.session.pterodactyl) {
      return res.redirect('/');
    }
    next();
};

module.exports = requireAuth;