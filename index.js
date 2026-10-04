const fs = require('fs');
const path = require('path');
const readline = require('readline');
const pino = require('pino');
const NodeCache = require('node-cache');


const SESSION_PREFIX = 'BONY-XMD:~';
const sessionDir = path.join(__dirname, 'session');
const credsPath = path.join(sessionDir, 'creds.json');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const ask = q => new Promise(resolve => rl.question(q, resolve));

function clearSessionFiles(targetDir = sessionDir) {
  fs.rmSync(targetDir, { recursive: true, force: true });
  console.log('[BONY-XMD] Invalid session cleared.');
}

function sessionId(targetDir = sessionDir) {
  const targetCredsPath = path.join(targetDir, 'creds.json');
  if (!fs.existsSync(targetCredsPath)) {
    throw new Error('creds.json not found');
  }

  const files = {};
  for (const file of fs.readdirSync(targetDir)) {
    const fullPath = path.join(targetDir, file);
    if (fs.statSync(fullPath).isFile()) {
      files[file] = fs.readFileSync(fullPath).toString('base64');
    }
  }

  const payload = JSON.stringify({
    version: 2,
    files
  });

  const compressed = require('zlib').gzipSync(Buffer.from(payload));
  return 'BONY-XMD:~2' + compressed.toString('base64url');
}

