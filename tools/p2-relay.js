// Desktop Player-2 relay for local debugging.
//
// A browser tab can't listen for connections, so on localhost there's nothing for
// a phone controller to connect to (on the Android TV build the native app hosts
// this). This tiny WebSocket server plays that same role: the phone (ChillStick /
// controller.html) connects and streams button presses, and we forward them to the
// game tab — which connects here too, as a client, and feeds them into Game.handleCtrl.
//
//   Phone ──ws──► p2-relay :8081 ──ws──► Game (desktop browser)
//
// The QR (generated here, since we know the LAN IP) encodes ws://<LAN-IP>:8081 — the
// bare ws:// address the ChillStick app expects, identical to the Android pairing QR.

const { WebSocketServer } = require('ws');
const os = require('os');
const QRCode = require('qrcode');

const PORT = 8081;

function lanIp() {
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const a of ifs[name] || []) {
      if (a.family === 'IPv4' && !a.internal &&
          (a.address.startsWith('192.168.') || a.address.startsWith('10.') || a.address.startsWith('172.'))) {
        return a.address;
      }
    }
  }
  return '127.0.0.1';
}

const ip = lanIp();
const wsUrl = `ws://${ip}:${PORT}`;

const wss = new WebSocketServer({ port: PORT, host: '0.0.0.0' });

let gameSocket = null;            // the game tab (sends {role:'game'})
const controllerSlots = new Map(); // controller ws -> stable slot index
let nextSlot = 0;

wss.on('connection', (ws) => {
  ws.on('message', async (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    // The game tab identifies itself; everyone else is treated as a controller.
    if (msg.role === 'game') {
      gameSocket = ws;
      try {
        const qr = await QRCode.toDataURL(wsUrl, { margin: 1, width: 320 });
        ws.send(JSON.stringify({ type: 'pairing', wsUrl, qr }));
      } catch (e) { /* ignore QR failures */ }
      return;
    }

    // Controller input → tag with a stable slot and forward to the game. The
    // first message from a new controller also tells the game a phone has joined.
    const isNew = !controllerSlots.has(ws);
    if (isNew) controllerSlots.set(ws, nextSlot++);
    const slot = controllerSlots.get(ws);
    if (gameSocket && gameSocket.readyState === 1) {
      if (isNew) gameSocket.send(JSON.stringify({ type: 'controller', state: 'connected', slot }));
      if (msg.action && msg.key) {
        gameSocket.send(JSON.stringify({ action: msg.action, key: msg.key, slot }));
      }
    }
  });

  ws.on('close', () => {
    if (ws === gameSocket) gameSocket = null;
    controllerSlots.delete(ws);
  });

  ws.on('error', () => { /* ignore; client will reconnect */ });
});

console.log(`[p2-relay] listening on ${wsUrl}`);
console.log('[p2-relay] open the game, reach Barney, pick "2 Players", then scan the QR with ChillStick.');
