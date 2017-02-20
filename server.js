var express = require('express');
var bodyParser = require('body-parser');
var uuid = require('uuid');

// memory storage
var storage = {};

// stat
var requestReceived = 0;
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

  if (requestReceived % 50 == 0) {
    res.status(500);
    res.send('error');
  }

  opsReceived += ops.length;

  getDocument(documentId, function(document) {
    applyOps(document, ops);

    var returnOps = searchForOps(document, packageIndex);
    opsSent += returnOps.length;

    var result = {ops: returnOps};
    res.status(200);
    res.send(JSON.stringify(result));
  });
});



app.post('/stat', function(req, res) {
  var documentId = req.body.documentId;
  getDocument(documentId, function(document) {
    var status = {
      // server stat
      requestReceived: requestReceived,
      opsReceived: opsReceived,
      opsSent: opsSent,

      // document stat
      opsStored: document.ops.length,
      idsStored: Object.keys(document.opsMap).length
    };
    res.status(200);
    res.send(JSON.stringify(status));
  });
});

// region ---- working with document ops
function applyOps(document, ops) {
  for (var i = 0, count = ops.length; i < count; i++) {
    var op = ops[i];
    if (!document.opsMap[op.id]) {
      document.opsMap[op.id] = op;
      document.ops.push(op);
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