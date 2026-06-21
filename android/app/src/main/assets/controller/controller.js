// Phone controller: opens a WebSocket back to the TV (same host that served this
// page, port 8081) and streams keydown/keyup as the user touches the buttons.
(function () {
  "use strict";

  var statusEl = document.getElementById("status");
  var WS_PORT = 8081;
  var ws = null;
  var reconnectTimer = null;
  // Track which keys we've sent "down" for, so we can force "up" on disconnect
  // and avoid the game getting stuck running in one direction.
  var held = {};

  function setStatus(cls, text) {
    statusEl.className = "status " + cls;
    statusEl.textContent = text;
  }

  function connect() {
    var url = "ws://" + location.hostname + ":" + WS_PORT;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      scheduleReconnect();
      return;
    }

    ws.onopen = function () {
      setStatus("connected", "Connected — play on the TV!");
    };
    ws.onclose = function () {
      setStatus("lost", "Disconnected — reconnecting…");
      releaseAll();
      scheduleReconnect();
    };
    ws.onerror = function () {
      try { ws.close(); } catch (e) {}
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      connect();
    }, 1000);
  }

  function send(action, key) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ action: action, key: key }));
  }

  function press(key) {
    if (held[key]) return;
    held[key] = true;
    send("keydown", key);
  }

  function release(key) {
    if (!held[key]) return;
    held[key] = false;
    send("keyup", key);
  }

  function releaseAll() {
    Object.keys(held).forEach(function (k) {
      if (held[k]) { held[k] = false; }
    });
  }

  // Wire each button. Pointer events cover touch + mouse and give us reliable
  // up/cancel/leave so a key never sticks.
  var buttons = document.querySelectorAll(".btn");
  Array.prototype.forEach.call(buttons, function (btn) {
    var key = btn.getAttribute("data-key");

    function down(e) {
      e.preventDefault();
      btn.classList.add("active");
      press(key);
    }
    function up(e) {
      if (e) e.preventDefault();
      btn.classList.remove("active");
      release(key);
    }

    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointercancel", up);
    btn.addEventListener("pointerleave", up);
    // Belt-and-suspenders for older iOS Safari touch handling
    btn.addEventListener("touchstart", down, { passive: false });
    btn.addEventListener("touchend", up, { passive: false });
    btn.addEventListener("touchcancel", up, { passive: false });
    btn.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  });

  // If the page is backgrounded, let go of everything.
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      Array.prototype.forEach.call(buttons, function (b) { b.classList.remove("active"); });
      ["left", "right", "jump", "chop"].forEach(release);
    }
  });

  setStatus("connecting", "Connecting…");
  connect();
})();
