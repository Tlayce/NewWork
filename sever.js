const express = require('express');
const crypto = require('crypto');
const app = express();

app.use(express.json());

// Your voucher pool — paste your Winbox vouchers here
let vouchers = process.env.VOUCHERS ? process.env.VOUCHERS.split(',') : [];
const usedVouchers = {};

// Paystack webhook — triggers after payment
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

    // Avoid giving two vouchers for same payment
    if (usedVouchers[reference]) return res.sendStatus(200);

    const voucher = vouchers.shift();
    if (voucher) {
      usedVouchers[reference] = voucher;
      console.log(`Voucher ${voucher} assigned to ${reference}`);
    }
  }

  res.sendStatus(200);
});

// Page shown to user after payment
app.get('/success', (req, res) => {
  const reference = req.query.reference;
  const voucher = usedVouchers[reference];

  if (!voucher) {
    return res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:40px">
        <h2>Payment received!</h2>
        <p>Your voucher is being processed. Please wait a moment and refresh.</p>
      </body></html>
    `);
  }

  res.send(`
    <html><body style="font-family:sans-serif;text-align:center;padding:40px;max-width:400px;margin:auto">
      <h2>✅ Payment confirmed!</h2>
      <p>Your WiFi voucher code is:</p>
      <h1 style="font-size:2.5rem;letter-spacing:6px;color:#4CAF50;border:2px dashed #4CAF50;padding:20px;border-radius:8px">${voucher}</h1>
      <p>Enter this code on the WiFi login page to connect.</p>
    </body></html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
