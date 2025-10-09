const loadConfig = require("../handlers/config");
const settings = loadConfig("./config.toml");

/* Ensure platform release target is met */
const heliactylModule = { "name": "LV", "api_level": 3, "target_platform": "19.1.1" };

if (heliactylModule.target_platform !== settings.version) {
  console.log('Module ' + heliactylModule.name + ' does not support this platform release of Heliactyl. The module was built for platform ' + heliactylModule.target_platform + ' but is attempting to run on version ' + settings.version + '.')
  process.exit()
}

/* Module */
module.exports.heliactylModule = heliactylModule;
module.exports.load = async function(app, db) {
  // Savings Account Constants
  const SAVINGS_INTEREST_RATE = 0.05; // 5% annual interest rate
  const MINIMUM_DEPOSIT = 0.5; // Minimum 10 XRS to open a savings account
  const COMPOUND_INTERVAL = 24 * 60 * 60 * 1000; // Compound daily (in milliseconds)

  // Helper function to get user's savings account
  const getUserSavingsAccount = async (userId) => {
    return await db.get(`savings-account-${userId}`) || null;
  };

  // Helper function to update user's savings account
  const updateUserSavingsAccount = async (userId, accountData) => {
    await db.set(`savings-account-${userId}`, accountData);
  };

  // Helper function to calculate interest
  const calculateInterest = (principal, rate, time) => {
    // time is in milliseconds, convert to years
    const timeInYears = time / (365 * 24 * 60 * 60 * 1000);
    return principal * Math.pow((1 + rate), timeInYears) - principal;
  };

  // Open Savings Account endpoint
  app.post("/xrs/savings/open", async (req, res) => {
    if (!req.session.pterodactyl) return res.redirect(`/login`);
    
    const userId = req.session.userinfo.id;
    const { depositAmount } = req.body;

    if (isNaN(depositAmount) || depositAmount < MINIMUM_DEPOSIT) {
      return res.status(400).json({ error: `Minimum deposit is ${MINIMUM_DEPOSIT} XRS` });
    }

    const userXRSBalance = await getUserXRSBalance(userId);
    if (userXRSBalance < depositAmount) {
      return res.status(400).json({ error: "Insufficient XRS balance" });
    }

    const existingAccount = await getUserSavingsAccount(userId);
    if (existingAccount) {
      return res.status(400).json({ error: "You already have a savings account" });
    }

    const newAccount = {
      balance: depositAmount,
      lastCompoundTime: Date.now(),
      interestEarned: 0
    };

    await updateUserSavingsAccount(userId, newAccount);
    await updateUserXRSBalance(userId, -depositAmount, 0);

    res.status(200).json({
      message: "Savings account opened successfully",
      account: newAccount
    });
  });

  // Deposit to Savings Account endpoint
  app.post("/xrs/savings/deposit", async (req, res) => {
    if (!req.session.pterodactyl) return res.redirect(`/login`);
    
    const userId = req.session.userinfo.id;
    const { depositAmount } = req.body;

    if (isNaN(depositAmount) || depositAmount <= 0) {
      return res.status(400).json({ error: "Invalid deposit amount" });
    }

    const userXRSBalance = await getUserXRSBalance(userId);
    if (userXRSBalance < depositAmount) {
      return res.status(400).json({ error: "Insufficient XRS balance" });
    }

    const account = await getUserSavingsAccount(userId);
    if (!account) {
      return res.status(400).json({ error: "No savings account found" });
    }

    // Compound interest before deposit
    const timeElapsed = Date.now() - account.lastCompoundTime;
    const interestEarned = calculateInterest(account.balance, SAVINGS_INTEREST_RATE, timeElapsed);

    account.balance += depositAmount + interestEarned;
    account.interestEarned += interestEarned;
    account.lastCompoundTime = Date.now();

    await updateUserSavingsAccount(userId, account);
    await updateUserXRSBalance(userId, -depositAmount, 0);

    res.status(200).json({
      message: "Deposit successful",
      newBalance: account.balance,
      interestEarned: account.interestEarned
    });
  });

  // Withdraw from Savings Account endpoint
  app.post("/xrs/savings/withdraw", async (req, res) => {
    if (!req.session.pterodactyl) return res.redirect(`/login`);
    
    const userId = req.session.userinfo.id;
    const { withdrawAmount } = req.body;

    if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
      return res.status(400).json({ error: "Invalid withdraw amount" });
    }

    const account = await getUserSavingsAccount(userId);
    if (!account) {
      return res.status(400).json({ error: "No savings account found" });
    }

    // Compound interest before withdrawal
    const timeElapsed = Date.now() - account.lastCompoundTime;
    const interestEarned = calculateInterest(account.balance, SAVINGS_INTEREST_RATE, timeElapsed);

    account.balance += interestEarned;
    account.interestEarned += interestEarned;

    if (account.balance < withdrawAmount) {
      return res.status(400).json({ error: "Insufficient balance in savings account" });
    }

    account.balance -= withdrawAmount;
    account.lastCompoundTime = Date.now();

    await updateUserSavingsAccount(userId, account);
    await updateUserXRSBalance(userId, withdrawAmount, 0);

    res.status(200).json({
      message: "Withdrawal successful",
      withdrawnAmount: withdrawAmount,
      newBalance: account.balance,
      interestEarned: account.interestEarned
    });
  });

  // Get Savings Account Info endpoint
  app.get("/xrs/savings/info", async (req, res) => {
    if (!req.session.pterodactyl) return res.redirect(`/login`);

    const userId = req.session.userinfo.id;
    const account = await getUserSavingsAccount(userId);

    if (!account) {
      return res.status(404).json({ error: "No savings account found" });
    }

    // Calculate current balance including earned interest
    const timeElapsed = Date.now() - account.lastCompoundTime;
    const interestEarned = calculateInterest(account.balance, SAVINGS_INTEREST_RATE, timeElapsed);
    const currentBalance = account.balance + interestEarned;

    res.status(200).json({
      balance: currentBalance,
      interestEarned: account.interestEarned + interestEarned,
      interestRate: SAVINGS_INTEREST_RATE,
      lastCompoundTime: account.lastCompoundTime
    });
  });

  // Function to compound interest for all savings accounts
  const compoundAllSavingsAccounts = async () => {
    const allUsers = await db.list("savings-account-");

    for (const key of allUsers) {
      const userId = key.split("-")[2];
      const account = await getUserSavingsAccount(userId);

      if (account) {
        const timeElapsed = Date.now() - account.lastCompoundTime;
        const interestEarned = calculateInterest(account.balance, SAVINGS_INTEREST_RATE, timeElapsed);

        account.balance += interestEarned;
        account.interestEarned += interestEarned;
        account.lastCompoundTime = Date.now();

        await updateUserSavingsAccount(userId, account);
      }
    }
  };

  // Run compounding every day
  setInterval(compoundAllSavingsAccounts, COMPOUND_INTERVAL);

  // Governance Constants
  const PROPOSAL_CREATION_THRESHOLD = 1.5; // Minimum XRS required to create a proposal
  const VOTING_PERIOD = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
  const EXECUTION_DELAY = 2 * 24 * 60 * 60 * 1000; // 2 days in milliseconds
  const QUORUM_PERCENTAGE = 10; // 10% of total XRS supply must vote for a proposal to pass

  // Helper function to get total XRS supply
  const getTotalXRSSupply = async () => {
    return await db.get("xrs-circulating") || TOTAL_XRS;
  };

  // Helper function to get user's XRS balance
  const getUserXRSBalance = async (userId) => {
    return await db.get(`xrs-${userId}`) || 0;
  };

  // Helper function to get all proposals
  const getAllProposals = async () => {
    return await db.get("governance-proposals") || [];
  };

  // Helper function to update proposals
  const updateProposals = async (proposals) => {
    await db.set("governance-proposals", proposals);
  };

  // Governance Info endpoint
  app.get("/governance/info", async (req, res) => {
    if (!req.session.pterodactyl) return res.redirect(`/login`);

    res.status(200).json({
      proposalCreationThreshold: PROPOSAL_CREATION_THRESHOLD,
      votingPeriod: VOTING_PERIOD,
      executionDelay: EXECUTION_DELAY,
      quorumPercentage: QUORUM_PERCENTAGE
    });
  });

  // User Governance Info endpoint
  app.get("/governance/user-info", async (req, res) => {
    if (!req.session.pterodactyl) return res.redirect(`/login`);

    const userId = req.session.userinfo.id;
    const userXRSBalance = await getUserXRSBalance(userId);
    const totalXRSSupply = await getTotalXRSSupply();
    const votingPower = (userXRSBalance / totalXRSSupply) * 100;

    res.status(200).json({
      xrsBalance: userXRSBalance,
      votingPower: votingPower
    });
  });
  
  // Create Proposal endpoint
  app.post("/governance/create-proposal", async (req, res) => {
    if (!req.session.pterodactyl) return res.redirect(`/login`);
    
    const userId = req.session.userinfo.id;
    const { title, description, actions } = req.body;

    const userXRSBalance = await getUserXRSBalance(userId);
    if (userXRSBalance < PROPOSAL_CREATION_THRESHOLD) {
      return res.status(400).json({ error: "Insufficient XRS balance to create a proposal" });
    }

    const newProposal = {
      id: Date.now(),
      creator: userId,
      title,
      description,
      actions,
      createdAt: Date.now(),
      votingEndsAt: Date.now() + VOTING_PERIOD,
      executionDate: Date.now() + VOTING_PERIOD + EXECUTION_DELAY,
      forVotes: 0,
      againstVotes: 0,
      status: "Active",
      voters: {}
    };

    const proposals = await getAllProposals();
    proposals.push(newProposal);
    await updateProposals(proposals);

    res.status(200).json({
      message: "Proposal created successfully",
      proposalId: newProposal.id
    });
  });

  // Vote on Proposal endpoint
  app.post("/governance/vote", async (req, res) => {
    if (!req.session.pterodactyl) return res.redirect(`/login`);
    
    const userId = req.session.userinfo.id;
    const { proposalId, vote } = req.body;

    const proposals = await getAllProposals();
    const proposalIndex = proposals.findIndex(p => p.id === proposalId);
    if (proposalIndex === -1) {
      return res.status(404).json({ error: "Proposal not found" });
    }

    const proposal = proposals[proposalIndex];
    if (proposal.status !== "Active" || Date.now() > proposal.votingEndsAt) {
      return res.status(400).json({ error: "Voting period has ended" });
    }

    const userXRSBalance = await getUserXRSBalance(userId);
    if (userXRSBalance === 0) {
      return res.status(400).json({ error: "No XRS balance to vote" });
    }

    if (proposal.voters[userId]) {
      return res.status(400).json({ error: "Already voted on this proposal" });
    }

    if (vote === "for") {
      proposal.forVotes += userXRSBalance;
    } else if (vote === "against") {
      proposal.againstVotes += userXRSBalance;
    } else {
      return res.status(400).json({ error: "Invalid vote" });
    }

    proposal.voters[userId] = vote;
    await updateProposals(proposals);

    res.status(200).json({
      message: "Vote cast successfully",
      proposalId: proposalId,
      vote: vote
    });
  });

  // Get Proposals endpoint
  app.get("/governance/proposals", async (req, res) => {
    if (!req.session.pterodactyl) return res.redirect(`/login`);

    const proposals = await getAllProposals();
    res.status(200).json(proposals);
  });

  // Get Single Proposal endpoint
  app.get("/governance/proposal/:id", async (req, res) => {
    if (!req.session.pterodactyl) return res.redirect(`/login`);

    const proposalId = parseInt(req.params.id);
    const proposals = await getAllProposals();
    const proposal = proposals.find(p => p.id === proposalId);

    if (!proposal) {
      return res.status(404).json({ error: "Proposal not found" });
    }

    res.status(200).json(proposal);
  });

  // Execute Proposal endpoint
  app.post("/governance/execute/:id", async (req, res) => {
    if (!req.session.pterodactyl) return res.redirect(`/login`);

    const proposalId = parseInt(req.params.id);
    const proposals = await getAllProposals();
    const proposalIndex = proposals.findIndex(p => p.id === proposalId);

    if (proposalIndex === -1) {
      return res.status(404).json({ error: "Proposal not found" });
    }

    const proposal = proposals[proposalIndex];
    if (proposal.status !== "Active") {
      return res.status(400).json({ error: "Proposal is not active" });
    }

    if (Date.now() < proposal.executionDate) {
      return res.status(400).json({ error: "Execution delay has not passed" });
    }

    const totalSupply = await getTotalXRSSupply();
    const quorumThreshold = totalSupply * (QUORUM_PERCENTAGE / 100);

    if (proposal.forVotes + proposal.againstVotes < quorumThreshold) {
      proposal.status = "Defeated";
      await updateProposals(proposals);
      return res.status(400).json({ error: "Quorum not reached" });
    }

    if (proposal.forVotes > proposal.againstVotes) {
      // Execute proposal actions
      for (const action of proposal.actions) {
        switch (action.type) {
          case "updateInterestRate":
            DAILY_INTEREST_RATE = action.value;
            break;
          case "updateMinStakeAmount":
            MIN_STAKE_AMOUNT = action.value;
            break;
          // Add more action types as needed
        }
      }
      proposal.status = "Executed";
    } else {
      proposal.status = "Defeated";
    }

    await updateProposals(proposals);

    res.status(200).json({
      message: "Proposal execution processed",
      proposalId: proposalId,
      status: proposal.status
    });
  });

  // Function to check and update proposal statuses
  const updateProposalStatuses = async () => {
    const proposals = await getAllProposals();
    const currentTime = Date.now();
    let updated = false;

    for (const proposal of proposals) {
      if (proposal.status === "Active" && currentTime > proposal.votingEndsAt) {
        proposal.status = "Pending Execution";
        updated = true;
      }
    }

    if (updated) {
      await updateProposals(proposals);
    }
  };

  // Run proposal status update every hour
  setInterval(updateProposalStatuses, 60 * 60 * 1000);
  
  const lvcodes = {}
  const cooldowns = {}
  const dailyLimits = {}

  app.get(`/lv/gen`, async (req, res) => {
    if (!req.session.pterodactyl) return res.redirect("/login");

    // Check for the presence of specific cookies
    const requiredCookies = ["x5385", "x4634", "g9745", "h2843"];
    const hasCookie = requiredCookies.some(cookieName => req.cookies[cookieName] !== undefined);

    if (!hasCookie) {
      return res.status(403).send('Access denied.');
    }

    // Delete the matching cookie
    requiredCookies.forEach(cookieName => {
      if (req.cookies[cookieName]) {
        res.clearCookie(cookieName);
      }
    });

    const userId = req.session.userinfo.id;
    const now = Date.now();

    // Check daily limit
    if (!dailyLimits[userId] || dailyLimits[userId].date !== new Date().toDateString()) {
      dailyLimits[userId] = { count: 0, date: new Date().toDateString() };
    }
    if (dailyLimits[userId].count >= 50) {
      return res.status(429).send('Daily limit reached. Please try again tomorrow.');
    }

    // Check cooldown
    if (cooldowns[userId] && now < cooldowns[userId]) {
      const remainingTime = msToHoursAndMinutes(cooldowns[userId] - now);
      return res.status(429).send(`Please wait ${remainingTime} before generating another LV link.`);
    }

    const code = makeid(12);
    const referer = req.headers.referer || req.headers.referrer || '';
    const lvurl = linkvertise('1196418', referer + `redeem?code=${code}`);

    lvcodes[userId] = {
      code: code,
      user: userId,
      generated: now
    };

    cooldowns[userId] = now + 10000; // 10 second cooldown
    dailyLimits[userId].count++;

    res.redirect(lvurl);
  });

  app.get(`/afkredeem`, async (req, res) => {
    if (!req.session.pterodactyl) return res.redirect("/");

    const code = req.query.code;
    if (!code) return res.send('An error occurred with your browser!');
    if (!req.headers.referer || !req.headers.referer.includes('linkvertise.com')) return res.redirect('/afk?err=BYPASSER');

    const userId = req.session.userinfo.id;
    const usercode = lvcodes[userId];
    if (!usercode) return res.redirect(`/afk`);
    if (usercode.code !== code) return res.redirect(`/afk`);
    delete lvcodes[userId];

    // Adding coins
    const coins = await db.get(`coins-${userId}`) || 0;
    await db.set(`coins-${userId}`, coins + 10);

    res.redirect(`/afk?err=none`);
  });

  // New API endpoint to get the user's limit
  app.get(`/api/lv/limit`, async (req, res) => {
    if (!req.session.pterodactyl) return res.status(401).json({ error: 'Unauthorized' });

    const userId = req.session.userinfo.id;
    const limit = dailyLimits[userId] || { count: 0, date: new Date().toDateString() };
    const remaining = 50 - limit.count;

    res.json({
      daily_limit: 50,
      used_today: limit.count,
      remaining: remaining,
      reset_time: new Date(new Date().setHours(24, 0, 0, 0)).toISOString()
    });
  });
}

function linkvertise(userid, link) {
  var base_url = `https://link-to.net/${userid}/${Math.random() * 1000}/dynamic`;
  var href = base_url + "?r=" + btoa(encodeURI(link));
  return href;
}

function btoa(str) {
  var buffer;

  if (str instanceof Buffer) {
    buffer = str;
  } else {
    buffer = Buffer.from(str.toString(), "binary");
  }
  return buffer.toString("base64");
}

function makeid(length) {
  let result = '';
  let characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

function msToHoursAndMinutes(ms) {
  const msInHour = 3600000
  const msInMinute = 60000

  const hours = Math.floor(ms / msInHour)
  const minutes = Math.round((ms - (hours * msInHour)) / msInMinute * 100) / 100

  let pluralHours = `s`
  if (hours === 1) {
    pluralHours = ``
  }
  let pluralMinutes = `s`
  if (minutes === 1) {
    pluralMinutes = ``
  }

  return `${hours} hour${pluralHours} and ${minutes} minute${pluralMinutes}`
}