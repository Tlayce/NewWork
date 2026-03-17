const express = require('express');
const crypto = require('crypto');
const app = express();

app.use(express.json());

let vouchers = process.env.VOUCHERS ? process.env.VOUCHERS.split(',') : [];
const usedVouchers = {};

// Verify payment directly with Paystack
async function verifyPayment(reference) {
  const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
    }
  });
  const data = await response.json();
  return data.status === true && data.data.status === 'success';
}

// Keep webhook as backup
app.post('/webhook/paystack', (req, res) => {
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (hash !== req.headers['x-paystack-signature']) {
    return res.status(401).send('Unauthorized');
  }

  const event = req.body;

  if (event.event === 'charge.success') {
    const reference = event.data.reference;
    if (!usedVouchers[reference]) {
      const voucher = vouchers.shift();
      if (voucher) {
        usedVouchers[reference] = voucher;
        console.log(`Voucher ${voucher} assigned via webhook to ${reference}`);
      }
    }
  }

  res.sendStatus(200);
});

// Success page — verifies payment directly with Paystack
app.get('/success', async (req, res) => {
  const reference = req.query.reference;

  if (!reference) {
    return res.send(`
      <html>
      <body style="font-family:sans-serif;text-align:center;padding:40px;max-width:400px;margin:auto">
        <h2>⚠️ No payment reference found</h2>
        <p>Please contact support.</p>
      </body>
      </html>
    `);
  }

  // If voucher already assigned, show it
  if (usedVouchers[reference]) {
    const voucher = usedVouchers[reference];
    return res.send(voucherPage(voucher));
  }

  // Otherwise verify directly with Paystack
  try {
    const success = await verifyPayment(reference);

    if (success) {
      const voucher = vouchers.shift();
      if (voucher) {
        usedVouchers[reference] = voucher;
        console.log(`Voucher ${voucher} assigned via verify to ${reference}`);
        return res.send(voucherPage(voucher));
      } else {
        return res.send(`
          <html>
          <body style="font-family:sans-serif;text-align:center;padding:40px;max-width:400px;margin:auto">
            <h2>⚠️ No vouchers available</h2>
            <p>Please contact support with your reference: <strong>${reference}</strong></p>
          </body>
          </html>
        `);
      }
    } else {
      return res.send(`
        <html>
        <body style="font-family:sans-serif;text-align:center;padding:40px;max-width:400px;margin:auto">
          <h2>⚠️ Payment not confirmed</h2>
          <p>Please contact support with your reference: <strong>${reference}</strong></p>
        </body>
        </html>
      `);
    }
  } catch (err) {
    console.error('Verify error:', err);
    return res.send(`
      <html>
      <body style="font-family:sans-serif;text-align:center;padding:40px;max-width:400px;margin:auto">
        <h2>⚠️ Something went wrong</h2>
        <p>Please contact support with your reference: <strong>${reference}</strong></p>
      </body>
      </html>
    `);
  }
});

function voucherPage(voucher) {
  return `
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Your WiFi Voucher</title>
    </head>
    <body style="font-family:sans-serif;text-align:center;padding:40px;max-width:400px;margin:auto">
      <h2>✅ Payment confirmed!</h2>
      <p>Your WiFi login details are:</p>
      <div style="border:2px dashed #4CAF50;padding:20px;border-radius:8px;margin:20px 0">
        <p style="margin:0;font-size:14px;color:#666">Username</p>
        <h1 style="font-size:2rem;letter-spacing:4px;color:#4CAF50;margin:8px 0">${voucher}</h1>
        <p style="margin:0;font-size:14px;color:#666">Password</p>
        <h1 style="font-size:2rem;letter-spacing:4px;color:#4CAF50;margin:8px 0">${voucher}</h1>
      </div>
      <p style="color:#666;font-size:14px">Enter these on the WiFi login page to connect.</p>
    </body>
    </html>
  `;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
