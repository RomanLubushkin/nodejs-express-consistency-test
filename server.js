var express = require('express');
var bodyParser = require('body-parser');
var uuid = require('uuid');
var cljs = require('collaborativejs');


// memory storage
var storage = {};

// stat
var requestReceived = 0;
var requestWithDataReceived = 0;
var opsReceived = 0;
var opsSent = 0;

// run node server
var app = express();
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

app.get('/', function(req, res) {
  res.send('ok');
});


app.post('/create', function(req, res) {
  var document = {
    id: uuid.v4(),
    data: 'Hello World',
    ops: [],
    opsMap: {},
    updates: [],
    context: null
  };

  saveDocument(document, function() {
    res.status(200);
    res.send(JSON.stringify({document: document}));
  });
});

app.post('/document/:id', function(req, res) {
  var documentId = req.params.id;

  getDocument(documentId, function(document) {
    res.status(200);
    res.send(JSON.stringify({
      siteId: uuid.v1(),
      document: document
    }));
  });
});

app.post('/commit', function(req, res) {
  var documentId = req.body.documentId;
  var packageIndex = req.body.packageIndex;
  var ops = req.body.ops;

  requestReceived++;
  if (ops.length) requestWithDataReceived++;

  if (requestReceived % 50 == 0) {
    res.status(500);
    res.send('error');
  } else {

    opsReceived += ops.length;

    getDocument(documentId, function(document) {
      try {
        applyOps(document, ops);
      } catch (e) {
        console.log('----------------------------------------------------------------------');
        console.log('Failed to apply updates', ops);
        console.log(e);
        console.log('----------------------------------------------------------------------');
      }


      try {
        var returnOps = searchForOps(document, packageIndex);
      } catch (e) {
        console.log('----------------------------------------------------------------------');
        console.log('Failed to find updates');
        console.log(e);
        console.log('----------------------------------------------------------------------');
      }
      opsSent += returnOps.length;

      var result = {ops: returnOps};
      res.status(200);
      res.send(JSON.stringify(result));
    });
  }
});



app.post('/stat', function(req, res) {
  var documentId = req.body.documentId;
  getDocument(documentId, function(document) {
    var status = {
      // server stat
      requestReceived: requestReceived,
      requestWithDataReceived: requestWithDataReceived,
      opsReceived: opsReceived,
      opsSent: opsSent,

      // document stat
      opsStored: document.ops.length,
      idsStored: Object.keys(document.opsMap).length,
      updatesStored: document.updates.length,
      documentData: document.data
    };
    res.status(200);
    res.send(JSON.stringify(status));
  });
});

// region ---- working with document ops
function applyOps(documentData, ops) {
  var document = new cljs.Document(
      cljs.ops.string.transform,
      cljs.ops.string.invert,
      documentData.id,
      documentData.context);
  document.update(documentData.updates);

  for (var i = 0, count = ops.length; i < count; i++) {
    var op = ops[i];
    if (!documentData.opsMap[op.id]) {
      var tuple = document.update(op.updates);
      var context = document.getContext(documentData.id);

      documentData.opsMap[op.id] = op;
      documentData.ops.push(op);
      documentData.updates.push(op.updates[0]);
      documentData.data = cljs.ops.string.exec(documentData.data, tuple.toExec);
      documentData.context = context;
    }
  }
}

function searchForOps(document, packageIndex) {
  var endIndex = (document.ops.length - packageIndex > 200) ?
      (packageIndex + 200) :
      document.ops.length;
  return document.ops.slice(packageIndex, endIndex);
}
// endregion


// region ---- working with in-memory DB (rework it with any DB you like)
function saveDocument(document, callback) {
  storage[document.id] = document;
  callback();
}


function updateDocument(document, callback) {
  storage[document.id] = document;
  callback();
}

function getDocument(id, callback) {
  callback(storage[id]);
}
// endregion


app.listen(3000, function() {
  console.log('Example app listening on port ' + 3000 + '!');
});