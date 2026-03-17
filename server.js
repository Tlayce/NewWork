const express = require('express');
const crypto = require('crypto');
const app = express();

app.use(express.json());

let vouchers = process.env.VOUCHERS ? process.env.VOUCHERS.split(',') : [];
const usedVouchers = {};

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
    if (usedVouchers[reference]) return res.sendStatus(200);
    const voucher = vouchers.shift();
    if (voucher) {
      usedVouchers[reference] = voucher;
      console.log(`Voucher ${voucher} assigned to ${reference}`);
    }
  }

  res.sendStatus(200);
});

app.get('/success', (req, res) => {
  const reference = req.query.reference;
  const voucher = usedVouchers[reference];

  if (!voucher) {
    return res.send(`
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Processing...</title>
        <script>
          let attempts = 0;
          function tryRefresh() {
            attempts++;
            if (attempts < 10) {
              setTimeout(() => {
                window.location.reload();
              }, 3000);
            }
          }
          window.onload = tryRefresh;
        </script>
      </head>
      <body style="font-family:sans-serif;text-align:center;padding:40px;max-width:400px;margin:auto">
        <h2>⏳ Processing your payment...</h2>
        <p>Please wait, your voucher is being prepared.</p>
        <p style="color:#999;font-size:14px">This page will refresh automatically.</p>
      </body>
      </html>
    `);
  }

  res.send(`
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
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
