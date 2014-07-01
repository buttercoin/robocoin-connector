'use strict';

var ConfigMapper = require('../data_mappers/ConfigMapper');
var configMapper = new ConfigMapper();
var winston = require('winston');
var Config = require('../lib/Config');
var UserMapper = require('../data_mappers/UserMapper');
var userMapper = new UserMapper();
var async = require('async');

exports.index = function (req, res) {

    var message = (req.protocol == 'http') ?
        'Your connection is\'t secure. Don\'t submit this form over a public network.' :
        '';
    configMapper.findAll(function (err, config) {

        if (err) {
            winston.log('configMapper.findAll: ' + err);
            return res.send('Error getting confguration.');
        }

        var currentExchange = config.get('exchangeClass');
        var robocoinTestMode = config.get('robocoin.testMode');
        var bitstampTestMode = (config.get('exchangeClass') == 'MockBitstamp');

        return res.render('configurationIndex', {
            currentExchange: currentExchange,
            robocoinTestMode: robocoinTestMode,
            bitstampTestMode: bitstampTestMode,
            csrfToken: req.csrfToken(),
            securityMessage: message
        });
    });
};

exports.saveExchange = function (req, res) {

    var clientId = req.body.clientId;
    var apiKey = req.body.apiKey;
    var apiSecret = req.body.apiSecret;
    var testMode = (req.body.testMode == 'true');
    var username = req.body.username;
    var password = req.body.password;

    async.series([
        function (asyncCallback) {
            userMapper.findByLogin(username, password, asyncCallback);
        },
        function (asyncCallback) {

            var config = new Config();
            config.set('bitstamp.clientId', clientId);
            config.set('bitstamp.apiKey', apiKey);
            config.set('bitstamp.secret', apiSecret);
            if (testMode) {
                config.set('exchangeClass', 'MockBitstamp');
            } else {
                config.set('exchangeClass', 'Bitstamp');
            }

            configMapper.save(config, asyncCallback);
        }
    ], function (err) {
        if (err) return res.send(err, 400);
        return res.send('Exchange configuration saved');
    });
};

exports.saveRobocoin = function (req, res) {

    var apiKey = req.body.apiKey;
    var apiSecret = req.body.apiSecret;
    var testMode = (req.body.testMode == 'true') ? '1' : '0';
    var username = req.body.username;
    var password = req.body.password;

    async.series([
        function (asyncCallback) {
            userMapper.findByLogin(username, password, asyncCallback);
        },
        function (asyncCallback) {

            var config = new Config();
            config.set('robocoin.key', apiKey);
            config.set('robocoin.secret', apiSecret);
            config.set('robocoin.testMode', testMode);

            configMapper.save(config, asyncCallback);
        }
    ], function (err) {
        if (err) return res.send(err, 400);
        return res.send('Robocoin configuration saved');
    });


};
