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
    bot.say('markdown', 'Here are all the commands:\n**calendar** - displays your Google Calendar events\n**freetime** - shows all timeslots with freetime. Usage: freetime in x days - gives all free timeslots within x days. freetime start: x end: y - gives all free timeslots between date x and y. Example date: 17 July 2021');
    responded = true;
});

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
    bot.say(`Couldn't find that verification code. Make sure you copied the command correctly`);
})

// Gets all future calendar events. Could allow users to pick specific days or timespans in the future
framework.hears('calendar', async (bot ,trigger) => {
    responded = true;
    const [account] = await con.promise().query(
        `SELECT * FROM tokens
        WHERE webex_id = ${mysql.escape(trigger.personId)}`
    );
    if (!account.length) {
        return bot.say(`markdown`, `This bot needs permission before being able to access your Google Calendar. Please click [this](${url}) link to connect your account.`)
    };
    oauth2Client.setCredentials({
        access_token: `${account[0].access_token}`,
        refresh_token: `${account[0].refresh_token}`
    });
    // Only gets events from the primary calendar. Calendar List could be looped over to obtain all events from all calendars.
    const res = await calendar.events.list({
        calendarId: 'primary',
        orderBy: 'startTime',
        singleEvents: true,
        timeMin: new Date(),
    });
    message = [];
    res.data.items.forEach(event => {
        options = {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: 'numeric', minute: 'numeric', second: 'numeric',
            hour12: true,
          };
        message.push(`### ${event.summary}\n* Start: ${new Intl.DateTimeFormat('en-US', options).format(new Date(event.start.dateTime))}\n* End: ${new Intl.DateTimeFormat('en-US', options).format(new Date(event.end.dateTime))}\n`)
    });
    bot.say(`markdown`, `${message.join('')}`);
})

// Gets whenever the user has freetime. Could space out days to make things more readable. Also could allow users to pick specific days.
framework.hears('freetime', async (bot, trigger) => {
    responded = true; 
    const args = trigger.args;
    const [account] = await con.promise().query(
        `SELECT * FROM tokens
        WHERE webex_id = ${mysql.escape(trigger.personId)}`
    );
    if (!account.length) {
        return bot.say(`markdown`, `This bot needs permission before being able to access your Google Calendar. Please click [this](${url}) link to connect your account.`)
    };
    oauth2Client.setCredentials({
        access_token: `${account[0].access_token}`,
        refresh_token: `${account[0].refresh_token}`
    });
    const add_days = (start, days) => {
        const new_date = start
        new_date.setDate(new_date.getDate() + days)
        return new_date
    };
    let timeMin;
    let add_date; // for some reason, setting the date with the add_days function changes the date of timeMin as well. 
    let timeMax;
    if (args[1] === 'in') {
        if (args[2] < 1) {
            return bot.say('Please input an integer number of days from now that is greater than 0')
        };
        timeMin = new Date;
        add_date = new Date;
        timeMax = add_days(add_date, Number(args[2]));
    } else if (args.indexOf('start:') !== -1 && args.indexOf('start:') !== -1) {
        const start = args.indexOf('start:')
        const end = args.indexOf('end:')
        if (end > start) {
            timeMin = new Date(args.slice(start, end).join(' '));
            timeMax = new Date(args.slice(end, args.length).join(' '));
        } else {
            timeMin = new Date(args.slice(start, args.length).join(' '));
            timeMax = new Date(args.slice(end, start).join(' '));
        };
        if (timeMin == 'Invalid Date' || timeMax == 'Invalid Date') {
            return bot.say('One or both of the dates has been improperly formatted. Please format your dates like this: 17 July 2021, with the day, month, and year.')
        } else if (timeMin === timeMax) {
            return bot.say('Please make room between the two dates');
        } else if (timeMin > timeMax) {
            return bot.say('The start date occurs after the end date. Ensure that the start date comes before the end date')
        }
    } else {
        timeMin = new Date(args.slice(1, args.length).join(' '));
        add_date = new Date(args.slice(1, args.length).join(' '));
        timeMax = add_days(add_date, 1);
    }
    // Only gets events from the primary calendar. Calendar List could be looped over to obtain all events from all calendars.
    const res = await calendar.events.list({
        calendarId: 'primary',
        timeMin: timeMin,
        timeMax: timeMax,
        singleEvents: true,
        orderBy: 'startTime',
    });
    let schedule = [];
    res.data.items.forEach(event => {
        schedule.push([new Date(event.start.dateTime), new Date(event.end.dateTime)]);
    });
    // Creating the start of each new day within the range of days
    let day = Date.parse(new Date(new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: res.data.timeZone}).format(timeMin)));
    const last_day = Date.parse(new Date(new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: res.data.timeZone}).format(timeMax)));
    let day_changes = [];
    while (day < last_day) {
        day_changes.push(new Date(day))
        day += 8.64e+7
    };
    // Adding the start of each day and the schedule in that day to an object
    let dates = {};
    dates[day_changes[0]] = [];
    for (let i = 1; i < day_changes.length; i++) {
        let current = 0;
        while (schedule[current] !== undefined && day_changes[i] > schedule[current][0]) {
            current += 1
        };
        dates[day_changes[i-1]] = schedule.slice(0, current);
        schedule.splice(0, current);
    };
    dates[day_changes[day_changes.length-1]] = schedule
    // Getting the time between scheduled times to obtain freetime
    for (const day in dates) {
        let free_time = [];
        let end = new Date(day)
        for (i in dates[day]) {
            if (end < dates[day][i][0]) {
                free_time.push([end, dates[day][i][0]])
            };
            end = dates[day][i][1];
        };
        const next_day = new Date(Date.parse(day) + 8.64e+7)
        console.log(dates[day])
        if( dates[day][dates[day].length - 1] !== undefined) {
            if (dates[day][dates[day].length -1][1] < next_day) {
                free_time.push([dates[day][dates[day].length -1][1], next_day])
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
        message.push(`### ${new Intl.DateTimeFormat('en-US', date_options).format(new Date(day))}\n`)
        if (!dates[day].length) {
            message.push(`This day is completely free!\n`)
        } else {
            dates[day].forEach(timeslot => {
                message.push(`${new Intl.DateTimeFormat('en-US', timeslot_options).format(timeslot[0])} - ${new Intl.DateTimeFormat('en-US', timeslot_options).format(timeslot[1])}\n`)
            })
        }
    }
    bot.say(`markdown`, `Here are your free timeslots from ${new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: res.data.timeZone}).format(timeMin)} - ${new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: res.data.timeZone}).format(timeMax)}:\n${message.join('')}`)
});

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