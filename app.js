var express = require('express');
var http = require('http');
var path = require('path');

var app = express();

var AUTOCONNECTOR_INTERVAL = 60000;

// all environments
app.set('port', process.env.PORT || 3000);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');
app.use(express.favicon('public/favicon.ico'));
app.use(express.logger('dev'));
app.use(express.json());
app.use(express.urlencoded());
app.use(express.methodOverride());
app.use(app.router);
app.use(express.static(path.join(__dirname, 'public')));

// development only
if ('development' == app.get('env')) {
    app.use(express.errorHandler());
    app.locals.pretty = true;
}

var index = require('./routes/index');
app.get('/transactions', index.transactions);
app.get('/account-info', index.accountInfo);
app.get('/buy-and-sell', index.buyAndSell);

var exchange = require('./routes/exchange');
app.get('/exchange/last-price', exchange.lastPrice);
app.post('/exchange/buy', exchange.buy);
app.post('/exchange/sell', exchange.sell);
app.get('/exchange/latest-transactions', exchange.latestTransactions);

var robocoin = require('./routes/robocoin');
app.post('/robocoin/transactions', robocoin.getTransactions);
app.get('/robocoin/unprocessed-transactions', robocoin.getUnprocessedTransactions);

var dashboard = require('./routes/dashboard');
app.get('/', dashboard.index);
app.get('/dashboard/summary', dashboard.summary);

var batchProcess = require('./routes/batch-process');
app.post('/batch-process', batchProcess.index);

var configuration = require('./routes/configuration');
app.get('/configuration', configuration.index);
app.post('/configuration/save-exchange', configuration.saveExchange);
app.post('/configuration/save-robocoin', configuration.saveRobocoin);

var server = http.createServer(app).listen(app.get('port'), function(){

    console.log('Express server listening on port ' + app.get('port'));

    var jobs = require('./periodicJobs');
    setInterval(function () {

        var randomNumber = (Math.random() * 3);

        // most of the time, run the autoconnector
        if (randomNumber > 1) {
            jobs.runAutoconnector();
        } else {
            // but sometimes, do the batch rollup
            jobs.batchProcess();
        }

    }, AUTOCONNECTOR_INTERVAL);
    jobs.runAutoconnector();
    console.log('Autoconnector running');
});
