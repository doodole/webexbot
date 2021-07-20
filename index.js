var {app} = require('./app');
var {framework} = require('./bot');

framework.start();
app.listen(8080, () => {
    console.log(`Server is listening on port 8080`)
});
process.on('SIGINT', () => {
    framework.debug('stoppping...');
    framework.stop().then(function() {
        process.exit();
    });
});
