const express = require('express');
const app = express();
const path = require('path');
const bodyParser = require("body-parser");
const PORT = process.env.PORT || 8000;
let code = require('./pair');

require('events').EventEmitter.defaultMaxListeners = 500;

global.__path = process.cwd();

app.use('/code', code);
app.use('/pair', async (req, res, next) => {
    res.sendFile(__path + '/main.html');
});
app.use('/', async (req, res, next) => {
    res.sendFile(__path + '/main.html');
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════╗
║     SHADOW-X-MINI BOT ACTIVE          ║
║     Server running on port: ${PORT}     ║
╚═══════════════════════════════════════╝
    `);
});

module.exports = app;
