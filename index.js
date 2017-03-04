var fs = require('fs');

var minOpsCount = 10;
var maxOpsCount = 50;
var incOpsCount = 10;
var sessionsPerStep = 2;

var timeout = 1000 * 60 * 5;
var timeoutId = NaN;

var totalSessionCount = ((maxOpsCount - minOpsCount) / incOpsCount + 1) * sessionsPerStep;
var index = 0;


checkResultsDirExists();
cycle();


function cycle() {
  index++;
  var opsCount = Math.round(index / sessionsPerStep) * incOpsCount;

  if (index - 1 < totalSessionCount) {
    runNextTest(opsCount);
  } else {
    process.exit(0);
  }
}

function runNextTest(opsCount) {
  var sessionResult = '';
  var test = require('child_process').fork('test.js', [opsCount, true], {silent: true});
  test.stdout.setEncoding('utf8');
  test.stderr.setEncoding('utf8');
  test.stdout.on('data', function(data) {
    sessionResult += data + '\n';
  });

  test.stderr.on('data', function(data) {
    sessionResult += data + '\n';
    console.log(data);
  });

  test.on('close', function(code) {
    var path = __dirname + '/results/' + getFileName(index, code, opsCount);
    fs.writeFileSync(path, sessionResult);
    cycle();
  });

  timeoutId = setTimeout(function() {
    clearTimeout(timeoutId);
    test.kill();
    cycle();
  }, timeout);

  return test;
}



function getFileName(index, code, opsCount) {
  var result = code ? 'FAILED' : 'SUCCESS';
  return 'session #' + index + ' - ' + result + ', ops count: ' + opsCount + '.txt';
}

function checkResultsDirExists() {
  var dir = __dirname + '/results';

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }
}


