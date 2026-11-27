"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");
var http = require("http");
var assert = require("assert");

var ROOT = path.join(__dirname, "..");
var FLUIDS_JS = fs.readFileSync(
  path.join(ROOT, "jaw-surgery-journey/fluids/fluids.js"),
  "utf8"
);
var GS_SRC = fs.readFileSync(path.join(ROOT, "apps-script/fluid-log.gs"), "utf8");

function memStorage() {
  var map = Object.create(null);
  return {
    getItem: function (k) {
      return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null;
    },
    setItem: function (k, v) {
      map[String(k)] = String(v);
    },
    removeItem: function (k) {
      delete map[k];
    },
    clear: function () {
      map = Object.create(null);
    },
    key: function (i) {
      return Object.keys(map)[i] || null;
    },
    get length() {
      return Object.keys(map).length;
    }
  };
}

function loadGs() {
  var sandbox = {
    console: console,
    Date: Date,
    JSON: JSON,
    Math: Math,
    Number: Number,
    String: String,
    Boolean: Boolean,
    Array: Array,
    Object: Object,
    isFinite: isFinite,
    parseInt: parseInt,
    Utilities: {
      formatDate: function (d) {
        var pad = function (n) { return n < 10 ? "0" + n : String(n); };
        return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
      }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(GS_SRC, sandbox);
  return sandbox;
}

function loadClient(opts) {
  opts = opts || {};
  var ls = memStorage();
  var fetchCalls = [];
  var offline = !!opts.offline;
  var sandbox = {
    document: {
      readyState: "complete",
      querySelectorAll: function () { return []; },
      addEventListener: function () {}
    },
    localStorage: ls,
    ENDPOINT_URL: opts.endpoint || "",
    crypto: require("crypto").webcrypto,
    console: console,
    Date: Date,
    JSON: JSON,
    Math: Math,
    Number: Number,
    String: String,
    Boolean: Boolean,
    Array: Array,
    Object: Object,
    Error: Error,
    TypeError: TypeError,
    Promise: Promise,
    parseInt: parseInt,
    isFinite: isFinite,
    setInterval: function () { return 0; },
    clearInterval: function () {},
    addEventListener: function () {},
    __fluidsTestNow: opts.now || null
  };
  sandbox.window = sandbox;
  sandbox.fetch = function (url, init) {
    fetchCalls.push({ url: url, init: init });
    if (offline) return Promise.reject(new TypeError("Failed to fetch"));
    if (opts.fetchImpl) return opts.fetchImpl(url, init);
    return Promise.resolve({ ok: true });
  };
  vm.createContext(sandbox);
  vm.runInContext(FLUIDS_JS, sandbox);
  return {
    api: sandbox.__fluidsApi,
    sandbox: sandbox,
    ls: ls,
    fetchCalls: fetchCalls,
    setOffline: function (v) { offline = v; },
    setEndpoint: function (url) { sandbox.ENDPOINT_URL = url; }
  };
}

function ticksWith(n) {
  var t = [];
  var i;
  for (i = 0; i < 15; i++) t.push(i < n);
  return t;
}

function startMock(gs) {
  var state = { rows: [], posts: [] };
  var server = http.createServer(function (req, res) {
    if (req.method === "GET" && req.url.indexOf("/records") === 0) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ rows: state.rows, posts: state.posts }));
      return;
    }
    if (req.method === "POST") {
      var body = "";
      req.on("data", function (c) { body += c; });
      req.on("end", function () {
        state.posts.push({ type: req.headers["content-type"] || "", body: body });
        var rec = gs.parsePostedRecord(body);
        var result = gs.applyLogWrite(state.rows, rec, new Date().toISOString());
        state.rows = result.rows;
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(result.action);
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise(function (resolve) {
    server.listen(0, "127.0.0.1", function () {
      var url = "http://127.0.0.1:" + server.address().port + "/";
      resolve({ server: server, state: state, url: url });
    });
  });
}

var tests = [];
function test(name, fn) {
  tests.push({ name: name, fn: fn });
}

test("name format accepts Sarah K. and rejects full last names and PHI", function () {
  var c = loadClient();
  var ok = c.api.normalizePatientLabel("Sarah K.");
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.label, "Sarah K.");
  assert.strictEqual(c.api.normalizePatientLabel("sarah k").label, "Sarah K.");
  assert.strictEqual(c.api.normalizePatientLabel("Sarah Kang").ok, false);
  assert.strictEqual(c.api.normalizePatientLabel("Sarah").ok, false);
  assert.strictEqual(c.api.normalizePatientLabel("sarah.k@clinic.com").ok, false);
  assert.strictEqual(c.api.normalizePatientLabel("604-371-0578").ok, false);
  assert.strictEqual(c.api.normalizePatientLabel("1234567890").ok, false);
  assert.strictEqual(c.api.normalizePatientLabel("2010-01-01").ok, false);
  assert.strictEqual(c.api.normalizeSurgeryDate("").ok, true);
  assert.strictEqual(c.api.normalizeSurgeryDate("2026-11-01").ok, true);
  assert.strictEqual(c.api.normalizeSurgeryDate("2026-13-40").ok, false);
});

test("empty ENDPOINT_URL skips fetch but still queues", function () {
  var now = new Date(2026, 10, 27, 14, 10, 0);
  var c = loadClient({ now: now, endpoint: "" });
  c.api.savePatient("Sarah K.", "2026-11-01");
  c.api.enqueueHour("2026-11-27", 13, 12, false);
  return c.api.flushQueue().then(function (res) {
    assert.strictEqual(res.skipped, true);
    assert.strictEqual(c.fetchCalls.length, 0);
    assert.strictEqual(c.api.getQueue().length, 1);
  });
});

test("queues a closed hour and POSTs once with no-cors text/plain", function () {
  var now = new Date(2026, 10, 27, 14, 5, 0);
  var c = loadClient({ now: now, endpoint: "https://script.google.com/macros/s/test/exec" });
  c.api.savePatient("Sarah K.", "2026-11-01");
  c.api.enqueueHour("2026-11-27", 13, 12, false);
  return c.api.flushQueue().then(function (res) {
    assert.strictEqual(res.sent, 1);
    assert.strictEqual(c.fetchCalls.length, 1);
    var call = c.fetchCalls[0];
    assert.strictEqual(call.init.mode, "no-cors");
    assert.strictEqual(call.init.headers["Content-Type"], "text/plain");
    var body = JSON.parse(call.init.body);
    assert.strictEqual(body.patient, "Sarah K.");
    assert.strictEqual(body.surgeryDate, "2026-11-01");
    assert.strictEqual(body.date, "2026-11-27");
    assert.strictEqual(body.hour, 13);
    assert.strictEqual(body.syringes, 12);
    assert.strictEqual(body.partial, false);
    assert.ok(body.deviceId);
    assert.strictEqual(c.api.getQueue().length, 0);
    return c.api.flushQueue();
  }).then(function () {
    assert.strictEqual(c.fetchCalls.length, 1, "complete hour must not be sent twice");
  });
});

test("offline hours stay queued and retry once back online", function () {
  var now = new Date(2026, 10, 27, 15, 0, 0);
  var c = loadClient({ now: now, endpoint: "https://example.test/exec", offline: true });
  c.api.savePatient("Sam T.", "");
  c.api.enqueueHour("2026-11-27", 14, 8, false);
  return c.api.flushQueue().then(function (res) {
    assert.ok(res.failed >= 1);
    assert.strictEqual(c.api.getQueue().length, 1);
    c.setOffline(false);
    return c.api.flushQueue();
  }).then(function (res) {
    assert.strictEqual(res.sent, 1);
    assert.strictEqual(c.api.getQueue().length, 0);
    assert.strictEqual(c.fetchCalls.length, 2);
  });
});

test("send today's log now marks the current hour partial", function () {
  var now = new Date(2026, 10, 27, 16, 20, 0);
  var c = loadClient({ now: now, endpoint: "https://example.test/exec" });
  c.api.savePatient("Sarah K.", "");
  c.ls.setItem(c.api.HOUR_PREFIX + "2026-11-27-16", JSON.stringify(ticksWith(4)));
  return c.api.sendTodayNow().then(function (res) {
    assert.strictEqual(res.sent, 1);
    var body = JSON.parse(c.fetchCalls[0].init.body);
    assert.strictEqual(body.hour, 16);
    assert.strictEqual(body.syringes, 4);
    assert.strictEqual(body.partial, true);
    return c.api.sendTodayNow();
  }).then(function () {
    assert.strictEqual(c.fetchCalls.length, 1, "identical partial must not be sent twice");
    c.ls.setItem(c.api.HOUR_PREFIX + "2026-11-27-16", JSON.stringify(ticksWith(6)));
    return c.api.sendTodayNow();
  }).then(function () {
    assert.strictEqual(c.fetchCalls.length, 2, "new syringe count may update the partial");
    assert.strictEqual(JSON.parse(c.fetchCalls[1].init.body).syringes, 6);
  });
});

test("rollover and next-open send past hours that were not yet sent", function () {
  var c = loadClient({
    now: new Date(2026, 10, 27, 14, 0, 5),
    endpoint: "https://example.test/exec"
  });
  c.api.savePatient("Sarah K.", "");
  c.ls.setItem(c.api.HOUR_PREFIX + "2026-11-27-12", JSON.stringify(ticksWith(15)));
  c.ls.setItem(c.api.HOUR_PREFIX + "2026-11-27-13", JSON.stringify(ticksWith(9)));
  c.ls.setItem(c.api.HOUR_PREFIX + "2026-11-27-14", JSON.stringify(ticksWith(2)));
  c.api.syncUnsentHours(new Date(2026, 10, 27, 14, 0, 5));
  var queued = c.api.getQueue().slice().sort(function (a, b) { return a.hour - b.hour; });
  assert.strictEqual(queued.length, 2);
  assert.strictEqual(queued[0].hour, 12);
  assert.strictEqual(queued[0].syringes, 15);
  assert.strictEqual(queued[0].partial, false);
  assert.strictEqual(queued[1].hour, 13);
  assert.strictEqual(queued[1].syringes, 9);
  return c.api.flushQueue().then(function (res) {
    assert.strictEqual(res.sent, 2);
    c.api.syncUnsentHours(new Date(2026, 10, 27, 14, 0, 5));
    return c.api.flushQueue();
  }).then(function () {
    assert.strictEqual(c.fetchCalls.length, 2, "past hours must not be sent twice after catch-up");
  });
});

test("mock endpoint dedupes device+date+hour and updates a partial", function () {
  var gs = loadGs();
  return startMock(gs).then(function (mock) {
    var c = loadClient({
      now: new Date(2026, 10, 27, 18, 10, 0),
      endpoint: mock.url,
      fetchImpl: function (url, init) {
        return fetch(url, {
          method: init.method,
          headers: init.headers,
          body: init.body
        });
      }
    });
    c.api.savePatient("Sarah K.", "2026-11-12");
    c.ls.setItem(c.api.HOUR_PREFIX + "2026-11-27-18", JSON.stringify(ticksWith(3)));
    return c.api.sendTodayNow()
      .then(function () { return c.api.sendTodayNow(); })
      .then(function () {
        c.ls.setItem(c.api.HOUR_PREFIX + "2026-11-27-18", JSON.stringify(ticksWith(15)));
        c.sandbox.__fluidsTestNow = new Date(2026, 10, 27, 19, 0, 1);
        c.api.syncUnsentHours(new Date(2026, 10, 27, 19, 0, 1));
        return c.api.flushQueue();
      })
      .then(function () {
        var dataRows = mock.state.rows.filter(function (row) {
          return row && row.length;
        });
        assert.strictEqual(dataRows.length, 1);
        assert.strictEqual(dataRows[0][1], "Sarah K.");
        assert.strictEqual(dataRows[0][4], 18);
        assert.strictEqual(dataRows[0][5], 15);
        assert.strictEqual(dataRows[0][6], "no");
        mock.server.close();
      })
      .catch(function (err) {
        mock.server.close();
        throw err;
      });
  });
});

test("Apps Script daily summary flags hours under 10 and counts 15/15", function () {
  var gs = loadGs();
  var recs = [
    gs.parsePostedRecord(JSON.stringify({
      patient: "Sarah K.", surgeryDate: "2026-11-01", date: "2026-11-27",
      hour: 8, syringes: 15, partial: false, deviceId: "dev-1"
    })),
    gs.parsePostedRecord(JSON.stringify({
      patient: "Sarah K.", surgeryDate: "2026-11-01", date: "2026-11-27",
      hour: 9, syringes: 6, partial: false, deviceId: "dev-1"
    })),
    gs.parsePostedRecord(JSON.stringify({
      patient: "Sarah K.", surgeryDate: "2026-11-01", date: "2026-11-27",
      hour: 10, syringes: 15, partial: false, deviceId: "dev-1"
    }))
  ];
  var summary = gs.summarizePatient(recs);
  assert.strictEqual(summary.hoursLogged, 3);
  assert.strictEqual(summary.hoursAt15, 2);
  assert.strictEqual(summary.totalSyringes, 36);
  assert.strictEqual(summary.under10.length, 1);
  assert.strictEqual(summary.under10[0].hour, 9);
  var body = gs.formatPatientEmail(summary, gs.formatDateLabel("2026-11-27"));
  assert.ok(body.indexOf("Hours logged: 3") !== -1);
  assert.ok(body.indexOf("Hours at 15/15: 2") !== -1);
  assert.ok(body.indexOf("Total syringes: 36") !== -1);
  assert.ok(/9:00 AM \(6\/15\)/.test(body));
  var groups = gs.groupRowsByDevice(recs.concat([
    gs.parsePostedRecord(JSON.stringify({
      patient: "Sam T.", surgeryDate: "", date: "2026-11-27",
      hour: 11, syringes: 15, partial: false, deviceId: "dev-2"
    }))
  ]), "2026-11-27");
  assert.strictEqual(Object.keys(groups).length, 2);
});

test("Apps Script decideLogWrite never duplicates a complete hour", function () {
  var gs = loadGs();
  var rec = gs.parsePostedRecord(JSON.stringify({
    patient: "Sarah K.", surgeryDate: "", date: "2026-11-27",
    hour: 7, syringes: 4, partial: true, deviceId: "abc"
  }));
  var rows = [];
  rows = gs.applyLogWrite(rows, rec, "t1").rows;
  rec.syringes = 4;
  rows = gs.applyLogWrite(rows, rec, "t2").rows;
  assert.strictEqual(rows.length, 1);
  rec.partial = false;
  rec.syringes = 11;
  rows = gs.applyLogWrite(rows, rec, "t3").rows;
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0][5], 11);
  assert.strictEqual(rows[0][6], "no");
  rec.syringes = 15;
  var result = gs.applyLogWrite(rows, rec, "t4");
  assert.strictEqual(result.action, "skip");
  assert.strictEqual(result.rows[0][5], 11);
});

var i = 0;
function runNext() {
  if (i >= tests.length) {
    if (failed) {
      console.error("\n" + failed + " failed");
      process.exit(1);
    }
    console.log("\n" + tests.length + " passed");
    return;
  }
  var t = tests[i++];
  Promise.resolve()
    .then(t.fn)
    .then(function () {
      console.log("ok - " + t.name);
      runNext();
    })
    .catch(function (err) {
      failed += 1;
      console.error("not ok - " + t.name);
      console.error(err && err.stack ? err.stack : err);
      runNext();
    });
}

var failed = 0;
runNext();
