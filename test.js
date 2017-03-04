var request = require('request');
var syncRequest = require('sync-request');
var uuid = require('uuid');
var cljs = require('collaborativejs');

// region ---- start server
console.log('Waiting for the server to startup');
var server = require('child_process').fork('server.js', {silent: true});
server.stdout.setEncoding('utf8');
server.stderr.setEncoding('utf8');

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
var totalOpsCount = process.argv[2] ? process.argv[2] : 10;
var opsPerRequest = 1;
var generatingInterval = 1;
var sendingInterval = 2;
var statusUpdateInterval = 500;
//0 - insert only, 1 - insert/remove, 2 - insert/remove/undo, 3 - insert/remove/undo/redo
var availableOps = 1;
var timerObj = {setTimeout: setTimeout, clearTimeout: clearTimeout};

// testing results
var testPassed = false;
var netErrors = '';

// requests stat
var requestsSent = 0;
var requestsComplete = 0;
var requestsFailed = 0;
var requestsSucceed = 0;

// ops stat
var opsGenerated = 0;
var opsSent = 0;
var opsDelivered = 0;
var opsLost = 0;
var opsStat = {ins: 0, rm: 0, undo: 0, redo: 0, log: [], types: []};
var printOpsStat = process.argv[3] ? process.argv[3] : true;

// server stat
var serverLoadedRequestReceived = NaN;
var serverRequestsReceived = NaN;
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
  var documentData = data.document;
  var document = new cljs.Document(
      cljs.ops.string.transform,
      cljs.ops.string.invert,
      data.siteId,
      documentData.context);
  var net = new cljs.net.Http(0, timerObj);
  var model = {
    document: document,
    documentData: documentData,
    net: net,
    returnedOps: [],
    returnedOpsMap: {}
  };
  var receivedUpdatesCallback = onSiteReceivedUpdates.bind(this, model);
  var sendFunctionBinding = sendFunction.bind(this, model);

  document.update(documentData.ops);

  net.setRequestAbortAllowed(false);
  net.sendFn(sendFunctionBinding);
  net.listen('updates-received', receivedUpdatesCallback);

  return model;
}

function onSiteReceivedUpdates(model, evt) {
  var data = evt.value;
  for (var i = 0, count = data.length; i < count; i++) {
    var dataItem = data[i];
    var updates = dataItem.updates;
    if (updates && updates.length && updates[0].siteId != model.document.getSiteId()) {
      var tuple = model.document.update(updates);
      model.documentData.data = cljs.ops.string.exec(model.documentData.data, tuple.toExec);
    }
  }
}

