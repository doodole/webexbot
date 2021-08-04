const express = require('express');
const crypto = require('crypto');

const app = express();
app.engine('pug', require('pug').__express)

app.set('views','./pug')
app.set('view engine', 'pug')

var link = {};

// This is where users are redirected once they have allowed the app in Google
app.get('/redirect', async (req, res) => {
    if (req.query.code) {
        const verify_code = crypto.randomBytes(16).toString("hex");
        link[verify_code] = req.query.code;
        return res.status(200).render('website', { verification_code: 'verify ' + verify_code });
    }
    res.status(400).send('invalid request');
});

module.exports = {
    app: app,
    link: link
}