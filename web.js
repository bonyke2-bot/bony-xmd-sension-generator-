const express = require('express');
const pn = require('awesome-phonenumber');
const { start } = require('./index.js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const jobs = new Map();

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BONY-XMD Session Generator</title>
  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0b0b0b;
      color: #fff;
      font-family: Arial, sans-serif;
      padding: 20px;
    }

    .card {
      width: 100%;
      max-width: 430px;
      background: #151515;
      border: 1px solid #2b2b2b;
      border-radius: 18px;
      padding: 28px;
      box-shadow: 0 15px 45px rgba(0, 0, 0, 0.45);
    }

    h1 {
      margin: 0 0 8px;
      text-align: center;
      font-size: 25px;
    }

    .subtitle {
      text-align: center;
      color: #999;
      margin-bottom: 28px;
    }

    label {
      display: block;
      margin-bottom: 8px;
      font-size: 14px;
      color: #ccc;
    }

    input {
      width: 100%;
      padding: 14px;
      border-radius: 10px;
      border: 1px solid #333;
      background: #0d0d0d;
      color: white;
      font-size: 16px;
      outline: none;
    }

    input:focus {
      border-color: #777;
    }

    button {
      width: 100%;
      margin-top: 18px;
      padding: 14px;
      border: 0;
      border-radius: 10px;
      background: white;
      color: black;
      font-size: 16px;
      font-weight: bold;
      cursor: pointer;
    }

    button:hover {
      opacity: 0.9;
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .result {
      display: none;
      margin-top: 20px;
      padding: 16px;
      border-radius: 10px;
      background: #0d0d0d;
      border: 1px solid #333;
    }

    .result pre {
      white-space: pre-wrap;
      word-break: break-all;
      color: #fff;
      font-size: 15px;
      margin: 10px 0 0;
    }

    .info {
      margin-top: 22px;
      padding: 14px;
      border-radius: 10px;
      background: #0d0d0d;
      color: #999;
      font-size: 13px;
      line-height: 1.6;
    }

    .footer {
      text-align: center;
      margin-top: 22px;
      color: #666;
      font-size: 12px;
    }
  </style>
</head>

<body>
  <main class="card">
    <h1>BONY-XMD</h1>
    <div class="subtitle">WhatsApp Session Generator</div>

    <form id="generateForm">
      <label for="phone">WhatsApp Number</label>
      <input
        id="phone"
        name="phone"
        type="tel"
        placeholder="254700000000"
        autocomplete="tel"
        required
      >
      <button id="generateButton" type="submit">Generate Session</button>
    </form>

    <div class="result" id="result">
      <strong id="resultTitle">Status</strong>
      <pre id="resultText"></pre>
    </div>

    <div class="info">
      Enter your WhatsApp number with country code.
      <br>
      Example: <strong>254700000000</strong>
    </div>

    <div class="footer">
      BONY-XMD • Powered by BONY KE 🇱🇹
    </div>
  </main>

  <script>
    const form = document.getElementById('generateForm');
    const button = document.getElementById('generateButton');
    const result = document.getElementById('result');
    const resultTitle = document.getElementById('resultTitle');
    const resultText = document.getElementById('resultText');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      const phone = document.getElementById('phone').value.trim();

      result.style.display = 'block';
      resultTitle.textContent = 'Starting...';
      resultText.textContent = 'Connecting to WhatsApp...';
      button.disabled = true;

      try {
        const response = await fetch('/generate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ phone })
        });

        const data = await response.json();

        if (!response.ok) {
          resultTitle.textContent = 'Error';
          resultText.textContent = data.error || 'Invalid WhatsApp number.';
          button.disabled = false;
          return;
        }

        resultTitle.textContent = 'Pairing';
        resultText.textContent = 'Waiting for WhatsApp pairing code...';

        const timer = setInterval(async () => {
          try {
            const statusResponse = await fetch('/status/' + data.id);
            const status = await statusResponse.json();

            if (status.code) {
              resultTitle.textContent = 'WhatsApp Pairing Code';
              resultText.textContent =
                status.code +
                '\\n\\nOpen WhatsApp → Settings → Linked Devices → Link with phone number.';
            }

            if (status.session) {
              clearInterval(timer);
              resultTitle.textContent = 'Session ID Generated';
              resultText.textContent = status.session;
              button.disabled = false;
            }

            if (status.error) {
              clearInterval(timer);
              resultTitle.textContent = 'Error';
              resultText.textContent = status.error;
              button.disabled = false;
            }
          } catch (error) {
            clearInterval(timer);
            resultTitle.textContent = 'Error';
            resultText.textContent = 'Connection to generator lost.';
            button.disabled = false;
          }
        }, 1000);
      } catch (error) {
        resultTitle.textContent = 'Error';
        resultText.textContent = 'Unable to contact the generator.';
        button.disabled = false;
      }
    });
  </script>
</body>
</html>`);
});

app.get('/status/:id', (req, res) => {
  const job = jobs.get(req.params.id);

  if (!job) {
    return res.status(404).json({
      error: 'Session request not found.'
    });
  }

  res.json(job);
});

app.post('/generate', async (req, res) => {
  const phone = String(req.body.phone || '').replace(/\D/g, '');

  if (!pn('+' + phone).isValid()) {
    return res.status(400).json({
      error: 'Invalid WhatsApp number.'
    });
  }

  const id =
    Math.random().toString(36).slice(2) +
    Date.now().toString(36);

  jobs.set(id, {
    code: null,
    session: null,
    error: null
  });

  res.json({ id });

  try {
    await start(phone, {
      exitOnSuccess: false,

      onPairingCode(code) {
        const job = jobs.get(id);
        if (job) job.code = code;
      },

      onSession(session) {
        const job = jobs.get(id);
        if (job) job.session = session;
      }
    });
  } catch (err) {
    const job = jobs.get(id);

    if (job) {
      job.error = err.message;
    }

    console.error(
      '[BONY-XMD WEB] Session generation failed:',
      err.message
    );
  }
});

app.listen(PORT, () => {
  console.log(
    `[BONY-XMD WEB] Server running on port ${PORT}`
  );
});