function startSending() {
  var generatingIntervalId = setInterval(function() {
    if (opsGenerated < totalOpsCount) {
      var model = (Math.round(Math.random()) == 0) ? model1 : model2;
      var ops = generateOps(model);
      opsGenerated += ops.length;
      model.net.send(ops);
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


function sendFunction(model, ops, packageIndex, onComplete) {
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
  var callback = onCommitComplete.bind(this, model, ops, onComplete);
  request(options, callback);

  return function() {
  };
}

function onCommitComplete(model, ops, cotOnCompleteCallback, error, response, body) {
  if (error || response.statusCode == 500) {
    requestsFailed++;
    opsLost += ops.length;

    if (error) {
      netErrors += '\n' + error.toString();
    }

    cotOnCompleteCallback(false, false, model.returnedOps.length, body.ops);
  } else {
    if (!body.ops) console.log(body);
    requestsSucceed++;
    opsDelivered += ops.length;
    receiveOps(model, body.ops);

    cotOnCompleteCallback(true, false, model.returnedOps.length, body.ops);
  }
  requestsComplete++;
}

function generateOps(model) {
  var result = [];
  var tuple = null;
  for (var i = 0; i < opsPerRequest; i++) {
    tuple = makeRandOps(model.document, model.documentData.data, opsStat, undefined, availableOps);
    model.documentData.data = cljs.ops.string.exec(model.documentData.data, tuple.toExec);
    result.push({id: uuid.v4(), updates: tuple.toSend});
  }

  return result;
}

function receiveOps(model, ops) {
  for (var i = 0, count = ops.length; i < count; i++) {
    var op = ops[i];
    if (!model.returnedOpsMap[op.id]) {
      model.returnedOpsMap[op.id] = ops;
      model.returnedOps.push(ops);
    }
  }
}

function isTestComplete() {
  return totalOpsCount == serverOpsStored &&
      totalOpsCount == serverIdsStored &&
      totalOpsCount == serverUpdatesStored &&
      totalOpsCount == model1.returnedOps.length &&
      totalOpsCount == model2.returnedOps.length;
}


function requestStatus(opt_callback) {
  var options = {
    method: 'post',
    json: true,
    body: {documentId: document.id},
    url: 'http://localhost:3000/stat'
  };

  request(options, function(error, response, body) {
    serverLoadedRequestReceived = body.requestWithDataReceived;
    serverRequestsReceived = body.serverRequestsReceived;
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
      totalOpsCount == serverOpsStored &&
      totalOpsCount == serverIdsStored &&
      totalOpsCount == serverUpdatesStored &&
      model1.documentData.data == serverDocumentData &&
      model2.documentData.data == serverDocumentData;
}


function reportStatus() {
  var opsStatStr = printOpsStat ? JSON.stringify(opsStat) : 'disabled';
  console.log(
      'Status report' +
      '\n    Requests - sent: %d, received by server: %d, complete: %d, succeed: %d, failed: %d' +
      '\n    Client Ops - generated: %d, sent: %d, delivered: %d, lost: %d, model1: %d, model2: %d' +
      '\n    Server Ops - received: %d, with data: %d, stored: %d, keys stored: %d, updatesStored: %d, sent: %d' +
      '\n    Document data: ' +
      '\n        server: %s' +
      '\n        model1: %s' +
      '\n        model2: %s' +
      '\n        ops stat: %s' +
      '\nTest complete: %s',
      requestsSent, serverRequestsReceived, requestsComplete, requestsSucceed, requestsFailed,
      opsGenerated, opsSent, opsDelivered, opsLost, model1.returnedOps.length, model2.returnedOps.length,
      serverOpsReceived, serverLoadedRequestReceived, serverOpsStored, serverIdsStored, serverUpdatesStored, serverOpsSent,
      serverDocumentData, model1.documentData.data, model2.documentData.data, opsStatStr,
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
 * @param {cljs.Document} document
 * @param {string} data
 * @param {{ins:number, rm:number,undo:number,redo:number}} stat
 * @param {number=} opt_opType
 * @param {number=} opt_allowedOps 0 - insert only, 1 - insert + remove,
 * 2 - insert + remove + undo, 3 + insert + remove + undo + redo
 * @return {!Array.<Object>}
 */
function makeRandOps(document, data, stat, opt_opType, opt_allowedOps) {
  var allowedOps = opt_allowedOps == undefined ?
      3 : opt_allowedOps;
  var opType = opt_opType == undefined ?
      (Math.round(Math.random() * allowedOps) + 1) :
      opt_opType;

  var ops, tuple;

  if (opType == 1) {
    ops = getRandInsOps(data);
    tuple = document.commit(ops);
    if (stat) stat.ins++;
  } else if (opType == 2) {
    ops = getRandRmOps(data);
    if (ops) {
      tuple = document.commit(ops);
      if (stat) stat.rm++;
    } else {
      opType = 1;
      ops = getRandInsOps(data);
      tuple = document.commit(ops);
      if (stat) stat.ins++;
    }
  } else if (opType == 3) {
    tuple = document.undo();
    if (tuple && tuple.toSend.length) {
      if (stat) {
        stat.undo++;
        stat.log.push('undo');
      }
    } else {
      opType = 1;
      ops = getRandInsOps(data);
      tuple = document.commit(ops);
      if (stat) stat.ins++;
    }
  } else {
    tuple = document.redo();
    if (tuple && tuple.toSend.length) {
      if (stat) {
        stat.redo++;
        stat.log.push('redo');
      }
    } else {
      opType = 1;
      ops = getRandInsOps(data);
      tuple = document.commit(ops);
      if (stat) stat.ins++;
    }
  }

  if (stat) {
    stat.types.push(document.getSiteId() + '|' + opType);
    if (ops) stat.log = stat.log.concat(ops);
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