async function start(phone, options = {}) {
  const activeSessionDir = options.sessionDir || sessionDir;

  const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason,
    makeCacheableSignalKeyStore,
    delay
  } = require('@whiskeysockets/baileys');
  await fs.promises.mkdir(activeSessionDir, { recursive: true });

  const { version } = await fetchLatestBaileysVersion();
  const { state, saveCreds } = await useMultiFileAuthState(activeSessionDir);
  const msgRetryCounterCache = new NodeCache();

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'info' }),
    printQRInTerminal: false,
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(
        state.keys,
        pino({ level: 'fatal' }).child({ level: 'fatal' })
      )
    },
    markOnlineOnConnect: true,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    msgRetryCounterCache
  });

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('messages.update', updates => console.log('[BONY-XMD] MESSAGE UPDATE:', JSON.stringify(updates)));
  let socketClosed = false;

  let pairingSucceeded = false;
  let sessionSent = false;
  let intentionalClose = false;

  sock.ev.on('connection.update', async ({ connection, isNewLogin, lastDisconnect }) => {
    if (isNewLogin) {
      pairingSucceeded = true;
      console.log('[BONY-XMD] Pairing confirmed by WhatsApp. Waiting for reconnect...');
    }

    if (connection === 'open') {
      if (!pairingSucceeded && !state.creds.registered || sessionSent || socketClosed) return;

      console.log('[BONY-XMD] Stable post-pairing connection established.');
      await delay(3000);

      if (socketClosed || sessionSent || !sock.user?.id) return;

      const recipient = sock.authState?.creds?.me?.lid || `${sock.user.id.split(":")[0]}@s.whatsapp.net`;

    console.log('[BONY-XMD] Connected account:', recipient);
    console.log('[BONY-XMD] Self PN:', sock.user?.id, 'Self LID:', sock.user?.lid);

    try {
      const scannerFrames = [
        '🔐 *BONY-XMD SESSION GENERATOR*\n\n⏳ generating Session ID......\n\n[░░░░░░░░░░] 0%\n\nPlease wait while your new session is being prepared.\n\n⚡ BONY-XMD • Starting...\n👑 Powered by BONY KE',
        '🔐 *BONY-XMD SESSION GENERATOR*\n\n⏳ generating Session ID......\n\n[██░░░░░░░░] 20%\n\nPlease wait while your new session is being prepared.\n\n⚡ BONY-XMD • Preparing...\n👑 Powered by BONY KE',
        '🔐 *BONY-XMD SESSION GENERATOR*\n\n⏳ generating Session ID......\n\n[█████░░░░░] 50%\n\nPlease wait while your new session is being prepared.\n\n⚡ BONY-XMD • Almost ready...\n👑 Powered by BONY KE',
        '🔐 *BONY-XMD SESSION GENERATOR*\n\n⏳ generating Session ID......\n\n[███████░░░] 70%\n\nPlease wait while your new session is being prepared.\n\n⚡ BONY-XMD • Finalizing...\n👑 Powered by BONY KE',
        '🔐 *BONY-XMD SESSION GENERATOR*\n\n⏳ generating Session ID......\n\n[██████████] 100%\n\nPlease wait while your new session is being prepared.\n\n⚡ BONY-XMD • Ready...\n👑 Powered by BONY KE'
      ];

      const scannerMessage = await sock.sendMessage(recipient, {
        text: scannerFrames[0]
      });
      const scannerKey = scannerMessage.key;

      const scannerStart = Date.now();
      const scannerDuration = 10000;

      for (let i = 1; i < scannerFrames.length; i++) {
        const target = scannerStart + Math.round((scannerDuration / (scannerFrames.length - 1)) * i);
        const wait = Math.max(0, target - Date.now());
        if (wait) await delay(wait);

        await sock.sendMessage(recipient, {
          text: scannerFrames[i],
          edit: scannerKey
        });
      }

      const id = sessionId(activeSessionDir);

      await sock.sendMessage(recipient, {
        text: id
      });

      sessionSent = true;
        console.log('[BONY-XMD] Session message sent successfully.');

        if (typeof options.onSession === 'function') {
          options.onSession(id);
        }

        console.log('\n========================================');
        console.log('        BONY-XMD SESSION ID');
        console.log('========================================\n');
        console.log(id);
        console.log('\n📩 Session ID sent to your WhatsApp DM.');
        console.log('========================================\n');

            if (options.closeAfterSuccess) {
              await delay(5000); intentionalClose = true;
              sock.end(undefined);
              return;
            }

            if (options.exitOnSuccess !== false) {
              rl.close();
              await delay(15000);
              sock.end(undefined);
              process.exit(0);
            }
      } catch (sendError) {
        console.error('[BONY-XMD] Session send failed:', sendError.message);
      }
    }

    if (connection === 'close') {
      socketClosed = true;
      if (intentionalClose) return;
      console.log('[BONY-XMD] DISCONNECT DEBUG:', JSON.stringify(lastDisconnect, null, 2));
      const code = lastDisconnect?.error?.output?.statusCode;

      if (code === DisconnectReason.loggedOut) {
        console.log('[BONY-XMD] WhatsApp logged out.');
      } else {
        console.log('[BONY-XMD] Connection closed.');
      }

      if (code === DisconnectReason.loggedOut || code === 401) {
        console.log('[BONY-XMD] WhatsApp logged out.');
        clearSessionFiles(activeSessionDir);
        rl.close();
        process.exit(1);
      }

      if (code === DisconnectReason.connectionReplaced || code === 440) {
        console.log('[BONY-XMD] Existing session was replaced. Clearing session.');
        clearSessionFiles(activeSessionDir);
        rl.close();
        process.exit(1);
      }

      console.log(`[BONY-XMD] Temporary disconnect (status ${code}). Reconnecting...`);
      await delay(10000);
      start(phone, options);
    }
  });

  if (state.creds.registered) {
    console.log('[BONY-XMD] Existing registered session found. Skipping pairing code.');
    return;
  }

  await delay(3000);

  let code = await sock.requestPairingCode(phone);
  code = code?.match(/.{1,4}/g)?.join('-') || code;

  console.log('\n========================================');
  console.log('        BONY-XMD PAIRING CODE');
  console.log('========================================\n');
  console.log(code);

  if (typeof options.onPairingCode === 'function') {
    options.onPairingCode(code);
  }
  console.log('\nWhatsApp → Settings → Linked Devices');
  console.log('→ Link a Device → Link with phone number');
  console.log('========================================\n');
}

async function runCli() {
  console.log('\n====== BONY-XMD SESSION GENERATOR ======\n');

  if (fs.existsSync(credsPath)) {
    try {
      const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
      if (creds.registered) {
        console.log('[BONY-XMD] Existing registered session found. Restoring session...');
        await start('', { exitOnSuccess: false });
        return;
      }
    } catch (err) {
      console.log('[BONY-XMD] Existing session could not be read. Starting pairing flow.');
    }
  }

  let phone = await ask('Enter WhatsApp number (e.g. 254700000000): ');
  phone = phone.replace(/\D/g, '');

  const pn = require('awesome-phonenumber');

  if (!pn('+' + phone).isValid()) {
    console.log('Invalid phone number.');
    rl.close();
    process.exit(1);
  }

  await start(phone);
}

module.exports = { start };

if (require.main === module) {
  runCli().catch(err => {
    console.error('[BONY-XMD]', err.message);
    rl.close();
    process.exit(1);
  });
}


