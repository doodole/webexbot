var Framework = require('webex-node-bot-framework');
var config = require('./config');
var { link } = require('./app')
const { google } = require('googleapis');
const mysql = require('mysql2');
const calendar = google.calendar('v3');
const crypto = require('crypto');

// mysql database connection
var con = mysql.createConnection({
    host: config.dbhost,
    user: config.dbuser,
    password: config.dbpassword,
    database: 'webex',
    charset: 'utf8mb4'
});

// Creating OAuth 2 Client
const oauth2Client = new google.auth.OAuth2(
    config.googleclientid,
    config.googleclientsecret,
    'http://localhost:8080/redirect'
);

google.options({ auth: oauth2Client });

// Making the URL users click on to get to the Google authentication page
const scopes = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events'
];

const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes.join(' ')
});

// functions for encrypting and decrypting strings
const algorithm = 'aes-256-ctr'
const encrypt = (text) => {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, config.encryptionSecret, iv);
    const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
    return {
        iv: iv.toString('hex'),
        content: encrypted.toString('hex')
    };
};

const decrypt = (hash) => {
    const decipher = crypto.createDecipheriv(algorithm, config.encryptionSecret, Buffer.from(hash.iv, 'hex'));
    const decrpyted = Buffer.concat([decipher.update(Buffer.from(hash.content, 'hex')), decipher.final()]);
    return decrpyted.toString();
};

// Configuring and starting the framework
var framework = new Framework({ token: config.token });

framework.on('initialized', () => {
    framework.debug('Framework initialized!');
});

// What happens when a bot joins a room.
framework.on('spawn', function (bot, id, addedBy) {
    if (!addedBy) {
        return console.log(`Framework created an object for an existing bot in a space called: ${bot.room.title}`);
    }
    bot.say(`Hello! You may see all my commands by tagging me with "help."`);
});

var responded = false;

// Help command
framework.hears('help', (bot, trigger) => {
    bot.say('markdown', 'Here are all the commands:\n**calendar** - displays your Google Calendar events\n**create event** - Allows you to create a basic calendar event. Parameters: title, description, start, end, timezone. Example usage: create event -start august 3 2021 15:00 -end august 3 2021 17:00 -timezone America/New_York -description meet with friends -title meeting\n**freetime** - shows all timeslots with freetime. Usage: freetime in x days - gives all free timeslots within x days. freetime start: x end: y - gives all free timeslots between date x and y. Example date: 17 July 2021');
    responded = true;
});

// This command links a user's WebEx account with their Google token. Not sure how to secure this from potential user error. 
framework.hears('verify', async (bot, trigger) => {
    responded = true;
    if (link[trigger.args[1]]) {
        const { tokens } = await oauth2Client.getToken(link[trigger.args[1]]);
        const access_token = encrypt(tokens.access_token);
        const refresh_token = encrypt(tokens.refresh_token);
        const [account] = await con.promise().query(
            `SELECT * FROM tokens
            WHERE webex_id = ${mysql.escape(trigger.personId)}`
        );
        if (!account.length) {
            con.query(
                `INSERT INTO tokens 
                VALUES (${mysql.escape(trigger.personId)}, ${mysql.escape(access_token.content)}, ${mysql.escape(access_token.iv)}, ${mysql.escape(refresh_token.content)}, ${mysql.escape(refresh_token.iv)})`
            );
        } else {
            con.query(
                `UPDATE tokens
                SET access_token = ${mysql.escape(access_token.content)}, access_token_iv = ${mysql.escape(access_token.iv)}, refresh_token = ${mysql.escape(refresh_token.content)}, refresh_token_iv = ${mysql.escape(refresh_token.iv)}
                WHERE webex_id = ${mysql.escape(trigger.personId)}`
            );
        }
        delete link[trigger.args[1]]
        return bot.say(`Setup complete! You can now use Google Calendar commands`);
    }
    bot.say(`Couldn't find that verification code. Make sure you copied the command correctly`);
})

