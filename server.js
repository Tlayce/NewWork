const express = require('express');
const crypto = require('crypto');
const app = express();

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});

let vouchers = process.env.VOUCHERS ? process.env.VOUCHERS.split(',') : [];
const usedVouchers = {};

app.get('/voucher', async (req, res) => {
  const { reference, plan } = req.query;

  if (!reference) return res.json({ error: 'No reference provided' });

  // Return existing voucher if already assigned
  if (usedVouchers[reference]) {
    return res.json({ voucher: usedVouchers[reference] });
  }

  // Verify payment with Paystack
  try {
    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
    });
    const data = await response.json();

    if (data.status === true && data.data.status === 'success') {
      const voucher = vouchers.shift();
      if (voucher) {
        usedVouchers[reference] = voucher;
        console.log(`Voucher ${voucher} assigned to ${reference} for plan ${plan}`);
        return res.json({ voucher });
      } else {
        return res.json({ error: 'No vouchers available. Please contact support.' });
      }
    } else {
      return res.json({ error: 'Payment not confirmed. Please contact support.' });
    }
  } catch (err) {
    console.error(err);
    return res.json({ error: 'Verification failed. Please contact support.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
