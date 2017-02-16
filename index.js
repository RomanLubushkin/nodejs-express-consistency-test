var request = require('request');
var uuid = require('uuid');

// region ---- start server
console.log('Waiting for the server to startup');
var server = require('child_process').fork('server.js', {silent: true});
server.stdout.setEncoding('utf8');

var timeoutId = setTimeout(function() {
  console.log('Failed to start the server');
  process.exit(1);
}, 5000);

server.stdout.on('data', function(data) {
  if (data.startsWith('Example app listening on port 3000!')) {
    clearTimeout(timeoutId);
    runTests();
  } else if (data) {
    console.log('Server says:\n' + data);
  }
});

process.on('exit', function() {
  server.kill(null);
});
// endregion


// testing params
var totalItemsCount = 1000000;
var itemsPerRequest = 200;
var sendingInterval = 1;
var statusUpdateInterval = 1000;

// requests stat
var requestsSent = 0;
var requestsComplete = 0;
var requestsFailed = 0;
var requestsSucceed = 0;

// items stat
var itemsSent = 0;
var itemsDelivered = 0;
var itemsLost = 0;

// server stat
var requestReceived = NaN;
var serverItemsReceived = NaN;
var serverItemsStored = NaN;
var serverKeysStored = NaN;

var testPassed = false;



function runTests() {
  var sendingIntervalId = setInterval(function() {
    if (itemsSent < totalItemsCount) {
      commitItems();
    } else {
      clearInterval(sendingIntervalId);
    }
  }, sendingInterval);

  var statusUpdateIntervalId = setInterval(function() {
    if (isTestComplete()) {
      clearInterval(statusUpdateIntervalId);
      exit();
    } else {
      requestStatus();
    }
  }, statusUpdateInterval);
}


function commitItems() {
  var items = generateItems();
  var options = {
    method: 'post',
    body: {items: items},
    json: true,
    url: 'http://localhost:3000/commit'
  };

  itemsSent += items.length;
  requestsSent++;

  var callback = onCommitComplete.bind(this, items);
  request(options, callback);
}

function onCommitComplete(items, error, response, body) {
  if (error) {
    requestsFailed++;
    itemsLost += items.length;
  } else {
    requestsSucceed++;
    itemsDelivered += items.length;
  }
  requestsComplete++;
}

function generateItems() {
  var result = [];

  for (var i = 0; i < itemsPerRequest; i++) {
    result.push({uuid: uuid.v4()});
  }

  return result;
}

function isTestComplete() {
  return totalItemsCount == itemsSent &&
      requestsSent == requestsComplete && requestsSent == requestReceived;
}


function requestStatus() {
  var options = {
    method: 'post',
    json: true,
    url: 'http://localhost:3000/status'
  };

  request(options, function(error, response, body) {
    requestReceived = body.requestReceived;
    serverItemsReceived = body.updatesReceived;
    serverItemsStored = body.updatesStored;
    serverKeysStored = body.uuidsStored;

    testPassed =
        totalItemsCount == serverItemsStored &&
        totalItemsCount == serverKeysStored;
    reportStatus();
  });
}


function reportStatus() {
  console.log(
      'Status report' +
      '\n    Requests - sent: %d, received: %d, complete: %d' +
      '\n    Items - sent: %d, delivered: %d, lost: %d' +
      '\n    Server - received: %d, stored: %d, keys stored: %d' +
      '\nTest complete: %s',
      requestsSent, requestReceived, requestsComplete,
      itemsSent, itemsDelivered, itemsLost,
      serverItemsReceived, serverItemsStored, serverKeysStored,
      isTestComplete()
  );
}


function exit() {
  if (testPassed) {
    console.log('Test passed');
    process.exit(0);
  } else {
    console.error('Test failed');
    process.exit(1);
  }
}
