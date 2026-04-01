'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const env = {
  ...process.env,
  PORT: '3211',
  HOST: '127.0.0.1',
  ADMIN_API_KEY: 'admin-secret',
  TENANTS_FILE: 'tenants.billing.json',
  BILLING_DIR: 'billing-verify-output',
};

const tenantFixturePath = path.join(__dirname, 'tenants.billing.json');
const billingDir = path.join(__dirname, 'billing-verify-output');
fs.writeFileSync(tenantFixturePath, JSON.stringify({
  tenants: [
    {
      id: 'tenant-billing',
      name: 'Tenant Billing',
      apiKey: 'tenant-billing-key',
      plan: 'pro',
      maxSessions: 5,
      rateLimitPerWindow: 100,
      active: true,
    },
  ],
}, null, 2));

const child = spawn(process.execPath, ['server.js'], {
  cwd: __dirname,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

function waitForReady() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server did not start in time')), 5000);
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('Human Sim rental API listening')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.trim()) process.stderr.write(text);
    });
    child.on('exit', (code) => reject(new Error(`Server exited early with code ${code}`)));
  });
}

async function api(url, options = {}) {
  const res = await fetch(url, options);
  const payload = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(payload));
  return payload;
}

async function run() {
  await waitForReady();

  const tenantHeaders = {
    Authorization: 'Bearer tenant-billing-key',
    'Content-Type': 'application/json',
  };

  const adminHeaders = {
    Authorization: 'Bearer admin-secret',
    'Content-Type': 'application/json',
  };

  const create = await api('http://127.0.0.1:3211/v1/sessions', {
    method: 'POST',
    headers: tenantHeaders,
    body: JSON.stringify({ label: 'billing-check' }),
  });

  await api(`http://127.0.0.1:3211/v1/sessions/${create.sessionId}/tick`, {
    method: 'POST',
    headers: tenantHeaders,
    body: JSON.stringify({ count: 500 }),
  });

  for (let index = 0; index < 20; index += 1) {
    await api(`http://127.0.0.1:3211/v1/sessions/${create.sessionId}/phasa-tawan`, {
      method: 'POST',
      headers: tenantHeaders,
      body: JSON.stringify({ script: 'PS.CALM; ACT.GROUND' }),
    });
  }

  const quote = await api('http://127.0.0.1:3211/v1/admin/billing/quote', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ tenantId: 'tenant-billing', planId: 'pro' }),
  });

  const invoice = await api('http://127.0.0.1:3211/v1/admin/billing/invoice-summary-file', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      tenantId: 'tenant-billing',
      customerName: 'Tenant Billing Co., Ltd.',
      planId: 'pro',
      billingPeriod: { label: 'verification' },
    }),
  });

  if (quote.estimatedBillableUnits <= 0) {
    throw new Error('Billing quote produced zero units unexpectedly');
  }
  if (!invoice.filePath || !fs.existsSync(invoice.filePath)) {
    throw new Error('Invoice file was not created');
  }

  console.log(JSON.stringify({
    quote,
    invoiceFile: invoice.filePath,
  }, null, 2));
}

run()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(() => {
    child.kill();
    if (fs.existsSync(tenantFixturePath)) fs.unlinkSync(tenantFixturePath);
    if (fs.existsSync(billingDir)) fs.rmSync(billingDir, { recursive: true, force: true });
  });
