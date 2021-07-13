var Framework = require('webex-node-bot-framework');
var webhook = require('webex-node-bot-framework/webhook');
var config = require('./config');
const humanizeDuration = require('humanize-duration');

const start_time = new Date();

const shortDuration = humanizeDuration.humanizer({
    language: "shortEn",
    languages: {
        shortEn: {
            y: () => "y",
            mo: () => "mo",
            w: () => "w",
            d: () => "d",
            h: () => "h",
            m: () => "m",
            s: () => "s",
            ms: () => "ms",
        },
    },
});

var framework = new Framework(config);
framework.start();

framework.on('initialized', () => {
    framework.debug('Framework initialized!');
});

framework.on('spawn', function (bot, id, addedBy) {
    if (!addedBy) {
        return framework.debug(`Framework created an object for an existing bot in a space called: ${bot.room.title}`);
    } 
    bot.say(`Hello!`);
});

var responded = false;

framework.hears('help', (bot, trigger) => {
    bot.say('markdown', 'Here are all the commands:\n**hello** - The bot says hello to you!\n**uptime** - Shows how long the bot has been running');
    responded = true;
})

framework.hears('hello', (bot, trigger) => {
    bot.say(`Hello ${trigger.person.displayName}!`);
    responded = true;
});

framework.hears('uptime', (bot, trigger) => {
    bot.say(`I've been running for ${shortDuration(new Date() - start_time, {largest: 3})}`);
    responded = true;
});

framework.hears(/.*/gim, (bot, trigger) => {
    if (!responded) {
        bot.say(`Sorry, I don't know how to respond to "${trigger.message.text}." You may see all my commands by pinging me with "help"`)
    }
    responded = false;
})

process.on('SIGINT', () => {
    framework.debug('stoppping...');
    framework.stop().then(function() {
        process.exit();
    });
});