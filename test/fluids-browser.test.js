"use strict";

var http = require("http");
var fs = require("fs");
var path = require("path");
var assert = require("assert");
var puppeteer;
try {
  puppeteer = require("/tmp/fluids-test/node_modules/puppeteer-core");
} catch (e) {
  try { puppeteer = require("puppeteer-core"); } catch (e2) {
    console.log("skip - puppeteer-core not installed (unit tests in fluids-clinic-log.test.js still run)");
    process.exit(0);
  }
}

var ROOT = path.join(__dirname, "..");
var GS_SRC = fs.readFileSync(path.join(ROOT, "apps-script/fluid-log.gs"), "utf8");
var vm = require("vm");

function loadGs() {
  var sandbox = {
    console: console, Date: Date, JSON: JSON, Math: Math, Number: Number,
    String: String, Boolean: Boolean, Array: Array, Object: Object,
    isFinite: isFinite, parseInt: parseInt
  };
  vm.createContext(sandbox);
  vm.runInContext(GS_SRC, sandbox);
  return sandbox;
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".woff2")) return "font/woff2";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".jpg") || file.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function startStatic() {
  var server = http.createServer(function (req, res) {
    var urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    if (urlPath.slice(-1) === "/") urlPath += "index.html";
    var file = path.normalize(path.join(ROOT, urlPath));
    if (file.indexOf(ROOT) !== 0) {
      res.writeHead(403); res.end(); return;
    }
    fs.readFile(file, function (err, data) {
      if (err) { res.writeHead(404); res.end("not found"); return; }
      res.writeHead(200, { "Content-Type": contentType(file) });
      res.end(data);
    });
  });
  return new Promise(function (resolve) {
    server.listen(0, "127.0.0.1", function () {
      resolve({ server: server, origin: "http://127.0.0.1:" + server.address().port });
    });
  });
}

