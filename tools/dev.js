// `npm run dev` — serves the game (http-server :3000) AND the Player-2 relay
// (:8081) together, so phone-as-Player-2 works on localhost. Either process
// exiting tears down the other.

const { spawn } = require('child_process');
const path = require('path');

const httpBin = path.join(
  __dirname, '..', 'node_modules', '.bin',
  'http-server' + (process.platform === 'win32' ? '.cmd' : ''),
);

function run(cmd, args) {
  return spawn(cmd, args, { stdio: 'inherit' });
}

const procs = [
  run(process.execPath, [path.join(__dirname, 'p2-relay.js')]),
  run(httpBin, ['-p', '3000', '-c-1']),
];

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const p of procs) { try { p.kill(); } catch (e) {} }
}

procs.forEach(p => p.on('exit', () => { shutdown(); process.exit(); }));
process.on('SIGINT', () => { shutdown(); process.exit(); });
process.on('SIGTERM', () => { shutdown(); process.exit(); });
