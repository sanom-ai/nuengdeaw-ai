'use strict';

const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const webhookEvents = [];
const webhookServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    webhookEvents.push({
      method: req.method,
      url: req.url,
      body: body ? JSON.parse(body) : null,
    });
    res.writeHead(204);
    res.end();
  });
});

const env = {
  ...process.env,
  PORT: '3210',
  HOST: '127.0.0.1',
  ADMIN_API_KEY: 'admin-secret',
  TENANTS_FILE: 'tenants.test.json',
  BILLING_DIR: 'billing-test',
  RATE_LIMIT_WINDOW_MS: '60000',
  CORS_ALLOW_ORIGIN: '*',
};
const tenantFixturePath = path.join(__dirname, 'tenants.test.json');
fs.writeFileSync(tenantFixturePath, JSON.stringify({
  tenants: [
    {
      id: 'tenant-smoke',
      name: 'Tenant Smoke',
      apiKey: 'tenant-smoke-key',
      plan: 'pro',
      maxSessions: 5,
      rateLimitPerWindow: 50,
      billingWebhookUrl: 'http://127.0.0.1:3211/hooks/billing',
      active: true,
    },
  ],
}, null, 2));
const billingDir = path.join(__dirname, 'billing-test');

const child = spawn(process.execPath, ['server.js'], {
  cwd: __dirname,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

function waitForReady() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Server did not start in time'));
    }, 5000);

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('Human Sim rental API listening')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.trim()) {
        process.stderr.write(text);
      }
    });

    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited early with code ${code}`));
    });
  });
}

async function run() {
  await new Promise((resolve, reject) => {
    webhookServer.listen(3211, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  await waitForReady();

  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer tenant-smoke-key',
  };

  const createRes = await fetch('http://127.0.0.1:3210/v1/sessions', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      label: 'smoke',
      personality: { conscientiousness: 0.8 },
      context: { socialContext: 'alone' },
    }),
  });
  const createData = await createRes.json();
  if (!createRes.ok || !createData.sessionId) {
    throw new Error(`Failed to create session: ${JSON.stringify(createData)}`);
  }

  const tickRes = await fetch(`http://127.0.0.1:3210/v1/sessions/${createData.sessionId}/tick`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ count: 3 }),
  });
  const tickData = await tickRes.json();
  if (!tickRes.ok || !tickData.snapshot || tickData.snapshot.tick < 3) {
    throw new Error(`Unexpected tick response: ${JSON.stringify(tickData)}`);
  }

  const parseRes = await fetch(`http://127.0.0.1:3210/v1/sessions/${createData.sessionId}/phasa-tawan`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      script: 'PS.CALM; ACT.GROUND; BS.HR=72',
      strictMode: 'warn',
    }),
  });
  const parseData = await parseRes.json();
  if (!parseRes.ok || parseData.ok !== true || !parseData.snapshot) {
    throw new Error(`Unexpected Phasa Tawan response: ${JSON.stringify(parseData)}`);
  }

  const strictParseRes = await fetch(`http://127.0.0.1:3210/v1/sessions/${createData.sessionId}/phasa-tawan`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      script: 'ACT.UNKNOWN_ACTION',
      strictMode: 'strict',
    }),
  });
  const strictParseData = await strictParseRes.json();
  if (!strictParseRes.ok || strictParseData.parsed?.blocked !== true) {
    throw new Error(`Unexpected strict mode response: ${JSON.stringify(strictParseData)}`);
  }

  const evaluateRes = await fetch('http://127.0.0.1:3210/v1/phasa-tawan/evaluate', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      input: {
        z: { hrv: -2.1, hr: 2.3, rr: 1.8, gsr: 1.2 },
        values: { eeg: 2.4 },
        bands: { beta: 2.7, thetaAlphaRatio: 2.3 },
      },
    }),
  });
  const evaluateData = await evaluateRes.json();
  if (!evaluateRes.ok || !evaluateData.recommendation || evaluateData.recommendation.action !== 'ACT.GROUND') {
    throw new Error(`Unexpected evaluation response: ${JSON.stringify(evaluateData)}`);
  }

  const healthRes = await fetch('http://127.0.0.1:3210/v1/health');
  const healthData = await healthRes.json();
  if (!healthRes.ok || healthData.ok !== true || healthData.versionPrefix !== '/v1') {
    throw new Error(`Unexpected health response: ${JSON.stringify(healthData)}`);
  }

  const metricsRes = await fetch('http://127.0.0.1:3210/v1/metrics');
  const metricsText = await metricsRes.text();
  if (!metricsRes.ok || !metricsText.includes('human_sim_requests_total')) {
    throw new Error(`Unexpected metrics response: ${metricsText}`);
  }

  const corsPreflightRes = await fetch('http://127.0.0.1:3210/v1/health', {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://example.com',
      'Access-Control-Request-Method': 'GET',
    },
  });
  if (corsPreflightRes.status !== 204 || corsPreflightRes.headers.get('access-control-allow-origin') !== '*') {
    throw new Error(`Unexpected CORS preflight response: ${corsPreflightRes.status}`);
  }

  const dashboardRes = await fetch('http://127.0.0.1:3210/admin');
  const dashboardHtml = await dashboardRes.text();
  if (!dashboardRes.ok || !dashboardHtml.includes('Human Sim Admin')) {
    throw new Error(`Unexpected dashboard response: ${dashboardHtml}`);
  }

  const validationRes = await fetch('http://127.0.0.1:3210/v1/phasa-tawan/validation', {
    headers,
  });
  const validationData = await validationRes.json();
  if (!validationRes.ok || validationData.ok !== true || validationData.nonCanonicalActions.length !== 0 || validationData.nonCanonicalStates.length !== 0) {
    throw new Error(`Unexpected validation response: ${JSON.stringify(validationData)}`);
  }

  const tenantRes = await fetch('http://127.0.0.1:3210/v1/tenants/me', {
    headers,
  });
  const tenantData = await tenantRes.json();
  if (!tenantRes.ok || tenantData.tenant?.id !== 'tenant-smoke') {
    throw new Error(`Unexpected tenant response: ${JSON.stringify(tenantData)}`);
  }

  const forbiddenAdminRes = await fetch('http://127.0.0.1:3210/v1/admin/usage', {
    headers,
  });
  if (forbiddenAdminRes.status !== 401) {
    throw new Error(`Tenant should not access admin usage: ${forbiddenAdminRes.status}`);
  }

  const adminHeaders = {
    Authorization: 'Bearer admin-secret',
    'Content-Type': 'application/json',
  };

  const createTenantRes = await fetch('http://127.0.0.1:3210/v1/admin/tenants', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      id: 'tenant-extra',
      name: 'Tenant Extra',
      apiKey: 'tenant-extra-key',
      plan: 'basic',
      maxSessions: 2,
      rateLimitPerWindow: 4,
      active: true,
    }),
  });
  const createTenantData = await createTenantRes.json();
  if (!createTenantRes.ok || createTenantData.tenant?.id !== 'tenant-extra') {
    throw new Error(`Unexpected create tenant response: ${JSON.stringify(createTenantData)}`);
  }

  const usageRes = await fetch('http://127.0.0.1:3210/v1/admin/usage', {
    headers: adminHeaders,
  });
  const usageData = await usageRes.json();
  if (!usageRes.ok || !Array.isArray(usageData.usage) || usageData.usage.length === 0) {
    throw new Error(`Unexpected usage response: ${JSON.stringify(usageData)}`);
  }

  const pricingRes = await fetch('http://127.0.0.1:3210/v1/admin/pricing', {
    headers: adminHeaders,
  });
  const pricingData = await pricingRes.json();
  if (!pricingRes.ok || !Array.isArray(pricingData.monthly_plans) || pricingData.monthly_plans.length === 0) {
    throw new Error(`Unexpected pricing response: ${JSON.stringify(pricingData)}`);
  }

  const quoteRes = await fetch('http://127.0.0.1:3210/v1/admin/billing/quote', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      tenantId: 'tenant-smoke',
      planId: 'pro',
    }),
  });
  const quoteData = await quoteRes.json();
  if (!quoteRes.ok || quoteData.planId !== 'pro' || quoteData.estimatedBillableUnits <= 0) {
    throw new Error(`Unexpected quote response: ${JSON.stringify(quoteData)}`);
  }

  const invoiceRes = await fetch('http://127.0.0.1:3210/v1/admin/billing/invoice-summary', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      tenantId: 'tenant-smoke',
      customerName: 'Tenant Smoke Co., Ltd.',
      planId: 'pro',
      billingPeriod: { label: '2026-03' },
    }),
  });
  const invoiceData = await invoiceRes.json();
  if (!invoiceRes.ok || invoiceData.planId !== 'pro' || !invoiceData.invoiceId || invoiceData.total <= 0) {
    throw new Error(`Unexpected invoice response: ${JSON.stringify(invoiceData)}`);
  }

  const invoiceFileRes = await fetch('http://127.0.0.1:3210/v1/admin/billing/invoice-summary-file', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      tenantId: 'tenant-smoke',
      customerName: 'Tenant Smoke Co., Ltd.',
      planId: 'pro',
      billingPeriod: { label: '2026-03' },
    }),
  });
  const invoiceFileData = await invoiceFileRes.json();
  if (!invoiceFileRes.ok || !invoiceFileData.filePath || !fs.existsSync(invoiceFileData.filePath)) {
    throw new Error(`Unexpected invoice file response: ${JSON.stringify(invoiceFileData)}`);
  }

  const invoiceHtmlRes = await fetch('http://127.0.0.1:3210/v1/admin/billing/invoice-html-file', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      tenantId: 'tenant-smoke',
      customerName: 'Tenant Smoke Co., Ltd.',
      planId: 'pro',
      billingPeriod: { label: '2026-03' },
    }),
  });
  const invoiceHtmlData = await invoiceHtmlRes.json();
  if (!invoiceHtmlRes.ok || !invoiceHtmlData.htmlFilePath || !fs.existsSync(invoiceHtmlData.htmlFilePath)) {
    throw new Error(`Unexpected invoice html response: ${JSON.stringify(invoiceHtmlData)}`);
  }

  const invoicePdfRes = await fetch('http://127.0.0.1:3210/v1/admin/billing/invoice-pdf-file', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      tenantId: 'tenant-smoke',
      customerName: 'Tenant Smoke Co., Ltd.',
      planId: 'pro',
      billingPeriod: { label: '2026-03' },
    }),
  });
  const invoicePdfData = await invoicePdfRes.json();
  if (!invoicePdfRes.ok || !invoicePdfData.pdfFilePath || !fs.existsSync(invoicePdfData.pdfFilePath)) {
    throw new Error(`Unexpected invoice pdf response: ${JSON.stringify(invoicePdfData)}`);
  }
  const pdfSignature = fs.readFileSync(invoicePdfData.pdfFilePath).subarray(0, 4).toString('utf8');
  if (pdfSignature !== '%PDF') {
    throw new Error(`Unexpected PDF signature: ${pdfSignature}`);
  }

  const exportRes = await fetch('http://127.0.0.1:3210/v1/admin/usage/export', {
    headers: adminHeaders,
  });
  const exportData = await exportRes.json();
  if (!exportRes.ok || !Array.isArray(exportData.tenants) || exportData.totals.requests < 1) {
    throw new Error(`Unexpected export response: ${JSON.stringify(exportData)}`);
  }

  const saveRes = await fetch(`http://127.0.0.1:3210/v1/sessions/${createData.sessionId}/save`, {
    method: 'POST',
    headers,
  });
  const saveData = await saveRes.json();
  if (!saveRes.ok || !saveData.filePath || !fs.existsSync(saveData.filePath)) {
    throw new Error(`Unexpected save response: ${JSON.stringify(saveData)}`);
  }

  const loadRes = await fetch('http://127.0.0.1:3210/v1/sessions/load', {
    method: 'POST',
    headers,
    body: JSON.stringify({ sessionId: createData.sessionId }),
  });
  const loadData = await loadRes.json();
  if (!loadRes.ok || loadData.sessionId !== createData.sessionId || !loadData.snapshot) {
    throw new Error(`Unexpected load response: ${JSON.stringify(loadData)}`);
  }

  const csvRes = await fetch('http://127.0.0.1:3210/v1/admin/usage/export.csv', {
    headers: adminHeaders,
  });
  const csvText = await csvRes.text();
  if (!csvRes.ok || !csvText.includes('tenantId,requests')) {
    throw new Error(`Unexpected CSV export response: ${csvText}`);
  }

  const fileRes = await fetch('http://127.0.0.1:3210/v1/admin/usage/export-file', {
    method: 'POST',
    headers: adminHeaders,
  });
  const fileData = await fileRes.json();
  if (!fileRes.ok || !fileData.files?.jsonPath || !fs.existsSync(fileData.files.jsonPath) || !fs.existsSync(fileData.files.csvPath)) {
    throw new Error(`Unexpected file export response: ${JSON.stringify(fileData)}`);
  }

  const limitedHeaders = {
    Authorization: 'Bearer tenant-extra-key',
    'Content-Type': 'application/json',
  };
  for (let index = 0; index < 4; index += 1) {
    const response = await fetch('http://127.0.0.1:3210/v1/tenants/me', {
      headers: limitedHeaders,
    });
    if (!response.ok) {
      throw new Error(`Expected tenant-extra request ${index + 1} to pass`);
    }
  }

  const limitedRes = await fetch('http://127.0.0.1:3210/v1/tenants/me', {
    headers: limitedHeaders,
  });
  const limitedData = await limitedRes.json();
  if (limitedRes.status !== 429 || limitedData.error !== 'Rate limit exceeded') {
    throw new Error(`Unexpected rate limit response: ${JSON.stringify(limitedData)}`);
  }

  const patchTenantRes = await fetch('http://127.0.0.1:3210/v1/admin/tenants/tenant-extra', {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({
      active: false,
      plan: 'paused',
    }),
  });
  const patchTenantData = await patchTenantRes.json();
  if (!patchTenantRes.ok || patchTenantData.tenant?.active !== false) {
    throw new Error(`Unexpected patch tenant response: ${JSON.stringify(patchTenantData)}`);
  }

  await new Promise((resolve) => setTimeout(resolve, 200));
  if (!webhookEvents.some((event) => event.body?.event === 'billing.invoice_ready')) {
    throw new Error(`Expected billing webhook to be delivered: ${JSON.stringify(webhookEvents)}`);
  }

  console.log('Smoke test passed');
}

run()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(() => {
    child.kill();
    webhookServer.close();
    if (fs.existsSync(tenantFixturePath)) {
      fs.unlinkSync(tenantFixturePath);
    }
    if (fs.existsSync(billingDir)) {
      fs.rmSync(billingDir, { recursive: true, force: true });
    }
  });
