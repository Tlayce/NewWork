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

// Query Supabase
async function supabase(method, path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : ''
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}

// Map plan name from store to plan key in DB
function getPlanKey(plan) {
  const p = (plan || '').toLowerCase();
  if (p.includes('1 hour') || p.includes('1hr')) return '1HR';
  if (p.includes('2 hour') || p.includes('2hr')) return '2HR';
  if (p.includes('1gb')) return '1GB';
  if (p.includes('3gb')) return '3GB';
  if (p.includes('6gb')) return '6GB';
  return null;
}

app.get('/voucher', async (req, res) => {
  const { reference, plan } = req.query;

  if (!reference) return res.json({ error: 'No reference provided' });

  // Check if voucher already assigned for this reference
  const existing = await supabase('GET', `vouchers?reference=eq.${reference}&used=eq.true&select=code`);
  if (existing && existing.length > 0) {
    return res.json({ voucher: existing[0].code });
  }

  // Verify payment with Paystack
  try {
    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
    });
    const data = await response.json();

    if (data.status === true && data.data.status === 'success') {
      const planKey = getPlanKey(plan);

      if (!planKey) {
        return res.json({ error: 'Unknown plan. Contact support. Ref: ' + reference });
      }

      // Get first available voucher for this plan
      const available = await supabase('GET', `vouchers?plan=eq.${planKey}&used=eq.false&select=id,code&limit=1`);

      if (!available || available.length === 0) {
        return res.json({ error: 'No vouchers available for this plan. Contact support. Ref: ' + reference });
      }

      const voucher = available[0];

      // Mark voucher as used
      await supabase('PATCH', `vouchers?id=eq.${voucher.id}`, {
        used: true,
        reference: reference
      });

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
