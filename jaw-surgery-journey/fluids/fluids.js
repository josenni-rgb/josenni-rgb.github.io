(function (global) {
  "use strict";
  var GOAL = 15;
  var HOUR_PREFIX = "oms-jaw-fluids-hour:";
  var DAY_PREFIX = "oms-jaw-fluids-day:";

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
    var ticks = loadJSON(HOUR_PREFIX + hourKey(d), null);
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

  function pruneOld(d) {
    try {
      var keepHour = HOUR_PREFIX + hourKey(d);
      var keepDay = DAY_PREFIX + ymd(d);
      var remove = [];
      var i, k;
      for (i = 0; i < localStorage.length; i++) {
        k = localStorage.key(i);
        if (!k) continue;
        if (k.indexOf(HOUR_PREFIX) === 0 && k !== keepHour) remove.push(k);
        if (k.indexOf(DAY_PREFIX) === 0 && k !== keepDay) remove.push(k);
      }
      for (i = 0; i < remove.length; i++) localStorage.removeItem(remove[i]);
    } catch (e) {}
  }

  function filledCount(ticks) {
    var n = 0;
    var i;
    for (i = 0; i < ticks.length; i++) if (ticks[i]) n++;
    return n;
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

  function formatCountdown(ms) {
    if (ms < 0) ms = 0;
    var total = Math.floor(ms / 1000);
    var m = Math.floor(total / 60);
    var s = total % 60;
    return pad(m) + ":" + pad(s);
  }

  function init(root) {
    var grid = root.querySelector("[data-fluid-grid]");
    var countEl = root.querySelector("[data-fluid-count]");
    var cdEl = root.querySelector("[data-fluid-countdown]");
    var doneEl = root.querySelector("[data-fluid-done]");
    var todayEl = root.querySelector("[data-fluid-today]");
    if (!grid) return;

    var buttons = [];
    var ticks = emptyTicks();
    var currentKey = "";
    var i;

    function makeButton(index) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "fluid-syringe";
      btn.setAttribute("data-syringe", String(index));
      btn.innerHTML = SYRINGE_SVG;
      btn.addEventListener("click", function () {
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
      currentKey = hourKey(d);
      ticks = loadTicks(d);
      pruneOld(d);
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

    paint();
    setInterval(paint, 1000);
    document.addEventListener("visibilitychange", paint);
    global.addEventListener("focus", paint);
  }

  function boot() {
    var nodes = document.querySelectorAll("[data-fluid-tracker]");
    Array.prototype.forEach.call(nodes, init);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window);
