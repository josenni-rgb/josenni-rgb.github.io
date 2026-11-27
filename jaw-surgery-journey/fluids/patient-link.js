(function (global) {
  "use strict";
  var TRACKER_BASE = "https://josenni-rgb.github.io/jaw-surgery-journey/fluids/";
  var CLINIC_PHONE = "604-371-0578";

  function titleFirst(first) {
    var s = String(first || "");
    if (!s) return s;
    if (s.slice(1) === s.slice(1).toUpperCase()) {
      return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    }
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function normalizeChart(raw) {
    var s = String(raw || "").trim();
    if (!s) return { ok: true, chart: "" };
    if (/[()+\-\s.]/.test(s) && /\d/.test(s)) {
      return { ok: false, error: "Do not enter a phone number. Chart # is digits only, or leave it blank." };
    }
    if (!/^\d+$/.test(s)) {
      return { ok: false, error: "Chart # is digits only, or leave it blank." };
    }
    if (s.length === 10) {
      return { ok: false, error: "Do not enter a PHN or phone number. Chart # is optional and shorter than 10 digits." };
    }
    if (s.length > 9) {
      return { ok: false, error: "Do not enter a phone number. Chart # is optional and at most 9 digits." };
    }
    return { ok: true, chart: s };
  }

  function normalizeFirst(raw) {
    var first = String(raw || "").trim();
    if (!first) return { ok: false, error: "Enter a first name." };
    if (/[0-9]/.test(first) || /@/.test(first) || /https?:/i.test(first)) {
      return { ok: false, error: "Use a first name only — no numbers, email, or phone." };
    }
    if (!/^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'’-]*$/.test(first) || first.length < 2 || first.length > 30) {
      return { ok: false, error: "Use a first name only, like Sarah." };
    }
    return { ok: true, first: titleFirst(first) };
  }

  function normalizeInitial(raw) {
    var s = String(raw || "").trim();
    var m = s.match(/^([A-Za-zÀ-ÖØ-öø-ÿ])\.?$/);
    if (!m) {
      return { ok: false, error: "Last initial is one letter, like K. Do not enter a full last name." };
    }
    return { ok: true, initial: m[1].toUpperCase() };
  }

  function displayLabel(first, initial, chart) {
    var label = first + " " + initial + ".";
    if (chart) label += " #" + chart;
    return label;
  }

  function encodeCode(first, initial, chart) {
    var firstCode = String(first || "").trim().replace(/\s+/g, "-");
    var parts = [firstCode, String(initial || "").toUpperCase()];
    if (chart) parts.push(String(chart));
    return parts.join("-");
  }

  function parseCode(raw) {
    var decoded = String(raw || "").trim();
    if (!decoded) return { ok: false, error: "Missing patient code." };
    if (/%[0-9A-Fa-f]{2}/.test(decoded) || decoded.indexOf("+") !== -1) {
      try {
        decoded = decodeURIComponent(decoded.replace(/\+/g, " ")).trim();
      } catch (e) {
        return { ok: false, error: "That link is not a valid patient code." };
      }
    }
    if (/@/.test(decoded) || /https?:/i.test(decoded)) {
      return { ok: false, error: "Do not put an email in the patient link." };
    }
    var parts = decoded.split("-").filter(function (p) { return p.length > 0; });
    if (parts.length < 2) {
      return { ok: false, error: "Use first name, last initial, and optional chart #, like Sarah-K-1234." };
    }
    var chart = "";
    var last = parts[parts.length - 1];
    if (/^\d+$/.test(last)) {
      var chartRes = normalizeChart(last);
      if (!chartRes.ok) return chartRes;
      chart = chartRes.chart;
      parts = parts.slice(0, -1);
    }
    if (parts.length < 2) {
      return { ok: false, error: "Use first name, last initial, and optional chart #, like Sarah-K-1234." };
    }
    var initialRes = normalizeInitial(parts[parts.length - 1]);
    if (!initialRes.ok) return initialRes;
    var firstRes = normalizeFirst(parts.slice(0, -1).join("-"));
    if (!firstRes.ok) return firstRes;
    var code = encodeCode(firstRes.first, initialRes.initial, chart);
    return {
      ok: true,
      first: firstRes.first,
      initial: initialRes.initial,
      chart: chart,
      code: code,
      label: displayLabel(firstRes.first, initialRes.initial, chart)
    };
  }

  function fromFields(firstRaw, initialRaw, chartRaw) {
    var firstRes = normalizeFirst(firstRaw);
    if (!firstRes.ok) return firstRes;
    var initialRes = normalizeInitial(initialRaw);
    if (!initialRes.ok) return initialRes;
    var chartRes = normalizeChart(chartRaw);
    if (!chartRes.ok) return chartRes;
    var code = encodeCode(firstRes.first, initialRes.initial, chartRes.chart);
    return {
      ok: true,
      first: firstRes.first,
      initial: initialRes.initial,
      chart: chartRes.chart,
      code: code,
      label: displayLabel(firstRes.first, initialRes.initial, chartRes.chart)
    };
  }

  function trackerUrl(code) {
    return TRACKER_BASE + "?p=" + encodeURIComponent(code);
  }

  function textMessage(first, url) {
    return (
      "Hi " + first + ", here is your hourly fluid tracker after surgery: " + url +
      ". Tap one syringe each time you drink one. Aim for 15 every hour. Questions? Call the clinic at " +
      CLINIC_PHONE + "."
    );
  }

  function queryParam(name) {
    var search = "";
    try {
      search = (global.location && global.location.search) || "";
    } catch (e) {
      return "";
    }
    var found = "";
    search.replace(/^\?/, "").split("&").forEach(function (part) {
      var kv = part.split("=");
      var key = "";
      try {
        key = decodeURIComponent((kv[0] || "").replace(/\+/g, " "));
      } catch (err) {
        return;
      }
      if (key === name) {
        try {
          found = decodeURIComponent((kv[1] || "").replace(/\+/g, " "));
        } catch (err2) {
          found = kv[1] || "";
        }
      }
    });
    return found;
  }

  function copyText(text, btn, doneLabel) {
    function ok() {
      if (!btn) return;
      var old = btn.getAttribute("data-label") || btn.textContent;
      btn.setAttribute("data-label", old);
      btn.textContent = doneLabel || "Copied";
      setTimeout(function () { btn.textContent = old; }, 1600);
    }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "readonly");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); ok(); } catch (e) {}
      document.body.removeChild(ta);
    }
    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
      global.navigator.clipboard.writeText(text).then(ok).catch(fallback);
    } else {
      fallback();
    }
  }

  function initMaker(root) {
    if (!root) return;
    var firstEl = root.querySelector("[data-link-first]");
    var initialEl = root.querySelector("[data-link-initial]");
    var chartEl = root.querySelector("[data-link-chart]");
    var errorEl = root.querySelector("[data-link-error]");
    var out = root.querySelector("[data-link-out]");
    var urlEl = root.querySelector("[data-link-url]");
    var msgEl = root.querySelector("[data-link-message]");
    var copyLink = root.querySelector("[data-link-copy]");
    var copyMsg = root.querySelector("[data-link-copy-message]");
    var parsed = null;

    function showError(on, text) {
      if (!errorEl) return;
      errorEl.hidden = !on;
      errorEl.textContent = on ? (text || "") : "";
    }

    function paint() {
      parsed = fromFields(
        firstEl ? firstEl.value : "",
        initialEl ? initialEl.value : "",
        chartEl ? chartEl.value : ""
      );
      var ready = !!(parsed && parsed.ok);
      if (!firstEl || !(firstEl.value || "").trim()) {
        showError(false);
        if (out) out.hidden = true;
        if (copyLink) copyLink.disabled = true;
        if (copyMsg) copyMsg.disabled = true;
        return;
      }
      if (!ready) {
        showError(true, parsed.error);
        if (out) out.hidden = true;
        if (copyLink) copyLink.disabled = true;
        if (copyMsg) copyMsg.disabled = true;
        return;
      }
      showError(false);
      var url = trackerUrl(parsed.code);
      var msg = textMessage(parsed.first, url);
      if (urlEl) urlEl.value = url;
      if (msgEl) msgEl.value = msg;
      if (out) out.hidden = false;
      if (copyLink) copyLink.disabled = false;
      if (copyMsg) copyMsg.disabled = false;
    }

    function onInput() { paint(); }
    if (firstEl) firstEl.addEventListener("input", onInput);
    if (initialEl) initialEl.addEventListener("input", onInput);
    if (chartEl) chartEl.addEventListener("input", onInput);
    if (copyLink) {
      copyLink.disabled = true;
      copyLink.addEventListener("click", function () {
        if (parsed && parsed.ok) copyText(trackerUrl(parsed.code), copyLink, "Link copied");
      });
    }
    if (copyMsg) {
      copyMsg.disabled = true;
      copyMsg.addEventListener("click", function () {
        if (parsed && parsed.ok) {
          copyText(textMessage(parsed.first, trackerUrl(parsed.code)), copyMsg, "Message copied");
        }
      });
    }
    paint();
  }

  function bootMakers() {
    var nodes = document.querySelectorAll("[data-fluid-make-link]");
    Array.prototype.forEach.call(nodes, initMaker);
  }

  global.FluidsLink = {
    TRACKER_BASE: TRACKER_BASE,
    normalizeChart: normalizeChart,
    normalizeFirst: normalizeFirst,
    normalizeInitial: normalizeInitial,
    displayLabel: displayLabel,
    encodeCode: encodeCode,
    parseCode: parseCode,
    fromFields: fromFields,
    trackerUrl: trackerUrl,
    textMessage: textMessage,
    queryParam: queryParam,
    initMaker: initMaker
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootMakers);
  } else {
    bootMakers();
  }
})(window);
