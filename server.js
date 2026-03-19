const express = require('express');
const crypto = require('crypto');
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

function getPlanKey(plan) {
  return plan || null;
}

// Voucher endpoint
app.get('/voucher', async (req, res) => {
  const { reference, plan } = req.query;

  if (!reference) return res.json({ error: 'No reference provided' });

  try {
    const existing = await supabaseGet(`vouchers?reference=eq.${reference}&used=eq.true&select=code`);
    if (existing && existing.length > 0) {
      return res.json({ voucher: existing[0].code });
    }

    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
    });
    const data = await response.json();

    if (data.status === true && data.data.status === 'success') {
      const planKey = getPlanKey(plan);
      if (!planKey) return res.json({ error: 'Unknown plan. Contact support. Ref: ' + reference });

      const available = await supabaseGet(`vouchers?plan=eq.${encodeURIComponent(planKey)}&used=eq.false&select=id,code&limit=1`);
      if (!available || available.length === 0) {
        return res.json({ error: 'No vouchers available for this plan. Contact support. Ref: ' + reference });
      }

      const voucher = available[0];
      await supabasePatch(`vouchers?id=eq.${voucher.id}`, { used: true, reference: reference });
      console.log(`Voucher ${voucher.code} [${planKey}] assigned to ${reference}`);
      return res.json({ voucher: voucher.code });

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
    // Check if already recorded — don't overwrite first login time
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
    if (!rows || rows.length === 0) {
      return res.json({ error: 'No login record found' });
    }

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
