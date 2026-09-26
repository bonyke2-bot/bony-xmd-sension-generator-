const express = require('express');
const pn = require('awesome-phonenumber');
const { start } = require('./index.js');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const jobs = new Map();

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/pair', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pair.html'));
});

app.get('/api/stats', (req, res) => {
  let successfulLinks = 0;
  let unsuccessfulLinks = 0;

  for (const job of jobs.values()) {
    if (job.session) successfulLinks++;
    else if (job.error) unsuccessfulLinks++;
  }

  res.json({
    visitorsToday: 0,
    successfulLinks,
    unsuccessfulLinks
  });
});

app.get('/code/', async (req, res) => {
  const phone = String(req.query.number || '').replace(/\D/g, '');

  if (!pn('+' + phone).isValid()) {
    return res.status(400).json({
      message: 'Invalid WhatsApp number.'
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

  try {
    await start(phone, {
      exitOnSuccess: false,
                                closeAfterSuccess: true,

      onPairingCode(code) {
        const job = jobs.get(id);
        if (job) job.code = code;
      },

      onSession(session) {
        const job = jobs.get(id);
        if (job) job.session = session;
      }
    });

    const deadline = Date.now() + 30000;

    while (Date.now() < deadline) {
      const job = jobs.get(id);

      if (job?.code) {
        return res.json({ code: job.code });
      }

      if (job?.error) {
        return res.status(500).json({
          message: job.error
        });
      }

      await new Promise(resolve => setTimeout(resolve, 250));
    }

    return res.status(504).json({
      message: 'Pairing code generation timed out.'
    });
  } catch (err) {
    const job = jobs.get(id);

    if (job) {
      job.error = err.message;
    }

    console.error(
      '[BONY-XMD WEB] Pairing code request failed:',
      err.message
    );

    return res.status(500).json({
      message: err.message
    });
  }
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
                                closeAfterSuccess: true,

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
