var request = require('request');
var syncRequest = require('sync-request');
var uuid = require('uuid');
var cljs = require('collaborativejs');

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
var totalItemsCount = 10;
var itemsPerRequest = 1;
var generatingInterval = 1;
var sendingInterval = 1;
var statusUpdateInterval = 500;
var timerObj = {setTimeout: setTimeout, clearTimeout: clearTimeout};

// testing results
var testPassed = false;
var netErrors = '';

// requests stat
var requestsSent = 0;
var requestsComplete = 0;
var requestsFailed = 0;
var requestsSucceed = 0;

// items stat
var opsGenerated = 0;
var opsSent = 0;
var opsDelivered = 0;
var opsLost = 0;
var opsStat = {ins: 0, rm: 0, undo: 0, redo: 0};

var returnedOps = [];
var returnedOpsMap = {};

// server stat
var requestReceived = NaN;
var serverOpsReceived = NaN;
var serverOpsStored = NaN;
var serverIdsStored = NaN;
var serverOpsSent = NaN;
var serverUpdatesStored = NaN;
var serverDocumentData = 'N/A';

// document
var document = null;
var model1 = null;
var model2 = null;


function runTests() {
  document = createDocument();
  model1 = createModel(document.id);
  model2 = createModel(document.id);
  startSending();
}


function createDocument() {
  var result = syncRequest('POST', 'http://localhost:3000/create');
  var response = JSON.parse(result.getBody());
  return response.document;
}

function createModel(documentId) {
  var result = syncRequest('POST', 'http://localhost:3000/document/' + documentId);
  var data = JSON.parse(result.getBody());
  var site = new cljs.Site(data.siteId);
  var net = new cljs.net.Http(returnedOps.length, timerObj);
  var model = {siteId: data.siteId, site: site, document: data.document, net: net};
  var callback = onSiteReceivedUpdates.bind(this, model);

  site.register(
      data.document.id,
      cljs.ops.string.transform,
      cljs.ops.string.invert,
      data.document.context
  );
  site.update(data.document.ops);

  net.requestAbortAllowed(false);
  net.sendFn(sendFunction);
  net.listen('updates-received', callback);

  return model;
}

function onSiteReceivedUpdates(model, evt) {
  var data = evt.value;
  for (var i = 0, count = data.length; i < count; i++) {
    var dataItem = data[i];
    var updates = dataItem.updates;
    if (updates && updates.length && updates[0].siteId != model.siteId) {
      var tuple = model.site.update(updates);
      var ops = tuple.toExec[model.document.id];
      model.document.data = cljs.ops.string.exec(model.document.data, ops);
    }
  }
}

function startSending() {
  var generatingIntervalId = setInterval(function() {
    if (opsGenerated < totalItemsCount) {
      var site = (Math.round(Math.random()) == 0) ? model1 : model2;
      var ops = generateOps(site);
      opsGenerated += ops.length;
      site.net.send(ops);
    } else {
      clearInterval(generatingIntervalId);
    }
  }, generatingInterval);

  var statusUpdateIntervalId = setInterval(function() {
    if (isTestComplete()) {
      clearInterval(statusUpdateIntervalId);
      model1.net.stop();
      model2.net.stop();
      exit();
    } else {
      requestStatus();
    }
  }, statusUpdateInterval);

  model1.net.start(sendingInterval);
  model2.net.start(sendingInterval);
}


function sendFunction(ops, packageIndex, onComplete) {
  var options = {
    method: 'post',
    body: {
      documentId: document.id,
      packageIndex: packageIndex,
      ops: ops
    },
    json: true,
    url: 'http://localhost:3000/commit'
  };
  opsSent += ops.length;
  requestsSent++;
  var callback = onCommitComplete.bind(this, ops, onComplete);
  request(options, callback);

  return function() {
  };
}

function onCommitComplete(ops, cotOnCompleteCallback, error, response, body) {
  if (error || response.statusCode == 500) {
    requestsFailed++;
    opsLost += ops.length;

    if (error) {
      netErrors += '\n' + error.toString();
    }

    cotOnCompleteCallback(false, false, returnedOps.length, body.ops);
  } else {
    if (!body.ops) console.log(body);
    requestsSucceed++;
    opsDelivered += ops.length;
    receiveOps(body.ops);

    cotOnCompleteCallback(true, false, returnedOps.length, body.ops);
  }
  requestsComplete++;
}

function generateOps(site) {
  var result = [];

  for (var i = 0; i < itemsPerRequest; i++) {
    var tuple = makeRandOps(site.document.id, site.site, site.document.data, opsStat, undefined, 1);
    site.document.data = cljs.ops.string.exec(site.document.data, tuple.toExec[site.document.id]);
    result.push({id: uuid.v4(), updates: tuple.toSend});
  }

  return result;
}

function receiveOps(ops) {
  for (var i = 0, count = ops.length; i < count; i++) {
    var op = ops[i];
    if (!returnedOpsMap[op.id]) {
      returnedOpsMap[op.id] = ops;
      returnedOps.push(ops);
    }
  }
}

function isTestComplete() {
  var allOpsSent = totalItemsCount == opsSent;
  var allOpsDeliveredToServer = totalItemsCount == serverOpsReceived;
  var allRequestsComplete = requestsSent == requestsComplete;
  return testPassed || (allOpsSent && allOpsDeliveredToServer && allRequestsComplete);
}