// Gets all future calendar events. Could allow users to pick specific days or timespans in the future
framework.hears('calendar', async (bot, trigger) => {
    responded = true;
    const [account] = await con.promise().query(
        `SELECT * FROM tokens
        WHERE webex_id = ${mysql.escape(trigger.personId)}`
    );
    if (!account.length) {
        return bot.say(`markdown`, `This bot needs permission before being able to access your Google Calendar. Please click [this](${url}) link to connect your account.`);
    };
    const access_token = decrypt({ 'iv': account[0].access_token_iv, 'content': account[0].access_token });
    const refresh_token = decrypt({ 'iv': account[0].refresh_token_iv, 'content': account[0].refresh_token });
    oauth2Client.setCredentials({
        access_token: access_token,
        refresh_token: refresh_token
    });
    oauth2Client.on('tokens', (tokens) => {
        const access_token = encrypt(tokens.access_token);
        con.query(
            `UPDATE tokens
            SET access_token = ${mysql.escape(access_token.content)}, access_token_iv = ${mysql.escape(access_token.iv)}
            WHERE webex_id = ${mysql.escape(trigger.personId)}`
        );
    });

    // Gets calendar events. Also checks if refresh token has been revoked or has run out.
    let res;
    try {
        // Only gets events from the primary calendar. Calendar List could be looped over to obtain all events from all calendars.
        res = await calendar.events.list({
            calendarId: 'primary',
            timeMin: new Date,
            singleEvents: true,
            orderBy: 'startTime',
        });
    } catch (e) {
        if (e.message === 'invalid_grant') {
            con.query(
                `DELETE FROM tokens
                WHERE webex_id = ${mysql.escape(trigger.personId)}`
            );
            return bot.say(`markdown`, `The refresh token associated with your account has either expired or has been revoked. Please click [this](${url}) link to reconnect your account if you wish to.`);
        }
    }
    message = [];
    res.data.items.forEach(event => {
        options = {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: 'numeric', minute: 'numeric', second: 'numeric',
            hour12: true,
        };
        message.push(`### ${event.summary}\n* Start: ${new Intl.DateTimeFormat('en-US', options).format(new Date(event.start.dateTime))}\n* End: ${new Intl.DateTimeFormat('en-US', options).format(new Date(event.end.dateTime))}\n`)
    });
    bot.say(`markdown`, message.join(''));
})

