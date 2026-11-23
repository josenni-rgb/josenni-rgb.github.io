(function () {
  "use strict";
  document.documentElement.classList.add("js");
  var open = document.documentElement.getAttribute("data-open-stage");
  var jump = document.querySelectorAll(".jump a");
  var spokes = document.querySelectorAll(".spoke");
  var ids = [];
  Array.prototype.forEach.call(jump, function (a) {
    var href = a.getAttribute("href") || "";
    if (href.charAt(0) === "#") ids.push(href.slice(1));
  });

  var lockable = {};
  Array.prototype.forEach.call(document.querySelectorAll("[data-lock='stage']"), function (el) {
    var stage = el.getAttribute("data-stage") || el.id;
    if (stage) lockable[stage] = 1;
  });

  function lockLink(el) {
    el.removeAttribute("href");
    el.setAttribute("tabindex", "-1");
    el.setAttribute("aria-disabled", "true");
    el.setAttribute("aria-label", (el.textContent || "").replace(/\s+/g, " ").trim() + " (locked)");
    el.addEventListener("click", function (e) { e.preventDefault(); });
  }

  var skip = document.querySelector(".skip");
  if (skip && open) skip.setAttribute("href", "#" + open);

  if (open) {
    Array.prototype.forEach.call(document.querySelectorAll("[data-lock='stage']"), function (el) {
      var stage = el.getAttribute("data-stage") || el.id;
      if (stage && stage === open) {
        el.classList.add("is-open");
        if (el.tagName === "A") el.setAttribute("aria-current", "true");
      } else if (el.tagName === "A") {
        lockLink(el);
      }
    });
    function stageHashBlocked(h) {
      return !!(lockable[h] && h !== open);
    }
    var initialHash = (location.hash || "").replace(/^#/, "");
    if (stageHashBlocked(initialHash) && history.replaceState) {
      history.replaceState(null, "", location.pathname + location.search + "#" + open);
    }
    window.addEventListener("hashchange", function () {
      var h = (location.hash || "").replace(/^#/, "");
      if (stageHashBlocked(h)) {
        if (history.replaceState) history.replaceState(null, "", location.pathname + location.search + "#" + open);
        var panel = document.getElementById(open);
        if (panel && panel.scrollIntoView) panel.scrollIntoView({ block: "start" });
      }
    });
  }

  function current() {
    var y = window.scrollY + 72;
    var active = open || ids[0];
    ids.forEach(function (id) {
      if (open && lockable[id] && id !== open) return;
      var el = document.getElementById(id);
      if (el && el.offsetParent && el.offsetTop <= y) active = id;
    });
    jump.forEach(function (a) {
      var href = a.getAttribute("href") || "";
      a.setAttribute("aria-current", href === "#" + active ? "true" : "false");
    });
    spokes.forEach(function (a) {
      var href = a.getAttribute("href") || "";
      if (href) a.setAttribute("aria-current", href === "#" + active ? "true" : "false");
    });
  }
  window.addEventListener("scroll", current, { passive: true });
  current();
})();