function requestStatus(opt_callback) {
  var options = {
    method: 'post',
    json: true,
    body: {documentId: document.id},
    url: 'http://localhost:3000/stat'
  };

  request(options, function(error, response, body) {
    requestReceived = body.requestReceived;
    serverOpsReceived = body.opsReceived;
    serverOpsSent = body.opsSent;

    serverOpsStored = body.opsStored;
    serverIdsStored = body.idsStored;
    serverUpdatesStored = body.updatesStored;
    serverDocumentData = body.documentData;

    checkTestPassed();
    reportStatus();

    if (opt_callback) opt_callback();
  });
}

function checkTestPassed() {
  testPassed =
      totalItemsCount == serverOpsStored &&
      totalItemsCount == serverIdsStored &&
      totalItemsCount == serverUpdatesStored &&
      model1.document.data == serverDocumentData &&
      model2.document.data == serverDocumentData &&
      totalItemsCount == returnedOps.length;
}


function reportStatus() {
  console.log(
      'Status report' +
      '\n    Requests - sent: %d, received by server: %d, complete: %d, succeed: %d, failed: %d' +
      '\n    Client Ops - generated: %d, sent: %d, delivered: %d, lost: %d, returned: %d' +
      '\n    Server Ops - received: %d, stored: %d, keys stored: %d, updatesStored: %d, sent: %d' +
      '\n    Document data: ' +
      '\n        server: %s' +
      '\n        model1: %s' +
      '\n        model2: %s' +
      '\n        ops stat: %s' +
      '\nTest complete: %s',
      requestsSent, requestReceived, requestsComplete, requestsSucceed, requestsFailed,
      opsGenerated, opsSent, opsDelivered, opsLost, returnedOps.length,
      serverOpsReceived, serverOpsStored, serverIdsStored, serverUpdatesStored, serverOpsSent,
      serverDocumentData, model1.document.data, model2.document.data, JSON.stringify(opsStat),
      isTestComplete()
  );
}


function exit() {
  setTimeout(function() {
    requestStatus(function() {
      if (netErrors) console.log('Net errors:\n' + netErrors);

      if (testPassed) {
        console.log('Test passed');
        process.exit(0);
      } else {
        console.error('Test failed');
        process.exit(1);
      }
    });
  }, 1000);
}


// region ---- random string ops (need move to cot)
/**
 * @param {string} docId
 * @param {cljs.Site} site
 * @param {string} data
 * @param {{ins:number, rm:number,undo:number,redo:number}} stat
 * @param {number=} opt_opType
 * @param {number=} opt_allowedOps 0 - insert only, 1 - insert + remove,
 * 2 - insert + remove + undo, 3 + insert + remove + undo + redo
 * @return {!Array.<Object>}
 */
function makeRandOps(docId, site, data, stat, opt_opType, opt_allowedOps) {
  var allowedOps = opt_allowedOps == undefined ?
      3 : opt_allowedOps;
  var opType = opt_opType == undefined ?
      (Math.round(Math.random() * allowedOps) + 1) :
      opt_opType;

  var ops, tuple;

  if (opType == 1) {
    ops = getRandInsOps(data);
    tuple = site.commit(docId, ops);
    if (stat) stat.ins++;
  } else if (opType == 2) {
    ops = getRandRmOps(data);
    if (ops) {
      tuple = site.commit(docId, ops);
      if (stat) stat.rm++;
    } else {
      ops = getRandInsOps(data);
      tuple = site.commit(docId, ops);
      if (stat) stat.ins++;
    }
  } else if (opType == 3) {
    tuple = site.undo();
    if (tuple) {
      if (stat) stat.undo++;
    } else {
      ops = getRandInsOps(data);
      tuple = site.commit(docId, ops);
      if (stat) stat.ins++;
    }
  } else {
    tuple = site.redo();
    if (tuple) {
      if (stat) stat.redo++;
    } else {
      ops = getRandInsOps(data);
      tuple = site.commit(docId, ops);
      if (stat) stat.ins++;
    }
  }

  return tuple;
}


/**
 * @param {string} data
 * @param {Array.<string>=} opt_alphabet
 * @param {number=} opt_maxCount
 * @return {Array<!cljs.ops.string.Operation>}
 */
function getRandInsOps(data, opt_alphabet, opt_maxCount) {
  if (!opt_maxCount) opt_maxCount = 3;
  if (!opt_alphabet) opt_alphabet = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'];
  var insCount = Math.floor(Math.random() * opt_maxCount) + 1;
  var insIndex = Math.floor(Math.random() * data.length + 1);
  insIndex = insIndex < 0 ? 0 : insIndex;
  insIndex = insIndex > data.length ? data.length : insIndex;

  var index, insString = '';
  for (var i = 0, count = insCount; i < count; i++) {
    index = Math.floor(Math.random() * 6);
    insString += opt_alphabet[index];
  }

  var newData = [
    data.slice(0, insIndex),
    insString,
    data.slice(insIndex)
  ].join('');

  return cljs.ops.string.genOps(data, newData);
}


/**
 * @param {string} data
 * @param {number=} opt_maxCount
 * @return {Array<!cljs.ops.string.Operation>}
 */
function getRandRmOps(data, opt_maxCount) {
  var result = null;
  if (data.length) {
    if (!opt_maxCount) opt_maxCount = 3;
    var rmIndex = Math.floor(Math.random() * (data.length - 1));
    var rmCount = Math.min(Math.floor(Math.random() * opt_maxCount) + 1, data.length - rmIndex);
    var newData = data.replace(data.substring(rmIndex, rmIndex + rmCount), '');
    result = cljs.ops.string.genOps(data, newData);
  }
  return result;
}
// endregion