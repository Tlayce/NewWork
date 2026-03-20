const express = require('express');
const crypto = require('crypto');
const net = require('net');
const app = express();

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const SUPABASE_URL = 'https://hvquabbuaqlosxlswhve.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function supabaseGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'GET',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  return res.json();
}

async function supabasePatch(path, body) {
  await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(body)
  });
}

async function supabasePost(path, body) {
  await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(body)
  });
}

// Generate random 5 character code
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Get MikroTik profile name from plan
function getProfile(plan) {
  const p = (plan || '').toLowerCase();
  if (p.includes('1 hour')) return '1hr';
  if (p.includes('2 hour')) return '2hr';
  if (p.includes('1gb')) return '1gb-starter';
  if (p.includes('3gb')) return '3gb-standard';
  if (p.includes('6gb')) return '6gb-popular';
  return null;
}

// Create hotspot user on MikroTik via API
function createMikrotikUser(code, profile) {
  return new Promise((resolve, reject) => {
    const host = process.env.MIKROTIK_HOST;
    const user = process.env.MIKROTIK_USER;
    const pass = process.env.MIKROTIK_PASS;

    const socket = new net.Socket();
    socket.setTimeout(10000);

    let buffer = Buffer.alloc(0);
    let loggedIn = false;
    let userCreated = false;

    function encodeLength(len) {
      if (len < 0x80) return Buffer.from([len]);
      if (len < 0x4000) return Buffer.from([((len >> 8) & 0xFF) | 0x80, len & 0xFF]);
      return Buffer.from([((len >> 16) & 0xFF) | 0xC0, (len >> 8) & 0xFF, len & 0xFF]);
    }

    function encodeSentence(words) {
      let parts = [];
      for (const word of words) {
        const wb = Buffer.from(word, 'utf8');
        parts.push(encodeLength(wb.length));
        parts.push(wb);
      }
      parts.push(Buffer.from([0])); // end of sentence
      return Buffer.concat(parts);
    }

    function sendSentence(words) {
      socket.write(encodeSentence(words));
    }

    function md5(str) {
      return crypto.createHash('md5').update(str).digest();
    }

    socket.connect(8728, host, () => {});

    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);

      // Parse sentences from buffer
      while (buffer.length > 0) {
        let pos = 0;
        let words = [];

        while (pos < buffer.length) {
          if (buffer[pos] === 0) { pos++; break; } // end of sentence
          let len = 0;
          if ((buffer[pos] & 0xE0) === 0xC0) {
            len = ((buffer[pos] & 0x3F) << 16) | (buffer[pos+1] << 8) | buffer[pos+2];
            pos += 3;
          } else if ((buffer[pos] & 0xC0) === 0x80) {
            len = ((buffer[pos] & 0x3F) << 8) | buffer[pos+1];
            pos += 2;
          } else {
            len = buffer[pos];
            pos += 1;
          }
          if (pos + len > buffer.length) return; // wait for more data
          words.push(buffer.slice(pos, pos + len).toString('utf8'));
          pos += len;
        }

        buffer = buffer.slice(pos);

        if (words.length === 0) continue;

        if (!loggedIn) {
          // Look for challenge
          const challenge = words.find(w => w.startsWith('=ret='));
          if (challenge) {
            const challengeHex = challenge.substring(5);
            const challengeBuf = Buffer.from(challengeHex, 'hex');
            const passBuf = Buffer.from(pass, 'utf8');
            const nullBuf = Buffer.from([0]);
            const hash = md5(Buffer.concat([nullBuf, passBuf, challengeBuf]));
            const response = '00' + hash.toString('hex');
            sendSentence(['/login', `=name=${user}`, `=response=${response}`]);
            loggedIn = true;
          } else if (words[0] === '!done') {
            // RouterOS 7 — no challenge needed, already logged in
            loggedIn = true;
            sendSentence([
              '/ip/hotspot/user/add',
              `=name=${code}`,
              `=password=${code}`,
              `=profile=${profile}`
            ]);
          }
        } else if (!userCreated) {
          if (words[0] === '!done') {
            userCreated = true;
            socket.destroy();
            resolve(true);
          } else if (words[0] === '!trap') {
            socket.destroy();
            reject(new Error(words.find(w => w.startsWith('=message=')) || 'MikroTik error'));
          }
        }
      }
    });

    socket.on('timeout', () => { socket.destroy(); reject(new Error('Timeout')); });
    socket.on('error', (err) => reject(err));
  });
}

// Voucher endpoint
app.get('/voucher', async (req, res) => {
  const { reference, plan } = req.query;
  if (!reference) return res.json({ error: 'No reference provided' });

  try {
    // Check if already assigned
    const existing = await supabaseGet(`vouchers?reference=eq.${reference}&used=eq.true&select=code`);
    if (existing && existing.length > 0) {
      return res.json({ voucher: existing[0].code });
    }

    // Verify payment with Paystack
    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
    });
    const data = await response.json();

    if (data.status === true && data.data.status === 'success') {
      const profile = getProfile(plan);
      if (!profile) return res.json({ error: 'Unknown plan. Contact support. Ref: ' + reference });

      // Generate unique code
      let code = generateCode();

      // Create user on MikroTik
      try {
        await createMikrotikUser(code, profile);
        console.log(`MikroTik user created: ${code} [${profile}]`);
      } catch (err) {
        console.error('MikroTik error:', err.message);
        return res.json({ error: 'Could not create user. Contact support. Ref: ' + reference });
      }

      // Save to Supabase
      await supabasePost('vouchers', {
        code: code,
        plan: plan,
        used: true,
        reference: reference
      });

      console.log(`Voucher ${code} [${plan}] assigned to ${reference}`);
      return res.json({ voucher: code });

    } else {
      return res.json({ error: 'Payment not confirmed. Contact support. Ref: ' + reference });
    }
  } catch (err) {
    console.error(err);
    return res.json({ error: 'Verification failed. Contact support. Ref: ' + reference });
  }
});

// Record login time for hour bundle users
app.get('/login', async (req, res) => {
  const { username, limit } = req.query;
  if (!username || !limit) return res.json({ ok: false });

  try {
    const existing = await supabaseGet(`logins?username=eq.${encodeURIComponent(username)}&select=id`);
    if (existing && existing.length > 0) {
      return res.json({ ok: true, existing: true });
    }
    await supabasePost('logins', {
      username: username,
      login_time: new Date().toISOString(),
      limit_seconds: parseInt(limit)
    });
    console.log(`Login recorded: ${username} limit=${limit}s`);
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.json({ ok: false });
  }
});

// Return remaining time for hour bundle users
app.get('/timeleft', async (req, res) => {
  const { username } = req.query;
  if (!username) return res.json({ error: 'No username' });

  try {
    const rows = await supabaseGet(`logins?username=eq.${encodeURIComponent(username)}&select=login_time,limit_seconds`);
    if (!rows || rows.length === 0) return res.json({ error: 'No login record found' });

    const loginTime = new Date(rows[0].login_time);
    const limitSecs = rows[0].limit_seconds;
    const elapsed = Math.floor((Date.now() - loginTime.getTime()) / 1000);
    const remaining = Math.max(0, limitSecs - elapsed);

    return res.json({
      remaining_seconds: remaining,
      limit_seconds: limitSecs,
      elapsed_seconds: elapsed,
      expired: remaining === 0
    });
  } catch (err) {
    console.error(err);
    return res.json({ error: 'Failed to get time' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
