var express = require('express');
var bodyParser = require('body-parser');

// memory storage
var storage = [];
var storageMap = {};

// stat
var requestReceived = 0;
var updatesReceived = 0;

// run node server
var app = express();
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

app.post('/commit', function(req, res) {
  var items = req.body.items;

  requestReceived++;
  updatesReceived += items.length;

  for (var i = 0, count = items.length; i < count; i++) {
    var item = items[i];
    if (!storageMap[item.uuid]) {
      storageMap[item.uuid] = item;
      storage.push(item);
    }
  }

  res.status(200);
  res.send('ok');
});


app.post('/status', function(req, res) {
  var status = {
    requestReceived: requestReceived,
    updatesReceived: updatesReceived,
    updatesStored: storage.length,
    uuidsStored: Object.keys(storageMap).length
  };
  res.status(200);
  res.send(JSON.stringify(status));
});


app.listen(3000, function() {
  console.log('Example app listening on port ' + 3000 + '!');
});