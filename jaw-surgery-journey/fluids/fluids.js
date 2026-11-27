(function (global) {
  "use strict";
  var GOAL = 15;
  var HOUR_PREFIX = "oms-jaw-fluids-hour:";
  var DAY_PREFIX = "oms-jaw-fluids-day:";
  var PATIENT_KEY = "oms-jaw-fluids-patient";
  var DEVICE_KEY = "oms-jaw-fluids-device";
  var QUEUE_KEY = "oms-jaw-fluids-queue";
  var SENT_KEY = "oms-jaw-fluids-sent";
  var LAST_PARTIAL_KEY = "oms-jaw-fluids-last-partial";

  var SYRINGE_SVG =
    '<svg viewBox="0 0 24 40" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      '<rect class="barrel-fill" x="8.15" y="9.15" width="7.7" height="20.7" rx="1.1"></rect>' +
      '<path d="M8 2.5h8"/>' +
      '<path d="M9.5 2.5v3.2h5V2.5"/>' +
      '<path d="M12 5.7v3.4"/>' +
      '<rect x="7.5" y="8.6" width="9" height="21.6" rx="1.3"/>' +
      '<path d="M7.5 11.6h9"/>' +
      '<path d="M9.2 15.2h3.2M9.2 18.6h3.2M9.2 22h3.2M9.2 25.4h2.2"/>' +
      '<path d="M10.4 30.2h3.2v2.2h-3.2z"/>' +
      '<path d="M12 32.4v5.2"/>' +
    "</svg>";

  var tickers = [];
  var flushing = null;
  var flushAgain = false;

  function nowDate() {
    if (global.__fluidsTestNow != null) return new Date(global.__fluidsTestNow);
    return new Date();
  }

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function ymd(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function hourKey(d) {
    return ymd(d) + "-" + pad(d.getHours());
  }

  function nextHour(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1, 0, 0, 0);
  }

  function loadJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function saveJSON(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {}
  }

  function emptyTicks() {
    var ticks = [];
    var i;
    for (i = 0; i < GOAL; i++) ticks.push(false);
    return ticks;
  }

  function loadTicks(d) {
    return ticksFromStored(loadJSON(HOUR_PREFIX + hourKey(d), null));
  }

  function ticksFromStored(ticks) {
    if (!ticks || !ticks.length) return emptyTicks();
    var out = [];
    var i;
    for (i = 0; i < GOAL; i++) out.push(!!ticks[i]);
    return out;
  }

  function saveTicks(d, ticks) {
    saveJSON(HOUR_PREFIX + hourKey(d), ticks);
  }

  function loadToday(d) {
    var hours = loadJSON(DAY_PREFIX + ymd(d), []);
    if (!Array.isArray(hours)) return [];
    return hours.filter(function (h) {
      return typeof h === "number" && h >= 0 && h <= 23;
    });
  }

  function saveToday(d, hours) {
    saveJSON(DAY_PREFIX + ymd(d), hours);
  }

  function filledCount(ticks) {
    var n = 0;
    var i;
    for (i = 0; i < ticks.length; i++) if (ticks[i]) n++;
    return n;
  }

  function parseHourKey(suffix) {
    var m = String(suffix || "").match(/^(\d{4}-\d{2}-\d{2})-(\d{2})$/);
    if (!m) return null;
    var hour = parseInt(m[2], 10);
    if (hour < 0 || hour > 23) return null;
    return { date: m[1], hour: hour };
  }

  function endpointUrl() {
    var u = global.ENDPOINT_URL;
    if (u == null) return "";
    return String(u).trim();
  }

  function hexByte(n) {
    var s = (n & 255).toString(16);
    return s.length === 1 ? "0" + s : s;
  }

  function newDeviceId() {
    try {
      if (global.crypto && typeof global.crypto.randomUUID === "function") {
        return global.crypto.randomUUID();
      }
    } catch (e) {}
    var bytes = [];
    var i;
    for (i = 0; i < 16; i++) bytes.push((Math.random() * 256) | 0);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = [];
    for (i = 0; i < bytes.length; i++) hex.push(hexByte(bytes[i]));
    return (
      hex.slice(0, 4).join("") + "-" +
      hex.slice(4, 6).join("") + "-" +
      hex.slice(6, 8).join("") + "-" +
      hex.slice(8, 10).join("") + "-" +
      hex.slice(10, 16).join("")
    );
  }

  function getDeviceId() {
    try {
      var id = localStorage.getItem(DEVICE_KEY);
      if (id && id.length >= 8) return id;
      id = newDeviceId();
      localStorage.setItem(DEVICE_KEY, id);
      return id;
    } catch (e) {
      return newDeviceId();
    }
  }

  function normalizePatientLabel(raw) {
    var s = String(raw || "").trim().replace(/\s+/g, " ");
    if (!s) return { ok: false, error: "Enter your first name and last initial, like Sarah K." };
    if (/@/.test(s) || /https?:/i.test(s)) {
      return { ok: false, error: "Do not enter an email or website. Use a name like Sarah K." };
    }
    var chart = "";
    var hash = s.indexOf("#");
    if (hash !== -1) {
      var chartRaw = s.slice(hash + 1).trim();
      s = s.slice(0, hash).trim().replace(/\s+/g, " ");
      if (global.FluidsLink && typeof global.FluidsLink.normalizeChart === "function") {
        var chartRes = global.FluidsLink.normalizeChart(chartRaw);
        if (!chartRes.ok) return chartRes;
        chart = chartRes.chart;
      } else if (chartRaw) {
        if (!/^\d{1,9}$/.test(chartRaw) || chartRaw.length === 10) {
          return { ok: false, error: "Do not enter a PHN or phone. Chart # is optional and shorter than 10 digits." };
        }
        chart = chartRaw;
      }
    }
    if (/[0-9]/.test(s)) {
      return { ok: false, error: "Do not enter numbers, a PHN, birthdate, or phone. Use a name like Sarah K." };
    }
    var parts = s.split(" ");
    if (parts.length !== 2) {
      return { ok: false, error: "Use your first name and last initial only, like Sarah K." };
    }
    var first = parts[0];
    var last = parts[1];
    if (!/^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'’-]*$/.test(first) || first.length < 2 || first.length > 30) {
      return { ok: false, error: "Use your first name and last initial only, like Sarah K." };
    }
    var initialMatch = last.match(/^([A-Za-zÀ-ÖØ-öø-ÿ])\.?$/);
    if (!initialMatch) {
      return { ok: false, error: "Use a last initial only — one letter, like K. Do not enter a full last name." };
    }
    if (first.slice(1) === first.slice(1).toUpperCase()) {
      first = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
    } else {
      first = first.charAt(0).toUpperCase() + first.slice(1);
    }
    var label = first + " " + initialMatch[1].toUpperCase() + ".";
    if (chart) label += " #" + chart;
    return { ok: true, label: label, chart: chart };
  }

  function normalizeSurgeryDate(raw) {
    var s = String(raw || "").trim();
    if (!s) return { ok: true, date: "" };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return { ok: false, error: "Use the date picker for surgery date, or leave it blank." };
    }
    var p = s.split("-");
    var dt = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    if (dt.getFullYear() !== Number(p[0]) || dt.getMonth() + 1 !== Number(p[1]) || dt.getDate() !== Number(p[2])) {
      return { ok: false, error: "That surgery date is not a real day. Leave it blank if you are not sure." };
    }
    return { ok: true, date: s };
  }

  function getPatient() {
    var v = loadJSON(PATIENT_KEY, null);
    if (!v || typeof v !== "object") return { label: "", surgeryDate: "" };
    return {
      label: typeof v.label === "string" ? v.label : "",
      surgeryDate: typeof v.surgeryDate === "string" ? v.surgeryDate : ""
    };
  }

  function savePatient(label, surgeryDate) {
    saveJSON(PATIENT_KEY, { label: label, surgeryDate: surgeryDate || "" });
    var q = loadQueue();
    var i;
    for (i = 0; i < q.length; i++) {
      q[i].patient = label;
      q[i].surgeryDate = surgeryDate || "";
    }
    saveQueue(q);
  }

  function clearPatient() {
    try { localStorage.removeItem(PATIENT_KEY); } catch (e) {}
  }

  function dropPatientQuery() {
    try {
      if (!global.location || !global.history || !global.history.replaceState) return;
      var search = global.location.search || "";
      if (!/[?&]p=/.test(search)) return;
      var kept = [];
      search.replace(/^\?/, "").split("&").forEach(function (part) {
        if (!part) return;
        var key = part.split("=")[0];
        try {
          if (decodeURIComponent(key.replace(/\+/g, " ")) === "p") return;
        } catch (e) {}
        kept.push(part);
      });
      var next = global.location.pathname + (kept.length ? "?" + kept.join("&") : "") + (global.location.hash || "");
      global.history.replaceState(null, "", next);
    } catch (e) {}
  }

  function applyPatientFromQuery() {
    var api = global.FluidsLink;
    if (!api || typeof api.parseCode !== "function" || typeof api.queryParam !== "function") return;
    var raw = api.queryParam("p");
    if (!raw) return;
    var parsed = api.parseCode(raw);
    if (!parsed.ok) return;
    var cur = getPatient();
    if (cur.label !== parsed.label) savePatient(parsed.label, cur.surgeryDate);
  }

  function loadQueue() {
    var q = loadJSON(QUEUE_KEY, []);
    return Array.isArray(q) ? q : [];
  }

  function saveQueue(q) {
    saveJSON(QUEUE_KEY, q);
  }

  function loadSent() {
    var s = loadJSON(SENT_KEY, {});
    return s && typeof s === "object" && !Array.isArray(s) ? s : {};
  }

  function markSent(rec) {
    var s = loadSent();
    s[recordKey(rec)] = true;
    saveJSON(SENT_KEY, s);
  }

  function wasSent(rec) {
    return !!loadSent()[recordKey(rec)];
  }

  function loadLastPartial() {
    var s = loadJSON(LAST_PARTIAL_KEY, {});
    return s && typeof s === "object" && !Array.isArray(s) ? s : {};
  }

  function rememberPartial(rec) {
    var s = loadLastPartial();
    s[String(rec.date) + "|" + String(rec.hour)] = rec.syringes;
    saveJSON(LAST_PARTIAL_KEY, s);
  }

  function alreadySentPartial(rec) {
    if (!rec || !rec.partial) return false;
    return loadLastPartial()[String(rec.date) + "|" + String(rec.hour)] === rec.syringes;
  }

  function recordKey(rec) {
    return String(rec.deviceId || "") + "|" + String(rec.date || "") + "|" + String(rec.hour);
  }

  function hourRecord(dateStr, hour, syringes, partial) {
    var patient = getPatient();
    var n = syringes;
    if (typeof n !== "number" || n < 0) n = 0;
    if (n > GOAL) n = GOAL;
    n = Math.round(n);
    return {
      patient: patient.label || "",
      surgeryDate: patient.surgeryDate || "",
      date: dateStr,
      hour: hour,
      syringes: n,
      partial: !!partial,
      deviceId: getDeviceId()
    };
  }

  function upsertQueue(rec) {
    if (!rec || rec.hour == null || !rec.date) return false;
    if (wasSent(rec)) return false;
    if (alreadySentPartial(rec)) return false;
    var q = loadQueue();
    var key = rec.date + "|" + rec.hour;
    var i;
    var found = false;
    for (i = 0; i < q.length; i++) {
      if (String(q[i].date) + "|" + String(q[i].hour) === key) {
        if (!q[i].partial && rec.partial) {
          found = true;
          break;
        }
        q[i] = rec;
        found = true;
        break;
      }
    }
    if (!found) q.push(rec);
    saveQueue(q);
    return true;
  }

  function enqueueHour(dateStr, hour, syringes, partial) {
    return upsertQueue(hourRecord(dateStr, hour, syringes, partial));
  }

  function enqueueFromDate(d, ticks, partial) {
    return enqueueHour(ymd(d), d.getHours(), filledCount(ticks), partial);
  }

  function enqueueFromStoredKey(storageKey) {
    if (!storageKey || storageKey.indexOf(HOUR_PREFIX) !== 0) return false;
    var parsed = parseHourKey(storageKey.slice(HOUR_PREFIX.length));
    if (!parsed) return false;
    var now = nowDate();
    if (parsed.date === ymd(now) && parsed.hour === now.getHours()) return false;
    var ticks = ticksFromStored(loadJSON(storageKey, null));
    return enqueueHour(parsed.date, parsed.hour, filledCount(ticks), false);
  }

  function syncUnsentHours(current) {
    var skip = hourKey(current || nowDate());
    var keys = [];
    var i, k;
    try {
      for (i = 0; i < localStorage.length; i++) {
        k = localStorage.key(i);
        if (k && k.indexOf(HOUR_PREFIX) === 0 && k !== HOUR_PREFIX + skip) keys.push(k);
      }
    } catch (e) {}
    for (i = 0; i < keys.length; i++) enqueueFromStoredKey(keys[i]);
  }

  function pruneOld(d) {
    try {
      var keepHour = HOUR_PREFIX + hourKey(d);
      var keepDay = DAY_PREFIX + ymd(d);
      var sent = loadSent();
      var queued = {};
      var q = loadQueue();
      var i, k, parsed, recKey;
      for (i = 0; i < q.length; i++) {
        queued[String(q[i].date) + "|" + String(q[i].hour)] = true;
      }
      var remove = [];
      for (i = 0; i < localStorage.length; i++) {
        k = localStorage.key(i);
        if (!k) continue;
        if (k.indexOf(DAY_PREFIX) === 0 && k !== keepDay) remove.push(k);
        if (k.indexOf(HOUR_PREFIX) === 0 && k !== keepHour) {
          parsed = parseHourKey(k.slice(HOUR_PREFIX.length));
          recKey = parsed ? getDeviceId() + "|" + parsed.date + "|" + parsed.hour : "";
          if (parsed && (sent[recKey] || queued[parsed.date + "|" + parsed.hour])) {
            remove.push(k);
          }
        }
      }
      for (i = 0; i < remove.length; i++) localStorage.removeItem(remove[i]);
    } catch (e) {}
  }

  function postRecord(rec) {
    var url = endpointUrl();
    if (!url) return Promise.resolve({ skipped: true, reason: "empty-endpoint" });
    if (!rec.patient) return Promise.resolve({ skipped: true, reason: "no-patient" });
    if (typeof global.fetch !== "function") {
      return Promise.reject(new Error("fetch-missing"));
    }
    return global.fetch(url, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(rec)
    }).then(function () {
      return { ok: true };
    });
  }

  function flushQueue() {
    if (flushing) {
      flushAgain = true;
      return flushing;
    }
    var finish;
    flushing = new Promise(function (resolve) {
      finish = resolve;
    });
    var pending = flushing;

    function done(result) {
      flushing = null;
      if (flushAgain) {
        flushAgain = false;
        finish(flushQueue().then(function () { return result; }, function () { return result; }));
        return;
      }
      finish(result);
    }

    var url = endpointUrl();
    if (!url) {
      done({ skipped: true, reason: "empty-endpoint", sent: 0 });
      return pending;
    }

    var q = loadQueue();
    var i = 0;
    var sent = 0;
    var failed = 0;

    function next() {
      if (i >= q.length) {
        done({ ok: failed === 0, sent: sent, failed: failed });
        return;
      }
      var rec = q[i];
      if (wasSent(rec) && !rec.partial) {
        q.splice(i, 1);
        saveQueue(q);
        next();
        return;
      }
      postRecord(rec).then(function (res) {
        if (res && res.skipped) {
          i += 1;
          next();
          return;
        }
        if (!rec.partial) markSent(rec);
        else rememberPartial(rec);
        q.splice(i, 1);
        saveQueue(q);
        sent += 1;
        next();
      }).catch(function () {
        failed += 1;
        i += 1;
        next();
      });
    }
    next();
    return pending;
  }

  function sendTodayNow() {
    var d = nowDate();
    enqueueFromDate(d, loadTicks(d), true);
    return flushQueue();
  }

  function formatCountdown(ms) {
    if (ms < 0) ms = 0;
    var total = Math.floor(ms / 1000);
    var m = Math.floor(total / 60);
    var s = total % 60;
    return pad(m) + ":" + pad(s);
  }

  function syncTodayHours(d, ticks) {
    var hours = loadToday(d);
    var h = d.getHours();
    var idx = hours.indexOf(h);
    if (filledCount(ticks) >= GOAL) {
      if (idx === -1) hours.push(h);
    } else if (idx !== -1) {
      hours.splice(idx, 1);
    }
    hours.sort(function (a, b) { return a - b; });
    saveToday(d, hours);
    return hours;
  }

  function qs(root, sel) {
    return root.querySelector(sel);
  }

  function setText(el, text) {
    if (el) el.textContent = text;
  }

  function show(el, on) {
    if (!el) return;
    el.hidden = !on;
  }

  function init(root) {
    var grid = qs(root, "[data-fluid-grid]");
    var countEl = qs(root, "[data-fluid-count]");
    var cdEl = qs(root, "[data-fluid-countdown]");
    var doneEl = qs(root, "[data-fluid-done]");
    var todayEl = qs(root, "[data-fluid-today]");
    var whoRow = qs(root, "[data-fluid-who]");
    var whoLabel = qs(root, "[data-fluid-who-label]");
    var whoChange = qs(root, "[data-fluid-who-change]");
    var whoCard = qs(root, "[data-fluid-who-card]");
    var nameInput = qs(root, "[data-fluid-name]");
    var surgeryInput = qs(root, "[data-fluid-surgery]");
    var whoError = qs(root, "[data-fluid-who-error]");
    var whoSave = qs(root, "[data-fluid-who-save]");
    var sendBtn = qs(root, "[data-fluid-send]");
    var sendStatus = qs(root, "[data-fluid-send-status]");
    if (!grid) return;

    var buttons = [];
    var ticks = emptyTicks();
    var currentKey = "";
    var i;

    function named() {
      return !!getPatient().label;
    }

    function setSyringesEnabled(on) {
      for (i = 0; i < buttons.length; i++) buttons[i].disabled = !on;
    }

    function paintWho() {
      var p = getPatient();
      if (p.label) {
        show(whoCard, false);
        show(whoRow, true);
        show(sendBtn, true);
        setText(whoLabel, p.surgeryDate ? p.label + " · surgery " + p.surgeryDate : p.label);
        if (nameInput) nameInput.value = p.label;
        if (surgeryInput) surgeryInput.value = p.surgeryDate || "";
        setSyringesEnabled(true);
      } else {
        show(whoCard, true);
        show(whoRow, false);
        show(sendBtn, false);
        setSyringesEnabled(false);
        if (nameInput && !nameInput.value) nameInput.focus();
      }
    }

    function makeButton(index) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "fluid-syringe";
      btn.setAttribute("data-syringe", String(index));
      btn.innerHTML = SYRINGE_SVG;
      btn.addEventListener("click", function () {
        if (!named()) {
          paintWho();
          return;
        }
        var d = nowDate();
        if (hourKey(d) !== currentKey) applyHour(d);
        ticks[index] = !ticks[index];
        saveTicks(d, ticks);
        syncTodayHours(d, ticks);
        paint();
      });
      grid.appendChild(btn);
      buttons.push(btn);
    }

    for (i = 0; i < GOAL; i++) makeButton(i);

    function applyHour(d) {
      var nextKey = hourKey(d);
      if (currentKey && currentKey !== nextKey) {
        var prev = parseHourKey(currentKey);
        if (prev) enqueueHour(prev.date, prev.hour, filledCount(ticks), false);
      }
      currentKey = nextKey;
      ticks = loadTicks(d);
      syncUnsentHours(d);
      pruneOld(d);
      flushQueue();
    }

    function paint() {
      var d = nowDate();
      var key = hourKey(d);
      if (key !== currentKey) applyHour(d);

      var n = filledCount(ticks);
      var hours = loadToday(d);
      var hit = hours.length;

      for (i = 0; i < buttons.length; i++) {
        var on = !!ticks[i];
        buttons[i].classList.toggle("is-full", on);
        buttons[i].setAttribute("aria-pressed", on ? "true" : "false");
        buttons[i].setAttribute(
          "aria-label",
          "Syringe " + (i + 1) + " of " + GOAL + (on ? ", done" : ", not yet")
        );
      }

      if (countEl) countEl.textContent = n + " of " + GOAL + " this hour";
      if (doneEl) {
        if (n >= GOAL) {
          doneEl.hidden = false;
          doneEl.textContent = "Great job, all 15 done this hour";
        } else {
          doneEl.hidden = true;
        }
      }
      if (todayEl) {
        todayEl.textContent =
          "Today · " + hit + " hour" + (hit === 1 ? "" : "s") + " at 15 of 15";
      }
      if (cdEl) {
        cdEl.textContent = "Resets in " + formatCountdown(nextHour(d).getTime() - d.getTime());
      }
    }

    function saveWho() {
      var nameRes = normalizePatientLabel(nameInput ? nameInput.value : "");
      if (!nameRes.ok) {
        show(whoError, true);
        setText(whoError, nameRes.error);
        if (nameInput) nameInput.focus();
        return;
      }
      var dateRes = normalizeSurgeryDate(surgeryInput ? surgeryInput.value : "");
      if (!dateRes.ok) {
        show(whoError, true);
        setText(whoError, dateRes.error);
        if (surgeryInput) surgeryInput.focus();
        return;
      }
      show(whoError, false);
      setText(whoError, "");
      savePatient(nameRes.label, dateRes.date);
      if (nameInput) nameInput.value = nameRes.label;
      dropPatientQuery();
      paintWho();
      flushQueue();
    }

    function editWho() {
      var p = getPatient();
      if (nameInput) nameInput.value = p.label || "";
      if (surgeryInput) surgeryInput.value = p.surgeryDate || "";
      show(whoError, false);
      show(whoCard, true);
      if (nameInput) nameInput.focus();
    }

    if (whoSave) whoSave.addEventListener("click", saveWho);
    if (nameInput) {
      nameInput.addEventListener("input", function () {
        show(whoError, false);
      });
      nameInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          saveWho();
        }
      });
    }
    if (whoChange) whoChange.addEventListener("click", editWho);
    if (sendBtn) {
      sendBtn.addEventListener("click", function () {
        if (!named()) {
          paintWho();
          setText(sendStatus, "Save your first name and last initial first.");
          return;
        }
        var d = nowDate();
        if (hourKey(d) !== currentKey) applyHour(d);
        saveTicks(d, ticks);
        setText(sendStatus, "Sending today’s log…");
        sendTodayNow().then(function (res) {
          if (res && res.skipped && res.reason === "empty-endpoint") {
            setText(sendStatus, "Saved on this phone. Clinic sending is not set up yet.");
            return;
          }
          if (res && res.failed) {
            setText(sendStatus, "Couldn’t send just now. It will retry when you are back online.");
            return;
          }
          setText(sendStatus, "Today’s log sent to the clinic.");
        }).catch(function () {
          setText(sendStatus, "Couldn’t send just now. It will retry when you are back online.");
        });
      });
    }

    paintWho();
    paint();
    tickers.push(paint);
    flushQueue();
  }

  function boot() {
    applyPatientFromQuery();
    var nodes = document.querySelectorAll("[data-fluid-tracker]");
    Array.prototype.forEach.call(nodes, init);
    if (!global.__fluidsInterval) {
      global.__fluidsInterval = setInterval(function () {
        var i;
        for (i = 0; i < tickers.length; i++) tickers[i]();
      }, 1000);
    }
    document.addEventListener("visibilitychange", function () {
      var i;
      for (i = 0; i < tickers.length; i++) tickers[i]();
      flushQueue();
    });
    global.addEventListener("focus", function () {
      var i;
      for (i = 0; i < tickers.length; i++) tickers[i]();
      flushQueue();
    });
    global.addEventListener("online", function () {
      flushQueue();
    });
  }

  global.__fluidsApi = {
    GOAL: GOAL,
    HOUR_PREFIX: HOUR_PREFIX,
    PATIENT_KEY: PATIENT_KEY,
    DEVICE_KEY: DEVICE_KEY,
    QUEUE_KEY: QUEUE_KEY,
    SENT_KEY: SENT_KEY,
    LAST_PARTIAL_KEY: LAST_PARTIAL_KEY,
    normalizePatientLabel: normalizePatientLabel,
    normalizeSurgeryDate: normalizeSurgeryDate,
    getPatient: getPatient,
    savePatient: savePatient,
    clearPatient: clearPatient,
    applyPatientFromQuery: applyPatientFromQuery,
    getDeviceId: getDeviceId,
    getQueue: loadQueue,
    getSent: loadSent,
    enqueueHour: enqueueHour,
    enqueueFromDate: enqueueFromDate,
    syncUnsentHours: syncUnsentHours,
    pruneOld: pruneOld,
    flushQueue: flushQueue,
    sendTodayNow: sendTodayNow,
    hourKey: hourKey,
    ymd: ymd,
    filledCount: filledCount,
    emptyTicks: emptyTicks,
    recordKey: recordKey,
    endpointUrl: endpointUrl,
    tick: function () {
      var i;
      for (i = 0; i < tickers.length; i++) tickers[i]();
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window);
