const express = require('express');
const crypto = require('crypto');

const app = express()

var link = {};

// This is where users are redirected once they have allowed the app in Google
app.get('/redirect', async (req,res) => {
    if (req.query.code) {
        const verify_code = crypto.randomBytes(16).toString("hex");
        link[verify_code] = req.query.code;
        return res.status(200).send(`In order to connect your google account to your Webex account, please direct message the bot with this command (no need to start with it's name): verify ${verify_code}`);
    }
    res.status(400).send('invalid request');
})

module.exports = {
    app: app,
    link: link
}