// Gets whenever the user has freetime
framework.hears('freetime', async (bot, trigger) => {
    responded = true;
    const [account] = await con.promise().query(
        `SELECT * FROM tokens
        WHERE webex_id = ${mysql.escape(trigger.personId)}`
    );
    if (!account.length) {
        return bot.say(`markdown`, `This bot needs permission before being able to access your Google Calendar. Please click [this](${url}) link to connect your account.`);
    };
    const access_token = decrypt({ 'iv': account[0].access_token_iv, 'content': account[0].access_token });
    const refresh_token = decrypt({ 'iv': account[0].refresh_token_iv, 'content': account[0].refresh_token });
    oauth2Client.setCredentials({
        access_token: access_token,
        refresh_token: refresh_token
    });
    const args = trigger.args;
    const add_days = (start, days) => {
        const new_date = start;
        new_date.setDate(new_date.getDate() + days);
        return new_date;
    };
    let timeMin;
    let add_date; // for some reason, setting the date with the add_days function changes the date of timeMin as well. 
    let timeMax;
    if (args[1] === 'in') {
        const days_from_now = Number(args[2]);
        if (isNaN(days_from_now)) {
            return bot.say('Please make sure you input an integer number of days from now.');
        };
        if (!Number.isInteger(days_from_now)) {
            return bot.say('Please make sure you input an integer number of days from now.');
        };
        if (args[2] < 1) {
            return bot.say('Please input an integer number of days from now that is greater than 0.');
        };
        timeMin = new Date;
        add_date = new Date;
        timeMax = add_days(add_date, days_from_now);
    } else if (args.indexOf('start:') !== -1 || args.indexOf('end:') !== -1) {
        if (args.indexOf('start:') === -1 || args.indexOf('end:') === -1) {
            return bot.say('Please make sure you indicate both a start and end time. Ex. freetime start: 30 july 2021 end: 8 august 2021');
        };
        const start = args.indexOf('start:');
        const end = args.indexOf('end:');
        if (end > start) {
            timeMin = new Date(args.slice(start, end).join(' '));
            timeMax = new Date(args.slice(end, args.length).join(' '));
        } else {
            timeMin = new Date(args.slice(start, args.length).join(' '));
            timeMax = new Date(args.slice(end, start).join(' '));
        };
    } else {
        timeMin = new Date(args.slice(1, args.length).join(' '));
        add_date = new Date(args.slice(1, args.length).join(' '));
        timeMax = add_days(add_date, 1);
    }
    if (timeMin == 'Invalid Date' || timeMax == 'Invalid Date') {
        return bot.say('One or more of the dates has been improperly formatted. Please format your dates like this: 17 July 2021, with the day, month, and year.');
    } else if (timeMin === timeMax) {
        return bot.say('Please make room between the two dates.');
    } else if (timeMin > timeMax) {
        return bot.say('The start date occurs after the end date. Ensure that the start date comes before the end date.');
    };
    oauth2Client.on('tokens', (tokens) => {
        const access_token = encrypt(tokens.access_token);
        con.query(
            `UPDATE tokens
            SET access_token = ${mysql.escape(access_token.content)}, access_token_iv = ${mysql.escape(access_token.iv)}
            WHERE webex_id = ${mysql.escape(trigger.personId)}`
        );
    });

    // Gets calendar events. Also checks if refresh token has been revoked or has run out.
    let res;
    try {
        // Only gets events from the primary calendar. Calendar List could be looped over to obtain all events from all calendars.
        res = await calendar.events.list({
            calendarId: 'primary',
            timeMin: timeMin,
            timeMax: timeMax,
            singleEvents: true,
            orderBy: 'startTime',
        });
    } catch (e) {
        if (e.message === 'invalid_grant') {
            con.query(
                `DELETE FROM tokens
                WHERE webex_id = ${mysql.escape(trigger.personId)}`
            );
            return bot.say(`markdown`, `The refresh token associated with your account has either expired or has been revoked. Please click [this](${url}) link to reconnect your account if you wish to.`)
        };
    };
    let schedule = [];
    res.data.items.forEach(event => {
        schedule.push([new Date(event.start.dateTime), new Date(event.end.dateTime)]);
    });

    // Creating the start of each new day within the range of days
    let day = Date.parse(new Date(new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: res.data.timeZone }).format(timeMin)));
    const last_day = Date.parse(new Date(new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: res.data.timeZone }).format(timeMax)));
    let day_changes = [];
    while (day < last_day) {
        day_changes.push(new Date(day));
        day += 8.64e+7;
    };

    // Adding the start of each day and the schedule in that day to an object
    let dates = {};
    dates[day_changes[0]] = [];
    for (let i = 1; i < day_changes.length; i++) {
        let current = 0;
        while (schedule[current] !== undefined && day_changes[i] > schedule[current][0]) {
            current += 1;
        };
        dates[day_changes[i - 1]] = schedule.slice(0, current);
        schedule.splice(0, current);
    };
    dates[day_changes[day_changes.length - 1]] = schedule

    // Getting the time between scheduled times to obtain freetime. I feel like there is a way to do this without nested for loops, but this works.
    for (const day in dates) {
        let free_time = [];
        let end = new Date(day);
        for (i in dates[day]) {
            if (end < dates[day][i][0]) {
                free_time.push([end, dates[day][i][0]]);
            };
            end = dates[day][i][1];
        };
        const next_day = new Date(Date.parse(day) + 8.64e+7);
        if (dates[day][dates[day].length - 1] !== undefined) {
            if (dates[day][dates[day].length - 1][1] < next_day) {
                free_time.push([dates[day][dates[day].length - 1][1], next_day]);
            }
        }
        dates[day] = free_time;
    }
    // Creating the message the bot sends
    let message = [];
    const date_options = {
        year: 'numeric', month: 'long', day: 'numeric',
        timeZone: res.data.timeZone
    }
    const timeslot_options = {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric',
        hour12: true,
        timeZone: res.data.timeZone
    };
    for (const day in dates) {
        const day_of_the_week_number = new Date(day).getDay();
        let day_of_the_week;
        switch (day_of_the_week_number) {
            case 0:
                day_of_the_week = 'Sunday';
                break;
            case 1:
                day_of_the_week = 'Monday';
                break;
            case 2:
                day_of_the_week = 'Tuesday';
                break;
            case 3:
                day_of_the_week = 'Wednesday';
                break;
            case 4:
                day_of_the_week = 'Thursday';
                break;
            case 5:
                day_of_the_week = 'Friday';
                break;
            case 6:
                day_of_the_week = 'Saturday';
                break;
        };
        message.push(`### ${new Intl.DateTimeFormat('en-US', date_options).format(new Date(day))} (${day_of_the_week})\n`);
        if (!dates[day].length) {
            message.push(`This day is completely free!\n`);
        } else {
            dates[day].forEach(timeslot => {
                message.push(`${new Intl.DateTimeFormat('en-US', timeslot_options).format(timeslot[0])} - ${new Intl.DateTimeFormat('en-US', timeslot_options).format(timeslot[1])}\n`);
            });
        };
    }
    bot.say(`markdown`, `Here are your free timeslots from ${new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: res.data.timeZone }).format(timeMin)} - ${new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: res.data.timeZone }).format(timeMax)}:\n${message.join('')}`)
});

