'use strict';

var request = require('request');
var crypto = require('crypto');
var querystring = require('querystring');
var async = require('async');
var bigdecimal = require('bigdecimal');
var ConfigMapper = require('../../data_mappers/ConfigMapper');
var configMapper = new ConfigMapper();

var VaultOfSatoshi = function (config) {
    this._config = config;
};

VaultOfSatoshi.prototype._request = request;

VaultOfSatoshi.prototype._getNonce = function () {
    return (new Date()).getTime() * 1000;
};

VaultOfSatoshi.prototype._post = function (endpoint, options, callback) {

    if (typeof options == 'function') {
        callback = options;
        options = {};
    }

    var nonce = this._getNonce();
    options.nonce = nonce;

    var shasum = new Buffer(
        crypto.createHmac('sha512', this._config['vaultOfSatoshi.apiSecret'])
            .update(endpoint + '\0' + querystring.stringify(options))
            .digest('hex')
            .toLowerCase()
    ).toString('base64');

    var requestOptions = {
        url: this._config['vaultOfSatoshi.baseUrl'] + endpoint,
        method: 'POST',
        headers: {
            'Api-Key': this._config['vaultOfSatoshi.apiKey'],
            'Api-Sign': shasum
        },
        form: options,
        json: true
    };

    this._request(requestOptions, function (err, response, body) {

        if (err) return callback('Vault of Satoshi POST error: ' + err);

        if (response.statusCode != 200) return callback('Vault of Satoshi bad status: ' + response.statusCode);

        if (body.status == 'error') return callback('Vault of Satoshi error: ' + body.message);

        return callback(null, body.data);
    });
};

VaultOfSatoshi.prototype.getBalance = function (callback) {

    var self = this;

    async.series({
        btcBalance: function (asyncCallback) {

            self._post('/info/balance', { currency: 'btc' }, function (err, res) {

                if (err) return asyncCallback('Error getting VaultOfSatoshi BTC balance: ' + err);

                return asyncCallback(null, res);
            });
        },
        fiatBalance: function (asyncCallback) {

            self._post('/info/balance', { currency: self._config.exchangeCurrency.toLowerCase() }, function (err, res) {

                if (err) return asyncCallback('Error getting VaultOfSatoshi fiat balance: ' + err);

                return asyncCallback(null, res);
            });
        }
    }, function (err, res) {

        if (err) return callback(err);

        return callback(null, {
            btc_available: res.btcBalance.value,
            fiat_available: res.fiatBalance.value
        });
    });
};

VaultOfSatoshi.prototype.getDepositAddress = function (callback) {

    this._post('/info/wallet_address', { currency: 'btc' }, function (err, res) {

        if (err) return callback('Error getting wallet address: ' + err);

        return callback(null, { address: res.wallet_address });
    });
};

VaultOfSatoshi.prototype._numberToCurrencyObject = function (number, precision) {
    return {
        precision: precision,
        value: number.toString(),
        value_int: number * Math.pow(10, precision)
    };
};

VaultOfSatoshi.prototype._doTrade = function (type, amount, price, callback) {

    var self = this;
    var tradeOrder;

    self._post(
        '/trade/place',
        {
            type: type,
            order_currency: 'BTC',
            "units[precision]": 8,
            "units[value]": amount,
            "units[value_int]": Math.round(amount * Math.pow(10, 8)),
            payment_currency: this._config.exchangeCurrency,
            "price[precision]": 5,
            "price[value]": price,
            "price[value_int]": Math.round(price * Math.pow(10, 5))
        },
        function (err, res) {

            if (err) return callback(err);

            async.doWhilst(
                function (doWhileCallback) {
                    setTimeout(function () {

                        self.userTransactions(function (err, transactions) {

                            if (err) return doWhileCallback(err);

                            for (var i = 0; i < transactions.length; i++) {

                                if (transactions[i].order_id == res.order_id) {
                                    tradeOrder = transactions[i];
                                    return doWhileCallback();
                                }
                            }

                            return doWhileCallback();
                        });

                    }, 1000);
                },
                function () {
                    return (typeof tradeOrder === 'undefined');
                },
                function (err) {

                    if (err) return callback(err);

                    self._post('/info/order_detail', { order_id: tradeOrder.order_id }, function (err, res) {

                        if (err) return callback('Error getting order details: ' + err);

                        var fiat = bigdecimal.BigDecimal.ZERO();
                        var xbt = bigdecimal.BigDecimal.ZERO();
                        var fee = bigdecimal.BigDecimal.ZERO();

                        async.each(res,
                            function (item, eachCallback) {

                                fiat = fiat.add(new bigdecimal.BigDecimal(item.total.value));
                                xbt = xbt.add(new bigdecimal.BigDecimal(item.units_traded.value));
                                fee = fee.add(new bigdecimal.BigDecimal(item.fee.value));
                                return eachCallback();
                            },
                            function (err) {

                                if (err) return callback('Error processing order details: ' + err);

                                return callback(null, {
                                    datetime: tradeOrder.datetime,
                                    id: tradeOrder.order_id,
                                    type: tradeOrder.type,
                                    fiat: fiat.toPlainString(),
                                    xbt: xbt.toPlainString(),
                                    fee: fee.toPlainString(),
                                    order_id: tradeOrder.order_id
                                });
                            }
                        );
                    });
                }
            );
        }
    );
};

VaultOfSatoshi.prototype.buy = function (amount, price, callback) {
    this._doTrade('bid', amount, price, callback);
};

VaultOfSatoshi.prototype.sell = function (amount, price, callback) {
    this._doTrade('ask', amount, price, callback);
};

VaultOfSatoshi.prototype.withdraw = function (amount, address, callback) {

    // add the miner's fee
    amount = new bigdecimal.BigDecimal(amount);
    amount = amount.add(new bigdecimal.BigDecimal(0.0005));
    amount = parseFloat(amount.toPlainString());

    this._post('/withdraw/transfer', { address: address, currency: 'BTC', quantity: amount }, function (err) {

        return callback(err);
    });
};

VaultOfSatoshi.prototype.userTransactions = function (callback) {

    this._post('/info/orders', function (err, res) {

        if (err) return callback('Error getting orders: ' + err);

        var transactions = [];
        var transaction;
        for (var i = 0; i < res.length; i++) {

            transaction = res[i];
            transactions.push({
                id: transaction.order_id,
                datetime: Math.round(transaction.order_date / 1000),
                type: transaction.type,
                fiat: transaction.total.value,
                xbt: transaction.units.value - transaction.units_remaining.value,
                fee: transaction.fee.value,
                order_id: transaction.order_id
            });
        }

        return callback(null, transactions);
    });
};

VaultOfSatoshi.prototype.getPrices = function (callback) {

    var self = this;

    self._post(
        '/info/orderbook',
        {
            order_currency: 'BTC',
            payment_currency: this._config.exchangeCurrency,
            group_orders: 1,
            round: 2,
            count: 1
        },
        function (err, res) {

            if (err) return callback('Error getting prices: ' + err);

            return callback(null, { buyPrice: res.asks[0].price.value, sellPrice: res.bids[0].price.value });
        }
    );
};

VaultOfSatoshi.prototype.getMinimumOrders = function (callback) {
    return callback(null, { minimumBuy: 0.01, minimumSell: 0.01 });
};

var vaultOfSatoshi = null;

module.exports = {
    getInstance: function (config) {

        if (vaultOfSatoshi === null) {
            vaultOfSatoshi = new VaultOfSatoshi(config);
        }

        return vaultOfSatoshi;
    },
    clearInstance: function () {
        vaultOfSatoshi = null;
    }
};