function startMock(gs) {
  var state = { rows: [], posts: [] };
  var server = http.createServer(function (req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    if (req.method === "GET" && req.url.indexOf("/records") === 0) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ rows: state.rows, posts: state.posts }));
      return;
    }
    if (req.method === "POST") {
      var body = "";
      req.on("data", function (c) { body += c; });
      req.on("end", function () {
        state.posts.push(body);
        var rec = gs.parsePostedRecord(body);
        var result = gs.applyLogWrite(state.rows, rec, new Date().toISOString());
        state.rows = result.rows;
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(result.action);
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  return new Promise(function (resolve) {
    server.listen(0, "127.0.0.1", function () {
      resolve({
        server: server,
        state: state,
        url: "http://127.0.0.1:" + server.address().port + "/"
      });
    });
  });
}

function ticksWith(n) {
  var t = [];
  for (var i = 0; i < 15; i++) t.push(i < n);
  return t;
}

(async function () {
  var gs = loadGs();
  var site = await startStatic();
  var mock = await startMock(gs);
  var browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--window-size=390,844"]
  });
  var failed = 0;
  async function check(name, fn) {
    try {
      await fn();
      console.log("ok - " + name);
    } catch (err) {
      failed += 1;
      console.error("not ok - " + name);
      console.error(err && err.stack ? err.stack : err);
    }
  }

  var page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 });
  await page.goto(site.origin + "/jaw-surgery-journey/fluids/", { waitUntil: "networkidle0" });
  await page.evaluate(function (url) { window.ENDPOINT_URL = url; }, mock.url);

  await check("name prompt is required on first use", async function () {
    var ask = await page.$eval("[data-fluid-who-card]", function (el) { return !el.hidden; });
    assert.strictEqual(ask, true);
    var disabled = await page.$eval("[data-syringe='0']", function (el) { return el.disabled; });
    assert.strictEqual(disabled, true);
  });

  await check("rejects a full last name in the live form", async function () {
    await page.evaluate(function () {
      document.querySelector("[data-fluid-name]").value = "Sarah Kang";
      document.querySelector("[data-fluid-who-save]").click();
    });
    var err = await page.$eval("[data-fluid-who-error]", function (el) {
      return { hidden: el.hidden, text: el.textContent };
    });
    assert.strictEqual(err.hidden, false);
    assert.ok(/last initial/i.test(err.text));
    var stillAsking = await page.$eval("[data-fluid-who-card]", function (el) { return !el.hidden; });
    assert.strictEqual(stillAsking, true);
  });

  await check("saves First name and last initial plus optional surgery date", async function () {
    await page.evaluate(function () {
      document.querySelector("[data-fluid-name]").value = "Sarah K.";
      document.querySelector("[data-fluid-surgery]").value = "2026-11-12";
      document.querySelector("[data-fluid-who-save]").click();
    });
    var debug = await page.evaluate(function () {
      return {
        cardHidden: document.querySelector("[data-fluid-who-card]").hidden,
        whoHidden: document.querySelector("[data-fluid-who]").hidden,
        error: document.querySelector("[data-fluid-who-error]").textContent,
        label: document.querySelector("[data-fluid-who-label]").textContent,
        stored: localStorage.getItem("oms-jaw-fluids-patient")
      };
    });
    assert.strictEqual(debug.cardHidden, true, JSON.stringify(debug));
    assert.strictEqual(debug.whoHidden, false, JSON.stringify(debug));
    assert.ok(/Sarah K\./.test(debug.label), JSON.stringify(debug));
    assert.ok(/2026-11-12/.test(debug.label), JSON.stringify(debug));
    var change = await page.$eval("[data-fluid-who-change]", function (el) { return el.textContent.trim(); });
    assert.strictEqual(change, "Not you? Change");
  });

  await check("send today's log now posts a partial hour to the mock endpoint", async function () {
    await page.click("[data-syringe='0']");
    await page.click("[data-syringe='1']");
    await page.click("[data-syringe='2']");
    await page.click("[data-fluid-send]");
    await page.waitForFunction(function () {
      var el = document.querySelector("[data-fluid-send-status]");
      return el && el.textContent.trim() && el.textContent.indexOf("Sending") === -1;
    }, { timeout: 8000 });
    var status = await page.$eval("[data-fluid-send-status]", function (el) { return el.textContent; });
    assert.ok(/sent to the clinic/i.test(status), status);
    var data = await fetch(mock.url + "records").then(function (r) { return r.json(); });
    assert.ok(data.posts.length >= 1);
    var rec = JSON.parse(data.posts[data.posts.length - 1]);
    assert.strictEqual(rec.patient, "Sarah K.");
    assert.strictEqual(rec.syringes, 3);
    assert.strictEqual(rec.partial, true);
    assert.strictEqual(rec.surgeryDate, "2026-11-12");
  });

  await check("hour rollover posts the closed hour as complete, not twice", async function () {
    await page.evaluate(function () {
      var now = new Date();
      window.__fluidsTestNow = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 2);
      window.__fluidsApi.tick();
    });
    await page.waitForFunction(function () {
      return window.__fluidsApi && window.__fluidsApi.getQueue().length === 0;
    }, { timeout: 5000 });
    await new Promise(function (r) { setTimeout(r, 250); });
    var data = await fetch(mock.url + "records").then(function (r) { return r.json(); });
    var bodies = data.posts.map(function (p) { return JSON.parse(p); });
    var completes = bodies.filter(function (b) { return b.partial === false && b.syringes === 3; });
    assert.ok(completes.length >= 1, "expected a complete hour after rollover");
    var keys = {};
    completes.forEach(function (b) {
      var k = b.deviceId + "|" + b.date + "|" + b.hour;
      keys[k] = (keys[k] || 0) + 1;
    });
    Object.keys(keys).forEach(function (k) {
      assert.strictEqual(keys[k], 1, "complete hour posted more than once: " + k);
    });
  });

  await check("recovery stage page also has the name prompt and send button", async function () {
    var context = await browser.createBrowserContext();
    var recovery = await context.newPage();
    await recovery.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 });
    await recovery.goto(site.origin + "/jaw-surgery-journey/?stage=recovery", { waitUntil: "networkidle0" });
    var hasSend = await recovery.$("[data-fluid-send]");
    var hasAsk = await recovery.$("[data-fluid-who-card]");
    assert.ok(hasSend);
    assert.ok(hasAsk);
    var askVisible = await recovery.$eval("[data-fluid-who-card]", function (el) { return !el.hidden; });
    assert.strictEqual(askVisible, true);
    var sendLabel = await recovery.$eval("[data-fluid-send]", function (el) { return el.textContent.trim(); });
    assert.strictEqual(sendLabel, "Send today's log now");
    await context.close();
  });

  await browser.close();
  site.server.close();
  mock.server.close();
  if (failed) {
    console.error("\n" + failed + " failed");
    process.exit(1);
  }
  console.log("\nbrowser tests passed");
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
