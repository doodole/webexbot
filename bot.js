var Framework = require('webex-node-bot-framework');
var config = require('./config');
var {link} = require('./app')
const {google} = require('googleapis');
const mysql = require('mysql2');
const calendar = google.calendar('v3');

// mysql database connection
var con = mysql.createConnection({
    host: config.dbhost,
    user: config.dbuser,
    password: config.dbpassword,
    database: 'webex',
    charset : 'utf8mb4'
});

// Creating OAuth 2 Client
const oauth2Client = new google.auth.OAuth2(
    config.googleclientid,
    config.googleclientsecret,
    'http://localhost:8080/redirect'
);

google.options({auth: oauth2Client});

// Making the URL users click on to get to the Google authentication page
const scopes = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events'
];

const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes.join(' ')
});

var framework = new Framework({token: config.token});

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
    bot.say('markdown', 'Here are all the commands:\n**calendar** - displays your Google Calendar events');
    responded = true;
})

framework.hears('verify', async (bot, trigger) => {
    responded = true;
    if (link[trigger.args[1]]) {
        const {tokens} = await oauth2Client.getToken(link[trigger.args[1]]);
        // Tokens stored in plain text. This needs to be changed eventually.
        con.query(
            `INSERT INTO tokens 
            VALUES (${mysql.escape(trigger.personId)}, ${mysql.escape(tokens.access_token)}, ${mysql.escape(tokens.refresh_token)})`
        );
        delete link[trigger.args[1]]
        return bot.say(`Setup complete! You can now use Google Calendar commands`);
    }
    bot.say(`Couldn't find that verification code. Make sure you copied the command correctly`)
})

framework.hears('calendar', async (bot ,trigger) => {
    responded = true;
    const [account] = await con.promise().query(
        `SELECT * FROM tokens
        WHERE webex_id = ${mysql.escape(trigger.personId)}`
    )
    if (!account.length) {
        return bot.say(`markdown`, `This bot needs permission before being able to access your Google Calendar. Please click [this](${url}) link to connect your account.`)
    }
    oauth2Client.setCredentials({
        access_token: `${account[0].access_token}`,
        refresh_token: `${account[0].refresh_token}`
    });
    // Only gets events from the primary calendar. Calendar List could be looped over to obtain all events from all calendars.
    const res = await calendar.events.list({
        calendarId: 'primary',
        timeMin: new Date(),
    });
    console.log(res.data);
    message = [];
    res.data.items.forEach(event => {
        options = {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: 'numeric', minute: 'numeric', second: 'numeric',
            hour12: true,
          }
        message.push(`### ${event.summary}\n* Start: ${new Intl.DateTimeFormat('en-US', options).format(new Date(event.start.dateTime))}\n* End: ${new Intl.DateTimeFormat('en-US', options).format(new Date(event.end.dateTime))}\n`)
    });
    bot.say(`markdown`, `${message.join('')}`)
})

framework.hears(/.*/gim, (bot, trigger) => {
    if (!responded) {
        if (trigger.message.roomType === 'direct') {
            responded = false;
            return bot.say(`Sorry, I don't know how to respond to "${trigger.text}." You may see all my commands by pinging me with "help"`)
        }
        bot.say(`Sorry, I don't know how to respond to "${trigger.args.slice(1).join(' ')}." You may see all my commands by pinging me with "help"`);
    }
    responded = false;
})

module.exports = {
    framework: framework
}