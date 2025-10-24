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
  "name": "Halloween Event Module",
  "target_platform": "3.2.0"
};

module.exports.heliactylModule = heliactylModule;

const { discordLog } = require("../../handlers/log.js");
const { requireAuth } = require("../../handlers/checkMiddleware.js");

const HALLOWEEN_EVENT_DURATION = 7 * 24 * 60 * 60 * 1000; // 1 week
const EVENT_START_TIME = new Date('2024-10-03T12:30:22+00:00').getTime();
const EVENT_END_TIME = EVENT_START_TIME + HALLOWEEN_EVENT_DURATION;

const HAUNTED_SERVER_LEVELS = [
    { name: "Spooky", minScore: 0, maxScore: 100 },
    { name: "Ghostly", minScore: 101, maxScore: 250 },
    { name: "Witch", minScore: 251, maxScore: 500 },
    { name: "Demonic", minScore: 501, maxScore: 1000 },
    { name: "Necromancer", minScore: 1001, maxScore: 2000 },
    { name: "Phantom", minScore: 2001, maxScore: 3500 },
    { name: "Banshee", minScore: 3501, maxScore: 5500 },
    { name: "Wraith", minScore: 5501, maxScore: 8000 },
    { name: "Poltergeist", minScore: 8001, maxScore: 11000 },
    { name: "Lich", minScore: 11001, maxScore: 14500 },
    { name: "Reaper", minScore: 14501, maxScore: 18500 },
    { name: "Dreadlord", minScore: 18501, maxScore: 23000 },
    { name: "Nightmare", minScore: 23001, maxScore: 28000 },
    { name: "Eldritch", minScore: 28001, maxScore: 33500 },
    { name: "Abomination", minScore: 33501, maxScore: 39500 },
    { name: "Void Walker", minScore: 39501, maxScore: 46000 },
    { name: "Soul Harvester", minScore: 46001, maxScore: 53000 },
    { name: "Cosmic Horror", minScore: 53001, maxScore: 60500 },
    { name: "Eternal Damnation", minScore: 60501, maxScore: 68500 },
    { name: "Eldritch God", minScore: 68501, maxScore: Infinity }
];

const HALLOWEEN_ITEMS = [
    { name: "Spectral RAM Stick", type: "ram", value: 512 },
    { name: "Phantom Processor Core", type: "cpu", value: 25 },
    { name: "Cursed Hard Drive", type: "disk", value: 1024 },
    { name: "Jack-o'-Lantern Coin Pouch", type: "coins", value: 100 }
];

const CANDY_TYPES = [
    { name: "Ghost Gummy", points: 10 },
    { name: "Witch's Brew Lollipop", points: 15 },
    { name: "Vampire Fang Chocolate", points: 20 },
    { name: "Werewolf Fur Cotton Candy", points: 25 },
    { name: "Zombie Brain Jelly Bean", points: 30 }
];

