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

function clearSessionFiles() {
  fs.rmSync(sessionDir, { recursive: true, force: true });
  console.log('[BONY-XMD] Invalid session cleared.');
}

function sessionId() {
  if (!fs.existsSync(credsPath)) {
    throw new Error('creds.json not found');
  }
  return SESSION_PREFIX + fs.readFileSync(credsPath).toString('base64');
}

async function start(phone, options = {}) {
  const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason,
    makeCacheableSignalKeyStore,
    delay
  } = require('@whiskeysockets/baileys');
  await fs.promises.mkdir(sessionDir, { recursive: true });

  const { version } = await fetchLatestBaileysVersion();
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
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
  let socketClosed = false;

  let pairingSucceeded = false;
  let sessionSent = false;

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

      const id = sessionId();
      const recipient = sock.user.id;

      console.log('[BONY-XMD] Connected account:', recipient);

      try {
        await sock.sendMessage(recipient, {
          text: `🔐 *BONY-XMD SESSION ID*\n\n${id}\n\n⚠️ Keep this session ID private.`
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

        if (options.exitOnSuccess !== false) {
          rl.close();
          process.exit(0);
        }
      } catch (sendError) {
        console.error('[BONY-XMD] Session send failed:', sendError.message);
      }
    }

    if (connection === 'close') {
      socketClosed = true;
      console.log('[BONY-XMD] DISCONNECT DEBUG:', JSON.stringify(lastDisconnect, null, 2));
      const code = lastDisconnect?.error?.output?.statusCode;

      if (code === DisconnectReason.loggedOut) {
        console.log('[BONY-XMD] WhatsApp logged out.');
      } else {
        console.log('[BONY-XMD] Connection closed.');
      }

      if (code === DisconnectReason.loggedOut || code === 401) {
        console.log('[BONY-XMD] WhatsApp logged out.');
        clearSessionFiles();
        rl.close();
        process.exit(1);
      }

      if (code === DisconnectReason.connectionReplaced || code === 440) {
        console.log('[BONY-XMD] Existing session was replaced. Clearing session.');
        clearSessionFiles();
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


