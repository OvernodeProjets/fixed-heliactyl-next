const heliactylModule = {
  "name": "Profile Module",
  "target_platform": "3.2.3"
};
module.exports.heliactylModule = heliactylModule;

const ApplicationAPI = require("../handlers/ApplicationAPI");
const settings = require("../handlers/config")("./config.toml");
const AppAPI = new ApplicationAPI(settings.pterodactyl.domain, settings.pterodactyl.key);
const getPteroUser = require("../handlers/getPteroUser");
const { discordLog, addNotification } = require("../handlers/log");
const { requireAuth } = require("../handlers/checkMiddleware");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports.load = async function (router, db) {
  const authMiddleware = (req, res, next) => requireAuth(req, res, next, false, db);

  router.get("/profile/oauth", authMiddleware, async (req, res) => {
    try {
      const userId = req.session.userinfo.id;
      const connections = [];

      const [userEmail, pterodactylId] = await Promise.all([
        db.get(`userid-${userId}`),
        db.get(`users-${userId}`)
      ]);

      let localUser = null;
      if (userEmail) {
        localUser = await db.get(`user-${userEmail}`);
        if (localUser?.password) {
          connections.push({ provider: "Local" });
        }
      }

      if (pterodactylId && !localUser?.password) {
        const pterodactylUser = await getPteroUser(userId, db);
        if (pterodactylUser) {
          const { userinfo } = req.session;
          if (userinfo.avatar || userinfo.discriminator) {
            connections.push({ provider: "Discord" });
          } else if (userinfo.picture?.includes('googleusercontent.com')) {
            connections.push({ provider: "Google" });
          } else if (userinfo.login || userinfo.html_url) {
            connections.push({ provider: "GitHub" });
          }
        }
      }

      res.json({ connections });
    } catch (error) {
      console.error("Error loading OAuth connections:", error);
      res.status(500).json({ error: "Failed to load OAuth connections" });
    }
  });

  router.post("/profile/update", authMiddleware, async (req, res) => {
    try {
      const userId = req.session.userinfo.id;
      const { username, email } = req.body;

      if (!username || typeof username !== 'string' || username.trim().length === 0) {
        return res.status(400).json({ error: "Username is required" });
      }

      const trimmedUsername = username.trim();
      if (trimmedUsername.length < 3 || trimmedUsername.length > 20) {
        return res.status(400).json({ error: "Username must be between 3 and 20 characters" });
      }

      const [pterodactylId, userEmail] = await Promise.all([
        db.get(`users-${userId}`),
        db.get(`userid-${userId}`)
      ]);

      if (!pterodactylId) {
        return res.status(404).json({ error: "User not found" });
      }

      const localUser = userEmail ? await db.get(`user-${userEmail}`) : null;
      const { username: oldUsername, email: oldEmail } = req.session.userinfo;

      if (localUser) {
        const usernameChanged = trimmedUsername !== localUser.username;
        const emailChanged = email && email !== localUser.email;

        if (emailChanged) {
          if (!EMAIL_REGEX.test(email)) {
            return res.status(400).json({ error: "Invalid email format" });
          }

          const existingEmail = await db.get(`user-${email}`);
          if (existingEmail?.id && existingEmail.id !== userId) {
            return res.status(409).json({ error: "Email already in use" });
          }
        }

        if (usernameChanged) {
          const existingUsername = await db.get(`username-${trimmedUsername}`);
          if (existingUsername && existingUsername !== userId) {
            return res.status(409).json({ error: "Username already taken" });
          }
        }

        const finalEmail = email || localUser.email;
        const updatePromises = [];

        if (emailChanged) {
          updatePromises.push(
            db.delete(`user-${localUser.email}`),
            db.set(`user-${finalEmail}`, { ...localUser, email: finalEmail }),
            db.set(`userid-${userId}`, finalEmail)
          );
        } else {
          updatePromises.push(
            db.set(`user-${userEmail || finalEmail}`, { ...localUser, username: trimmedUsername, email: finalEmail })
          );
        }

        if (usernameChanged) {
          updatePromises.push(
            db.delete(`username-${localUser.username}`),
            db.set(`username-${trimmedUsername}`, userId)
          );
        }

        await Promise.all(updatePromises);
      }

      const [pterodactylUser] = await Promise.all([
        getPteroUser(userId, db),
        addNotification(db, userId, "user:profile:update", "Profile information updated", req.ip, req.headers['user-agent'])
      ]);

      if (pterodactylUser) {
        const attrs = pterodactylUser.attributes;
        await AppAPI.updateUser(pterodactylId, {
          username: trimmedUsername,
          email: email || attrs.email || req.session.userinfo.email,
          first_name: attrs.first_name || trimmedUsername,
          last_name: attrs.last_name || ""
        });
      }

      req.session.userinfo.username = trimmedUsername;
      if (email) req.session.userinfo.email = email;

      const changes = [];
      if (oldUsername !== trimmedUsername) {
        changes.push(`Username: \`${oldUsername}\` → \`${trimmedUsername}\``);
      }
      if (email && oldEmail !== email) {
        changes.push(`Email: \`${oldEmail || 'N/A'}\` → \`${email}\``);
      }

      if (changes.length > 0 && settings.logging.status) {
        await discordLog(
          "profile update",
          `${trimmedUsername} (${userId}) updated their profile information`,
          [
            { name: "Changes", value: changes.join("\n"), inline: false },
            { name: "IP Address", value: `\`${req.ip}\``, inline: true }
          ]
        );
      }

      res.json({ success: true, message: "Profile updated successfully" });
    } catch (error) {
      console.error("Error updating profile:", error);
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  router.post("/profile/delete", authMiddleware, async (req, res) => {
    try {
      const userId = req.session.userinfo.id;
      const username = req.session.userinfo.username;

      // ??????
      //if (username === 'banny') {
      //  return res.status(403).json({ error: "This account cannot be deleted" });
      //}

      const pterodactylId = await db.get(`users-${userId}`);
      if (!pterodactylId) {
        return res.status(404).json({ error: "User not found" });
      }

      // Check if any server is suspended BEFORE doing anything
      try {
        const pterodactylUser = await getPteroUser(userId, db);
        const servers = pterodactylUser?.attributes?.relationships?.servers?.data;
        
        if (servers?.length) {
          const suspendedServers = servers.filter(server => server.attributes.suspended === true);
          
          if (suspendedServers.length > 0) {
            if (settings.logging.status) {
              await discordLog(
                "account deletion",
                `${username} (${userId}) attempted to delete their account but has suspended server(s)`,
                [
                  { name: "User ID", value: `\`${userId}\``, inline: true },
                  { name: "Pterodactyl ID", value: `\`${pterodactylId}\``, inline: true },
                  { name: "IP Address", value: `\`${req.ip}\``, inline: true },
                  { name: "Suspended Servers", value: suspendedServers.map(s => `\`${s.attributes.name || s.attributes.identifier}\``).join(", "), inline: false }
                ]
              );
            }
            return res.status(403).json({ error: "Cannot delete account with suspended servers. Please contact support." });
          }
        }
      } catch (error) {
        console.error("Error checking suspended servers:", error);
      }

      const userEmail = await db.get(`userid-${userId}`);
      const localUser = userEmail ? await db.get(`user-${userEmail}`) : null;

      const deletePromises = [
        db.delete(`users-${userId}`),
        db.delete(`coins-${userId}`),
        db.delete(`package-${userId}`),
        db.delete(`password-${userId}`),
        db.delete(`j4rs-${userId}`),
        db.delete(`ipuser-${req.ip}`)
      ];

      if (localUser) {
        deletePromises.push(
          db.delete(`user-${userEmail}`),
          db.delete(`userid-${userId}`),
          db.delete(`username-${localUser.username}`)
        );
      }

      const [allKeys, allUserKeys, userList] = await Promise.all([
        db.list(`${userId}-*`),
        db.list(`*-${userId}`),
        db.get("users")
      ]);

      deletePromises.push(...allKeys.map(key => db.delete(key)));
      deletePromises.push(...allUserKeys.map(key => db.delete(key)));

      if (userList) {
        const filteredList = userList.filter(id => id !== pterodactylId);
        deletePromises.push(db.set("users", filteredList));
      }

      await Promise.all(deletePromises);

      let deletedServers = [];
      let serverErrors = [];

      try {
        const pterodactylUser = await getPteroUser(userId, db);
        const servers = pterodactylUser?.attributes?.relationships?.servers?.data;
        
        if (servers?.length) {
          const deletePromises = servers.map(async (server) => {
            try {
              await AppAPI.deleteServer(server.attributes.id, true);
              return { success: true, name: server.attributes.name || server.attributes.identifier };
            } catch (error) {
              console.error(`Error deleting server ${server.attributes.id}:`, error);
              return { success: false, name: server.attributes.name || server.attributes.identifier };
            }
          });

          const results = await Promise.all(deletePromises);
          results.forEach(result => {
            if (result.success) {
              deletedServers.push(result.name);
            } else {
              serverErrors.push(result.name);
            }
          });
        }
      } catch (error) {
        console.error("Error fetching user servers:", error);
      }

      try {
        await AppAPI.deleteUser(pterodactylId);
      } catch (pteroError) {
        console.error("Error deleting Pterodactyl user:", pteroError);
      }

      await addNotification(
        db,
        userId,
        "user:account:deleted",
        "Account deleted",
        req.ip,
        req.headers['user-agent']
      );

      if (settings.logging.status) {
        const fields = [
          { name: "User ID", value: `\`${userId}\``, inline: true },
          { name: "Pterodactyl ID", value: `\`${pterodactylId}\``, inline: true },
          { name: "IP Address", value: `\`${req.ip}\``, inline: true }
        ];

        if (deletedServers.length > 0) {
          fields.push({
            name: "Deleted Servers",
            value: deletedServers.map(s => `\`${s}\``).join(", "),
            inline: false
          });
        }

        if (serverErrors.length > 0) {
          fields.push({
            name: "Server Deletion Errors",
            value: serverErrors.map(s => `\`${s}\``).join(", "),
            inline: false
          });
        }

        await discordLog(
          "account deletion",
          `${username} (${userId}) deleted their account\n\n**Actions performed:**\n• ${deletedServers.length} server(s) deleted\n• Pterodactyl account deleted`,
          fields
        );
      }

      req.session.destroy();

      res.json({ success: true, message: "Account deleted successfully" });
    } catch (error) {
      console.error("Error deleting account:", error);
      res.status(500).json({ error: "Failed to delete account" });
    }
  });
};