module.exports.load = async function(app, db) {
    // Initialize or get event data
    async function getOrInitEventData(userId) {
        let eventData = await db.get(`halloween-event-${userId}`);
        if (!eventData) {
            eventData = {
                userId,
                score: 0,
                lastInteraction: 0,
                inventory: [],
                candy: 0  // Initialize candy to 0 for new users
            };
            await db.set(`halloween-event-${userId}`, eventData);
            
            // Add user to all-users list
            let allUsers = await db.get('all-users') || [];
            if (!allUsers.includes(userId)) {
                allUsers.push(userId);
                await db.set('all-users', allUsers);
            }
        } else {
            // Initialize candy to 0 if it's undefined for existing users
            if (eventData.candy === undefined) {
                eventData.candy = 0;
                await db.set(`halloween-event-${userId}`, eventData);
            }
        }
        return eventData;
    }

    // New function for Trick or Treat
    async function trickOrTreat(userId) {
        const eventData = await getOrInitEventData(userId);
        const candyReward = CANDY_TYPES[Math.floor(Math.random() * CANDY_TYPES.length)];
        
        eventData.candy += candyReward.points;
        eventData.lastInteraction = Date.now();
        
        await db.set(`halloween-event-${userId}`, eventData);
        return { eventData, candyReward };
    }

    // Check if the event is active
    function isEventActive() {
        const now = Date.now();
        return now >= EVENT_START_TIME && now <= EVENT_END_TIME;
    }

    // Get current server level based on score
    function getServerLevel(score) {
        return HAUNTED_SERVER_LEVELS.find(level => score >= level.minScore && score <= level.maxScore);
    }

    // Generate a random event
    function generateRandomEvent() {
        const events = [
            { type: "ghost", message: "A ghost appeared in the OVHcloud SBG2 datacenter." },
            { type: "witch", message: "A witch cast a spell on you." },
            { type: "zombie", message: "Zombies are doing... something." },
            { type: "vampire", message: "A vampire is draining your energy." }
        ];
        return events[Math.floor(Math.random() * events.length)];
    }

    async function handleEventInteraction(userId, eventType) {
        const eventData = await getOrInitEventData(userId);
        let reward;

        switch (eventType) {
            case "ghost":
                reward = HALLOWEEN_ITEMS.find(item => item.type === "ram");
                break;
            case "witch":
                reward = HALLOWEEN_ITEMS.find(item => item.type === "coins");
                break;
            case "zombie":
                reward = HALLOWEEN_ITEMS.find(item => item.type === "cpu");
                break;
            case "vampire":
                reward = HALLOWEEN_ITEMS.find(item => item.type === "disk");
                break;
        }

        eventData.score += reward.value;
        eventData.lastInteraction = Date.now();
        eventData.inventory.push({ ...reward }); // Clone the reward object

        await db.set(`halloween-event-${userId}`, eventData);
        return { eventData, reward };
    }

    // API Endpoints

    // Get event status and user progress
    app.get("/api/halloween/status", requireAuth, async (req, res) => {
        if (!isEventActive()) {
            return res.json({ active: false, message: "The Halloween event is not currently active." });
        }

        const userId = req.session.userinfo.id;
        const eventData = await getOrInitEventData(userId);
        const serverLevel = getServerLevel(eventData.score);

        res.json({
            active: true,
            userId,
            score: eventData.score,
            serverLevel: serverLevel.name,
            inventory: eventData.inventory,
            timeRemaining: EVENT_END_TIME - Date.now()
        });
    });

    // New API endpoint for Trick or Treat
    app.post("/api/halloween/trick-or-treat", requireAuth, async (req, res) => {
        if (!isEventActive()) {
            return res.status(400).json({ error: "The Halloween event is not currently active." });
        }

        const userId = req.session.userinfo.id;
        const eventData = await getOrInitEventData(userId);

        // Check if enough time has passed since last interaction (e.g., 5 minutes)
        if (Date.now() - eventData.lastInteraction < 5 * 60 * 1000) {
            return res.status(400).json({ error: "You must wait ~5 minutes before trick-or-treating again!" });
        }

        const { eventData: updatedEventData, candyReward } = await trickOrTreat(userId);

        res.json({
            message: `You received a ${candyReward.name}!`,
            candyPoints: candyReward.points,
            totalCandy: updatedEventData.candy
        });
    });

    // New API endpoint to exchange candy for points
    app.post("/api/halloween/exchange-candy", requireAuth, async (req, res) => {
        if (!isEventActive()) {
            return res.status(400).json({ error: "The Halloween event is not currently active." });
        }

        const userId = req.session.userinfo.id;
        const eventData = await getOrInitEventData(userId);

        const candyToExchange = Math.min(req.body.candy || 0, eventData.candy);
        if (candyToExchange <= 0) {
            return res.status(400).json({ error: "Invalid candy amount." });
        }

        const pointsGained = candyToExchange;
        eventData.candy -= candyToExchange;
        eventData.score += pointsGained;

        await db.set(`halloween-event-${userId}`, eventData);

        res.json({
            success: true,
            message: `Exchanged ${candyToExchange} candy for ${pointsGained} points!`,
            newScore: eventData.score,
            newCandy: eventData.candy,
            newServerLevel: getServerLevel(eventData.score).name
        });
    });

    // Interact with the Haunted Server
    app.post("/api/halloween/interact", requireAuth, async (req, res) => {
        if (!isEventActive()) {
            return res.status(400).json({ error: "The Halloween event is not currently active." });
        }

        const userId = req.session.userinfo.id;
        const eventData = await getOrInitEventData(userId);

        // Check if enough time has passed since last interaction (e.g., 5 minutes)
        if (Date.now() - eventData.lastInteraction < 5 * 60 * 1000) {
            return res.status(400).json({ error: "You must wait ~5 minutes before playing again!" });
        }

        const randomEvent = generateRandomEvent();
        const { eventData: updatedEventData, reward } = await handleEventInteraction(userId, randomEvent.type);

        res.json({
            event: randomEvent,
            reward,
            newScore: updatedEventData.score,
            newServerLevel: getServerLevel(updatedEventData.score).name
        });
    });

    // Claim rewards
    app.post("/api/halloween/claim-rewards", requireAuth, async (req, res) => {

        if (isEventActive()) {
            return res.status(400).json({ error: "You can only claim rewards after the event ends." });
        }

        const userId = req.session.userinfo.id;
        const eventData = await getOrInitEventData(userId);

        if (eventData.rewardsClaimed) {
            return res.status(400).json({ error: "You have already claimed your rewards." });
        }

        let totalRewards = {
            ram: 0,
            cpu: 0,
            disk: 0,
            coins: 0
        };

        eventData.inventory.forEach(item => {
            totalRewards[item.type] += item.value;
        });

        // Apply rewards to user account
        let userCoins = await db.get(`coins-${userId}`) || 0;
        userCoins += totalRewards.coins;
        await db.set(`coins-${userId}`, userCoins);

        let userRam = await db.get(`ram-${userId}`) || 0;
        userRam += totalRewards.ram;
        await db.set(`ram-${userId}`, userRam);

        let userCpu = await db.get(`cpu-${userId}`) || 0;
        userCpu += totalRewards.cpu;
        await db.set(`cpu-${userId}`, userCpu);

        let userDisk = await db.get(`disk-${userId}`) || 0;
        userDisk += totalRewards.disk;
        await db.set(`disk-${userId}`, userDisk);

        // Mark rewards as claimed
        eventData.rewardsClaimed = true;
        await db.set(`halloween-event-${userId}`, eventData);

        discordLog(`Halloween Rewards Claimed`, `${req.session.userinfo.username}#${req.session.userinfo.discriminator} claimed Halloween event rewards: ${JSON.stringify(totalRewards)}`);

        res.json({
            success: true,
            message: "Rewards claimed successfully!",
            rewards: totalRewards
        });
    });

    // Get leaderboard
    app.get("/api/halloween/leaderboard", async (req, res) => {

        const allUsers = await db.get('all-users') || [];
        let leaderboard = [];

        const promises = allUsers.map(userId => db.get(`halloween-event-${userId}`));
        const results = await Promise.all(promises);

        results.forEach((eventData, index) => {
            if (eventData) {
                leaderboard.push({
                    userId: allUsers[index],
                    score: eventData.score,
                    serverLevel: getServerLevel(eventData.score).name
                });
            }
        });

        leaderboard.sort((a, b) => b.score - a.score);
        leaderboard = leaderboard.slice(0, 10); // Top 10

        res.json(leaderboard);
    });
};