// Command for creating calendar events
framework.hears('create event', async (bot, trigger) => {
    responded = true;

    // Changing the tokens to the user's tokens
    const [account] = await con.promise().query(
        `SELECT * FROM tokens
        WHERE webex_id = ${mysql.escape(trigger.personId)}`
    );
    if (!account.length) {
        return bot.say(`markdown`, `This bot needs permission before being able to access your Google Calendar. Please click [this](${url}) link to connect your account.`);
    };
    const access_token = decrypt({ 'iv': account[0].access_token_iv, 'content': account[0].access_token });
    const refresh_token = decrypt({ 'iv': account[0].refresh_token_iv, 'content': account[0].refresh_token });
    oauth2Client.setCredentials({
        access_token: access_token,
        refresh_token: refresh_token
    });
    oauth2Client.on('tokens', (tokens) => {
        const access_token = encrypt(tokens.access_token);
        con.query(
            `UPDATE tokens
            SET access_token = ${mysql.escape(access_token.content)}, access_token_iv = ${mysql.escape(access_token.iv)}
            WHERE webex_id = ${mysql.escape(trigger.personId)}`
        );
    });

    const args = trigger.args;
    let params = {};
    let current_key;

    // Getting the parameters passed into the command
    for (i = 2; i < args.length; i++) {
        if (args[i].startsWith("-")) {
            current_key = args[i].slice(1, args[i].length);
            params[current_key] = [];
        } else {
            params[current_key].push(args[i]);
        }
    };
    let start;
    let end;
    let timeZone;
    let title;
    let description;
    for (const param in params) {
        switch (param.toLowerCase()) {
            case 'start':
                start = new Date(params[param].join(' '));
                break;
            case 'end':
                end = new Date(params[param].join(' '));
                break;
            case 'timezone':
                timeZone = params[param].join(' ');
                break;
            case 'title':
                title = params[param].join(' ');
                break;
            case 'description':
                description = params[param].join(' ');
                break;
        };
    };
    if (start == 'Invalid Date' || end == 'Invalid Date') {
        return bot.say('One or more of the dates has been improperly formatted. Please format your dates like this: 17 July 2021 9:00, with the day, month, year, and time.');
    } else if (start > end) {
        return bot.say('The start date occurs after the end date. Ensure that the start date comes before the end date.');
    };

    // Making the event
    let res;
    try {
        // Only inserts event into the primary calendar. Could allow users to change which calendar later
        res = await calendar.events.insert({
            calendarId: 'primary',
            requestBody: {
                description: description,
                summary: title,
                end: {
                    dateTime: end,
                    timeZone: timeZone
                },
                start: {
                    dateTime: start,
                    timeZone: timeZone
                }
            }
        });
    } catch (e) {
        if (e.message === 'Invalid time zone definition for start time.\nInvalid time zone definition for end time.') {
            return bot.say(`markdown`, 'The timezone specified cannot be interpreted by the bot. You can find your timezone [here](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones). Please format the timezone like how it has it in the 3rd column')
        };
        if (e.message === 'invalid_grant') {
            con.query(
                `DELETE FROM tokens
                WHERE webex_id = ${mysql.escape(trigger.personId)}`
            );
            return bot.say(`markdown`, `The refresh token associated with your account has either expired or has been revoked. Please click [this](${url}) link to reconnect your account if you wish to.`);
        };
    };
    bot.say('You have successfully scheduled an event in Google Calendar');
});

// If the bot doesn't know how to respond
framework.hears(/.*/gim, (bot, trigger) => {
    if (!responded) {
        if (trigger.message.roomType === 'direct') {
            responded = false;
            return bot.say(`Sorry, I don't know how to respond to "${trigger.text}." You may see all my commands by pinging me with "help"`)
        };
        bot.say(`Sorry, I don't know how to respond to "${trigger.args.slice(1).join(' ')}." You may see all my commands by pinging me with "help"`);
    };
    responded = false;
});

module.exports = {
    framework: framework
};