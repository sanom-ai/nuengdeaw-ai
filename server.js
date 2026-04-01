'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const phasaTawan = require('./phasa-tawan.js');
const { RedisStore } = require('./redis-store.js');

loadDotEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const API_KEY = process.env.HUMAN_SIM_API_KEY || '';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';
const TENANTS_PATH = path.join(__dirname, process.env.TENANTS_FILE || 'tenants.json');
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 1000 * 60 * 30);
const MAX_SESSIONS = Number(process.env.MAX_SESSIONS || 100);
const PHASA_TAWAN_DEFAULT_STRICT_MODE = process.env.PHASA_TAWAN_DEFAULT_STRICT_MODE || 'strict';
const AUTO_SAVE_SESSIONS = String(process.env.AUTO_SAVE_SESSIONS || 'true').toLowerCase() !== 'false';
const STRICT_BOOTSTRAP_VALIDATION = String(process.env.STRICT_BOOTSTRAP_VALIDATION || 'true').toLowerCase() !== 'false';
const DEFAULT_RATE_LIMIT_PER_WINDOW = Number(process.env.DEFAULT_RATE_LIMIT_PER_WINDOW || 300);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 1000 * 60);
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 1024 * 64);
const CLEANUP_INTERVAL_MS = Number(process.env.CLEANUP_INTERVAL_MS || 1000 * 60);
const AUTO_SAVE_EVERY_MUTATIONS = Math.max(1, Number(process.env.AUTO_SAVE_EVERY_MUTATIONS || 1));
const AUTO_SAVE_MIN_INTERVAL_MS = Math.max(0, Number(process.env.AUTO_SAVE_MIN_INTERVAL_MS || 0));
const LOG_DIR = path.join(__dirname, process.env.LOG_DIR || 'logs');
const BILLING_DIR = path.join(__dirname, process.env.BILLING_DIR || 'billing');
const SESSION_STORE_DIR = path.join(__dirname, process.env.SESSION_STORE_DIR || 'session-store');
const PRICING_PATH = path.join(__dirname, process.env.PRICING_FILE || 'pricing.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const REDIS_URL = process.env.REDIS_URL || '';
const CORS_ALLOW_ORIGIN = process.env.CORS_ALLOW_ORIGIN || '';
const CORS_ALLOW_METHODS = process.env.CORS_ALLOW_METHODS || 'GET,POST,PATCH,DELETE,OPTIONS';
const CORS_ALLOW_HEADERS = process.env.CORS_ALLOW_HEADERS || 'Authorization,Content-Type,X-API-Key,X-Request-Id';
const CORS_EXPOSE_HEADERS = process.env.CORS_EXPOSE_HEADERS || 'X-Request-Id';
const CORS_ALLOW_CREDENTIALS = String(process.env.CORS_ALLOW_CREDENTIALS || 'false').toLowerCase() === 'true';
const BILLING_WEBHOOK_USAGE_THRESHOLD = Number(process.env.BILLING_WEBHOOK_USAGE_THRESHOLD || 0.8);
const WEBHOOK_TIMEOUT_MS = Math.max(250, Number(process.env.WEBHOOK_TIMEOUT_MS || 5000));
const ACCESS_LOG_PATH = path.join(LOG_DIR, 'access.log');
const USAGE_LOG_PATH = path.join(LOG_DIR, 'usage.log');

const SIM_PATH = path.join(__dirname, 'nuengdeaw_simulator.js');
const SIM_SOURCE = fs.readFileSync(SIM_PATH, 'utf8');
const sessions = new Map();
const startedAt = Date.now();
const tenants = loadTenantRegistry();
const usageStats = new Map();
const rateLimitBuckets = new Map();
const billingWebhookState = new Map();
const foundationValidation = phasaTawan.validateFoundationSync();
const pricingConfig = safeReadJson(PRICING_PATH, { monthly_plans: [], overage: {}, billable_units_formula: {}, payg: {} });
const redisStore = REDIS_URL ? new RedisStore(REDIS_URL) : null;
const serviceMetrics = {
  requestsTotal: 0,
  errorsTotal: 0,
  sessionsCreatedTotal: 0,
  sessionsDeletedTotal: 0,
  autosavesTotal: 0,
  restoresTotal: 0,
  rateLimitedTotal: 0,
  redisEnabled: redisStore ? 1 : 0,
  redisErrorsTotal: 0,
};

ensureLogDir();

if (STRICT_BOOTSTRAP_VALIDATION && !foundationValidation.ok) {
  throw new Error(`Phasa Tawan foundation validation failed: ${JSON.stringify(foundationValidation)}`);
}

function loadDotEnv(dotEnvPath) {
  if (!fs.existsSync(dotEnvPath)) {
    return;
  }

  const lines = fs.readFileSync(dotEnvPath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key && process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

function createMemoryStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
    clear() {
      data.clear();
    },
  };
}

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.mkdirSync(BILLING_DIR, { recursive: true });
  fs.mkdirSync(SESSION_STORE_DIR, { recursive: true });
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

function safeReadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.warn(`Failed to parse JSON: ${filePath}`, error.message);
    return fallback;
  }
}

function maskApiKey(apiKey) {
  if (!apiKey) {
    return '';
  }

  if (apiKey.length <= 6) {
    return `${apiKey.slice(0, 2)}***`;
  }

  return `${apiKey.slice(0, 4)}***${apiKey.slice(-2)}`;
}

function loadTenantRegistry() {
  const raw = safeReadJson(TENANTS_PATH, null);
  if (!raw || !Array.isArray(raw.tenants)) {
    return new Map();
  }

  const registry = new Map();
  for (const tenant of raw.tenants) {
    if (!tenant || !tenant.apiKey || !tenant.id) {
      continue;
    }

    registry.set(String(tenant.apiKey), {
      id: String(tenant.id),
      name: String(tenant.name || tenant.id),
      apiKey: String(tenant.apiKey),
      active: tenant.active !== false,
      plan: String(tenant.plan || 'basic'),
      maxSessions: Number(tenant.maxSessions || MAX_SESSIONS),
      rateLimitPerWindow: Number(tenant.rateLimitPerWindow || DEFAULT_RATE_LIMIT_PER_WINDOW),
      billingWebhookUrl: tenant.billingWebhookUrl ? String(tenant.billingWebhookUrl) : '',
      metadata: tenant.metadata || {},
    });
  }

  return registry;
}

function saveTenantRegistry() {
  const data = {
    tenants: [...tenants.values()].map((tenant) => ({
      id: tenant.id,
      name: tenant.name,
      apiKey: tenant.apiKey,
      active: tenant.active,
      plan: tenant.plan,
      maxSessions: tenant.maxSessions,
      rateLimitPerWindow: tenant.rateLimitPerWindow,
      billingWebhookUrl: tenant.billingWebhookUrl || '',
      metadata: tenant.metadata || {},
    })),
  };

  fs.writeFileSync(TENANTS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function getUsageBucket(tenantId) {
  if (!usageStats.has(tenantId)) {
    usageStats.set(tenantId, {
      tenantId,
      requests: 0,
      sessionsCreated: 0,
      sessionsDeleted: 0,
      ticksRequested: 0,
      eventsTriggered: 0,
      actionsApplied: 0,
      deceptionChanges: 0,
      languageScriptsApplied: 0,
      bytesIn: 0,
      lastRequestAt: null,
    });
  }

  return usageStats.get(tenantId);
}

function appendLog(filePath, payload) {
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
  }[extension] || 'application/octet-stream';
}

function getCorsOrigin(req) {
  if (!CORS_ALLOW_ORIGIN) {
    return '';
  }

  const requestOrigin = String(req.headers.origin || '');
  if (CORS_ALLOW_ORIGIN === '*') {
    return '*';
  }

  const allowList = CORS_ALLOW_ORIGIN
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (!requestOrigin) {
    return allowList[0] || '';
  }

  return allowList.includes(requestOrigin) ? requestOrigin : '';
}

function applyCorsHeaders(req, res) {
  const allowOrigin = getCorsOrigin(req);
  if (!allowOrigin) {
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', CORS_ALLOW_METHODS);
  res.setHeader('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS);
  res.setHeader('Access-Control-Expose-Headers', CORS_EXPOSE_HEADERS);
  if (allowOrigin !== '*') {
    res.setHeader('Vary', 'Origin');
  }
  if (CORS_ALLOW_CREDENTIALS) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
}

function sendFile(res, filePath, context = null) {
  if (!fs.existsSync(filePath)) {
    notFound(res, context);
    return;
  }

  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': contentTypeFor(filePath),
    'Content-Length': body.length,
  });
  res.end(body);
  if (context) {
    recordAccessLog(context, 200, context.bodyBytes || 0);
  }
}

function recordAccessLog(context, statusCode, bodyBytes = 0) {
  appendLog(ACCESS_LOG_PATH, {
    ts: new Date().toISOString(),
    requestId: context.requestId || null,
    method: context.req.method,
    path: context.pathname,
    statusCode,
    tenantId: context.auth?.tenant?.id || null,
    tenantName: context.auth?.tenant?.name || null,
    sessionId: context.sessionId || null,
    remoteAddress: context.req.socket?.remoteAddress || null,
    userAgent: context.req.headers['user-agent'] || '',
    bodyBytes,
  });
}

function recordUsage(context, updates = {}) {
  const tenantId = context.auth?.tenant?.id || 'anonymous';
  const bucket = getUsageBucket(tenantId);
  bucket.requests += 1;
  bucket.bytesIn += Number(updates.bytesIn || 0);
  bucket.lastRequestAt = new Date().toISOString();

  for (const [key, value] of Object.entries(updates)) {
    if (key === 'bytesIn') {
      continue;
    }
    bucket[key] = (bucket[key] || 0) + Number(value || 0);
  }

  appendLog(USAGE_LOG_PATH, {
    ts: new Date().toISOString(),
    tenantId,
    tenantName: context.auth?.tenant?.name || null,
    path: context.pathname,
    updates,
  });

  if (context.auth?.tenant) {
    maybeTriggerUsageThresholdWebhook(context.auth.tenant, bucket);
  }
}

function countSessionsForTenant(tenantId) {
  let count = 0;
  for (const session of sessions.values()) {
    if (session.tenantId === tenantId) {
      count += 1;
    }
  }
  return count;
}

function getRequestApiKey(req) {
  const authHeader = req.headers.authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const direct = req.headers['x-api-key'] || '';
  return bearer || direct;
}

function requireAdminAuth(req) {
  const apiKey = getRequestApiKey(req);
  if (!ADMIN_API_KEY) {
    return { ok: false, reason: 'ADMIN_API_KEY is not configured' };
  }

  if (apiKey !== ADMIN_API_KEY) {
    return { ok: false, reason: 'Admin API key required' };
  }

  return { ok: true, maskedKey: maskApiKey(apiKey) };
}

function buildUsageExport() {
  const tenantsUsage = [...usageStats.values()].map((bucket) => ({
    ...bucket,
    estimatedBillableUnits:
      (bucket.sessionsCreated || 0) * 5 +
      (bucket.ticksRequested || 0) * 0.1 +
      (bucket.languageScriptsApplied || 0) * 2 +
      ((bucket.eventsTriggered || 0) + (bucket.actionsApplied || 0) + (bucket.deceptionChanges || 0)) * 0.5,
  }));

  const totals = tenantsUsage.reduce((acc, bucket) => {
    acc.requests += bucket.requests || 0;
    acc.sessionsCreated += bucket.sessionsCreated || 0;
    acc.sessionsDeleted += bucket.sessionsDeleted || 0;
    acc.ticksRequested += bucket.ticksRequested || 0;
    acc.eventsTriggered += bucket.eventsTriggered || 0;
    acc.actionsApplied += bucket.actionsApplied || 0;
    acc.deceptionChanges += bucket.deceptionChanges || 0;
    acc.languageScriptsApplied += bucket.languageScriptsApplied || 0;
    acc.bytesIn += bucket.bytesIn || 0;
    acc.estimatedBillableUnits += bucket.estimatedBillableUnits || 0;
    return acc;
  }, {
    requests: 0,
    sessionsCreated: 0,
    sessionsDeleted: 0,
    ticksRequested: 0,
    eventsTriggered: 0,
    actionsApplied: 0,
    deceptionChanges: 0,
    languageScriptsApplied: 0,
    bytesIn: 0,
    estimatedBillableUnits: 0,
  });

  return {
    generatedAt: new Date().toISOString(),
    tenantCount: tenantsUsage.length,
    totals,
    tenants: tenantsUsage,
  };
}

function getPricingPlan(planId) {
  return (pricingConfig.monthly_plans || []).find((plan) => plan.id === planId) || null;
}

function estimateBillableUnits(usage = {}) {
  const formula = pricingConfig.billable_units_formula || {};
  return (
    (Number(usage.sessionsCreated || 0) * Number(formula.sessions_created_weight || 0)) +
    (Number(usage.ticksRequested || 0) * Number(formula.ticks_requested_weight || 0)) +
    (Number(usage.languageScriptsApplied || 0) * Number(formula.language_scripts_applied_weight || 0)) +
    (
      Number((usage.eventsTriggered || 0)) +
      Number((usage.actionsApplied || 0)) +
      Number((usage.deceptionChanges || 0))
    ) * Number(formula.events_actions_deception_weight || 0)
  );
}

function buildQuoteFromUsage(input = {}) {
  const usage = input.usage || {};
  const planId = input.planId || null;
  const plan = planId ? getPricingPlan(planId) : null;
  const estimatedUnits = estimateBillableUnits(usage);
  const includedUnits = Number(plan?.billable_units_included || 0);
  const overageUnits = Math.max(0, estimatedUnits - includedUnits);
  const overagePricePer1000 = Number(pricingConfig.overage?.price_thb_per_1000_units || 0);
  const overageCharge = (overageUnits / 1000) * overagePricePer1000;
  const baseMonthly = Number(plan?.price_thb_monthly || 0);
  const subtotal = baseMonthly + overageCharge;

  return {
    currency: pricingConfig.currency || 'THB',
    vatIncluded: Boolean(pricingConfig.vat_included),
    planId,
    planName: plan?.name || null,
    estimatedBillableUnits: estimatedUnits,
    includedUnits,
    overageUnits,
    overagePricePer1000Units: overagePricePer1000,
    baseMonthlyPrice: baseMonthly,
    overageCharge,
    subtotal,
    usageBreakdown: usage,
  };
}

function buildInvoiceSummary(input = {}) {
  const tenantId = input.tenantId ? String(input.tenantId) : null;
  const usage = input.usage || (tenantId ? getUsageBucket(tenantId) : null);
  const tenant = tenantId ? [...tenants.values()].find((entry) => entry.id === tenantId) : null;
  const planId = input.planId || tenant?.plan || null;
  const quote = buildQuoteFromUsage({ planId, usage });
  const issueDate = input.issueDate || new Date().toISOString();
  const billingPeriod = input.billingPeriod || {
    label: new Date().toISOString().slice(0, 7),
  };

  return {
    invoiceId: input.invoiceId || `INV-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${tenantId || 'CUSTOM'}`,
    issueDate,
    billingPeriod,
    tenantId,
    customerName: input.customerName || tenantId || 'Custom customer',
    planId: quote.planId,
    planName: quote.planName,
    currency: quote.currency,
    vatIncluded: quote.vatIncluded,
    lineItems: [
      {
        type: 'subscription',
        description: quote.planName ? `${quote.planName} monthly subscription` : 'Custom usage quote',
        amount: quote.baseMonthlyPrice,
      },
      {
        type: 'overage',
        description: `Overage ${quote.overageUnits} units`,
        amount: quote.overageCharge,
      },
    ],
    usage: quote.usageBreakdown,
    estimatedBillableUnits: quote.estimatedBillableUnits,
    includedUnits: quote.includedUnits,
    overageUnits: quote.overageUnits,
    subtotal: quote.subtotal,
    total: quote.subtotal,
  };
}

function resolveTenantBillingWebhookUrl(tenant) {
  if (!tenant) {
    return '';
  }
  return String(tenant.billingWebhookUrl || tenant.metadata?.billingWebhookUrl || '').trim();
}

async function postWebhook(url, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return {
      ok: response.ok,
      status: response.status,
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function notifyTenantBillingWebhook(tenant, eventType, payload) {
  const url = resolveTenantBillingWebhookUrl(tenant);
  if (!url) {
    return { delivered: false, reason: 'billing webhook is not configured' };
  }

  const response = await postWebhook(url, {
    event: eventType,
    tenantId: tenant.id,
    tenantName: tenant.name,
    sentAt: new Date().toISOString(),
    payload,
  });

  return {
    delivered: response.ok,
    status: response.status || null,
    error: response.error || null,
  };
}

function maybeTriggerUsageThresholdWebhook(tenant, usageBucket) {
  if (!tenant) {
    return;
  }

  const plan = getPricingPlan(tenant.plan);
  const includedUnits = Number(plan?.billable_units_included || 0);
  if (!includedUnits) {
    return;
  }

  const estimatedUnits = estimateBillableUnits(usageBucket);
  const usageRatio = estimatedUnits / includedUnits;
  if (usageRatio < BILLING_WEBHOOK_USAGE_THRESHOLD) {
    return;
  }

  const state = billingWebhookState.get(tenant.id) || {};
  if (state.usageThresholdTriggered) {
    return;
  }

  state.usageThresholdTriggered = true;
  billingWebhookState.set(tenant.id, state);

  void notifyTenantBillingWebhook(tenant, 'billing.usage_threshold', {
    planId: tenant.plan,
    estimatedBillableUnits: estimatedUnits,
    includedUnits,
    usageRatio,
    threshold: BILLING_WEBHOOK_USAGE_THRESHOLD,
    usage: usageBucket,
  });
}

function writeInvoiceSummaryFile(invoice) {
  const safeInvoiceId = String(invoice.invoiceId).replace(/[^A-Za-z0-9_-]/g, '_');
  const filePath = path.join(BILLING_DIR, `${safeInvoiceId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(invoice, null, 2), 'utf8');
  return filePath;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildInvoiceHtml(invoice) {
  const lineItems = (invoice.lineItems || [])
    .map((item) => `
      <tr>
        <td>${escapeHtml(item.type)}</td>
        <td>${escapeHtml(item.description)}</td>
        <td class="num">${Number(item.amount || 0).toFixed(2)}</td>
      </tr>
    `)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(invoice.invoiceId)}</title>
  <style>
    :root { color-scheme: light; --ink:#152033; --muted:#5d6b82; --line:#d8dee8; --bg:#f5f7fb; --card:#ffffff; --accent:#0f766e; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; background: linear-gradient(180deg, #eef4f8, #f8fafc); color: var(--ink); }
    .wrap { max-width: 960px; margin: 0 auto; padding: 32px 20px 48px; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 20px; padding: 28px; box-shadow: 0 18px 60px rgba(21,32,51,.08); }
    .hero { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; margin-bottom: 28px; }
    .brand { font-size: 30px; font-weight: 700; letter-spacing: -.02em; }
    .muted { color: var(--muted); }
    .pill { display:inline-block; padding:8px 12px; border-radius:999px; background:#e6fffb; color:var(--accent); font-weight:600; }
    .grid { display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap:16px; margin-bottom: 24px; }
    .stat { padding:16px; border-radius:16px; background: var(--bg); border:1px solid var(--line); }
    .label { font-size:12px; text-transform:uppercase; letter-spacing:.08em; color: var(--muted); margin-bottom:8px; }
    .value { font-size:24px; font-weight:700; }
    table { width:100%; border-collapse: collapse; margin-top: 8px; }
    th, td { text-align:left; padding:12px 10px; border-bottom:1px solid var(--line); vertical-align: top; }
    .num { text-align:right; font-variant-numeric: tabular-nums; }
    .footer { margin-top: 24px; color: var(--muted); font-size: 13px; }
    @media (max-width: 700px) { .hero { flex-direction: column; } .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="hero">
        <div>
          <div class="brand">Human Sim Rental API</div>
          <div class="muted">Invoice Summary</div>
        </div>
        <div>
          <div class="pill">${escapeHtml(invoice.planName || 'Custom')}</div>
          <div class="muted" style="margin-top:10px;">${escapeHtml(invoice.invoiceId)}</div>
        </div>
      </div>

      <div class="grid">
        <div class="stat">
          <div class="label">Customer</div>
          <div class="value" style="font-size:20px;">${escapeHtml(invoice.customerName)}</div>
          <div class="muted">${escapeHtml(invoice.tenantId || '-')}</div>
        </div>
        <div class="stat">
          <div class="label">Billing Period</div>
          <div class="value" style="font-size:20px;">${escapeHtml(invoice.billingPeriod?.label || '-')}</div>
          <div class="muted">${escapeHtml(invoice.issueDate)}</div>
        </div>
        <div class="stat">
          <div class="label">Total</div>
          <div class="value">${Number(invoice.total || 0).toFixed(2)} ${escapeHtml(invoice.currency || 'THB')}</div>
          <div class="muted">${invoice.vatIncluded ? 'VAT included' : 'VAT excluded'}</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Description</th>
            <th class="num">Amount</th>
          </tr>
        </thead>
        <tbody>${lineItems}</tbody>
      </table>

      <div class="grid" style="margin-top:24px;">
        <div class="stat">
          <div class="label">Estimated Units</div>
          <div class="value">${Number(invoice.estimatedBillableUnits || 0).toFixed(2)}</div>
        </div>
        <div class="stat">
          <div class="label">Included Units</div>
          <div class="value">${Number(invoice.includedUnits || 0).toFixed(2)}</div>
        </div>
        <div class="stat">
          <div class="label">Overage Units</div>
          <div class="value">${Number(invoice.overageUnits || 0).toFixed(2)}</div>
        </div>
      </div>

      <div class="footer">Generated by Human Sim Rental API billing module.</div>
    </div>
  </div>
</body>
</html>`;
}

function writeInvoiceHtmlFile(invoice) {
  const safeInvoiceId = String(invoice.invoiceId).replace(/[^A-Za-z0-9_-]/g, '_');
  const filePath = path.join(BILLING_DIR, `${safeInvoiceId}.html`);
  fs.writeFileSync(filePath, buildInvoiceHtml(invoice), 'utf8');
  return filePath;
}

function sanitizePdfText(value) {
  return String(value ?? '')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function buildInvoicePdf(invoice) {
  const lines = [
    'Human Sim Rental API',
    'Invoice Summary',
    '',
    `Invoice ID: ${invoice.invoiceId}`,
    `Customer: ${invoice.customerName}`,
    `Tenant ID: ${invoice.tenantId || '-'}`,
    `Plan: ${invoice.planName || invoice.planId || 'Custom'}`,
    `Billing Period: ${invoice.billingPeriod?.label || '-'}`,
    `Issue Date: ${invoice.issueDate}`,
    '',
    'Line Items:',
    ...(invoice.lineItems || []).map((item) => `- ${item.description}: ${Number(item.amount || 0).toFixed(2)} ${invoice.currency || 'THB'}`),
    '',
    `Estimated Units: ${Number(invoice.estimatedBillableUnits || 0).toFixed(2)}`,
    `Included Units: ${Number(invoice.includedUnits || 0).toFixed(2)}`,
    `Overage Units: ${Number(invoice.overageUnits || 0).toFixed(2)}`,
    `Total: ${Number(invoice.total || 0).toFixed(2)} ${invoice.currency || 'THB'}`,
  ];

  const content = [
    'BT',
    '/F1 12 Tf',
    '50 790 Td',
    '16 TL',
    ...lines.map((line, index) => `${index === 0 ? '' : 'T* ' }(${sanitizePdfText(line)}) Tj`.trim()),
    'ET',
  ].join('\n');

  const objects = [
    null,
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = Buffer.byteLength(pdf, 'utf8');
    pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += '0000000000 65535 f \n';
  for (let index = 1; index < objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

function writeInvoicePdfFile(invoice) {
  const safeInvoiceId = String(invoice.invoiceId).replace(/[^A-Za-z0-9_-]/g, '_');
  const filePath = path.join(BILLING_DIR, `${safeInvoiceId}.pdf`);
  fs.writeFileSync(filePath, buildInvoicePdf(invoice));
  return filePath;
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (text.includes('"') || text.includes(',') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildUsageExportCsv(exportData) {
  const headers = [
    'tenantId',
    'requests',
    'sessionsCreated',
    'sessionsDeleted',
    'ticksRequested',
    'eventsTriggered',
    'actionsApplied',
    'deceptionChanges',
    'languageScriptsApplied',
    'bytesIn',
    'estimatedBillableUnits',
    'lastRequestAt',
  ];
  const rows = [headers.join(',')];
  for (const tenant of exportData.tenants) {
    rows.push(headers.map((header) => csvEscape(tenant[header] ?? '')).join(','));
  }
  return rows.join('\n');
}

function writeBillingExportFiles() {
  const exportData = buildUsageExport();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(BILLING_DIR, `usage-export-${stamp}.json`);
  const csvPath = path.join(BILLING_DIR, `usage-export-${stamp}.csv`);

  fs.writeFileSync(jsonPath, JSON.stringify(exportData, null, 2), 'utf8');
  fs.writeFileSync(csvPath, buildUsageExportCsv(exportData), 'utf8');

  return {
    generatedAt: exportData.generatedAt,
    jsonPath,
    csvPath,
  };
}

function enforceRateLimit(auth) {
  if (!auth?.tenant) {
    return { ok: true, remaining: Infinity, limit: Infinity, resetAt: null };
  }

  const tenantId = auth.tenant.id;
  const limit = Number(auth.tenant.rateLimitPerWindow || DEFAULT_RATE_LIMIT_PER_WINDOW);
  const now = Date.now();
  const bucket = rateLimitBuckets.get(tenantId) || {
    count: 0,
    windowStartedAt: now,
  };

  if (now - bucket.windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
    bucket.count = 0;
    bucket.windowStartedAt = now;
  }

  if (bucket.count >= limit) {
    rateLimitBuckets.set(tenantId, bucket);
    return {
      ok: false,
      remaining: 0,
      limit,
      resetAt: new Date(bucket.windowStartedAt + RATE_LIMIT_WINDOW_MS).toISOString(),
    };
  }

  bucket.count += 1;
  rateLimitBuckets.set(tenantId, bucket);
  return {
    ok: true,
    remaining: Math.max(0, limit - bucket.count),
    limit,
    resetAt: new Date(bucket.windowStartedAt + RATE_LIMIT_WINDOW_MS).toISOString(),
  };
}

function createRuntime() {
  const sandbox = {
    module: { exports: {} },
    exports: {},
    require,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date,
    Math,
    localStorage: createMemoryStorage(),
  };

  sandbox.globalThis = sandbox;
  sandbox.global = sandbox;
  sandbox.window = undefined;

  vm.createContext(sandbox);
  vm.runInContext(SIM_SOURCE, sandbox, { filename: SIM_PATH });

  const runtime = sandbox.module.exports;
  if (!runtime || !runtime.HumanSim) {
    throw new Error('Failed to initialize HumanSim runtime');
  }

  runtime.HumanSim.reset();
  return runtime;
}

function json(res, statusCode, payload, context = null) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
  if (context) {
    recordAccessLog(context, statusCode, context.bodyBytes || 0);
  }
}

function notFound(res, context = null) {
  json(res, 404, { error: 'Not found' }, context);
}

function unauthorized(res, context = null, message = 'Unauthorized') {
  json(res, 401, { error: message }, context);
}

function badRequest(res, message, context = null) {
  json(res, 400, { error: message }, context);
}

function tooManyRequests(res, payload, context = null) {
  json(res, 429, payload, context);
}

function sessionStorePath(sessionId) {
  return path.join(SESSION_STORE_DIR, `${sessionId}.json`);
}

function redisSessionKey(sessionId) {
  return `human-sim:session:${sessionId}`;
}

function buildSessionPersistencePayload(session) {
  return {
    id: session.id,
    label: session.label || null,
    tenantId: session.tenantId,
    tenantName: session.tenantName || null,
    createdAt: session.createdAt,
    lastAccessedAt: session.lastAccessedAt,
    languageContext: session.languageContext || {},
    strictMode: session.strictMode || 'warn',
    runtimeConfig: session.runtimeConfig || {},
    autoSavePolicy: session.autoSavePolicy || {},
    pendingMutations: Number(session.pendingMutations || 0),
    lastSavedAt: Number(session.lastSavedAt || 0),
    snapshot: session.runtime.HumanSim.snapshot(),
    memory: session.runtime.HumanSim.getMemory(),
    personality: session.runtime.HumanSim.getPersonality(),
    context: session.runtime.HumanSim.getContext(),
  };
}

function saveSessionToDisk(session) {
  const payload = buildSessionPersistencePayload(session);
  const filePath = sessionStorePath(session.id);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return { filePath, payload };
}

async function saveSession(session) {
  const disk = saveSessionToDisk(session);
  if (!redisStore) {
    return { provider: 'file', ...disk };
  }

  try {
    await redisStore.set(redisSessionKey(session.id), JSON.stringify(disk.payload));
    return { provider: 'redis+file', ...disk };
  } catch (error) {
    serviceMetrics.redisErrorsTotal += 1;
    return { provider: 'file-fallback', error: error.message, ...disk };
  }
}

function restoreSessionFromPayload(payload) {
  const runtime = createRuntime();
  const sim = runtime.HumanSim;
  sim.reset();

  if (payload.personality) sim.setPersonality(payload.personality);
  if (payload.context) sim.setContext(payload.context);

  const runtimeConfig = payload.runtimeConfig || {};
  if (runtimeConfig.taskDifficulty != null) sim.setTaskDifficulty(runtimeConfig.taskDifficulty);
  if (runtimeConfig.timePressure != null) sim.setTimePressure(runtimeConfig.timePressure);
  if (runtimeConfig.taskType) sim.setTaskType(runtimeConfig.taskType);
  if (runtimeConfig.socialContext) sim.setSocialContext(runtimeConfig.socialContext);
  if (runtimeConfig.socialStakes != null) sim.setSocialStakes(runtimeConfig.socialStakes);
  if (runtimeConfig.audienceSize != null) sim.setAudienceSize(runtimeConfig.audienceSize);

  if (payload.snapshot?.state) {
    sim.force(payload.snapshot.state);
  }

  return {
    id: payload.id,
    runtime,
    createdAt: payload.createdAt || Date.now(),
    lastAccessedAt: Date.now(),
    label: payload.label || null,
    tenantId: payload.tenantId || 'default',
    tenantName: payload.tenantName || 'default',
    languageContext: payload.languageContext || {},
    strictMode: payload.strictMode || 'warn',
    runtimeConfig,
    autoSavePolicy: payload.autoSavePolicy || {},
    pendingMutations: Number(payload.pendingMutations || 0),
    lastSavedAt: Number(payload.lastSavedAt || 0),
    restoredFromDisk: true,
  };
}

function loadSessionFromDisk(sessionId) {
  const filePath = sessionStorePath(sessionId);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const payload = safeReadJson(filePath, null);
  if (!payload) {
    return null;
  }

  const session = restoreSessionFromPayload(payload);
  serviceMetrics.restoresTotal += 1;
  sessions.set(session.id, session);
  return session;
}

async function loadSessionFromStore(sessionId) {
  if (redisStore) {
    try {
      const payloadString = await redisStore.get(redisSessionKey(sessionId));
      if (payloadString) {
        const payload = JSON.parse(payloadString);
        const session = restoreSessionFromPayload(payload);
        serviceMetrics.restoresTotal += 1;
        sessions.set(session.id, session);
        return session;
      }
    } catch (error) {
      serviceMetrics.redisErrorsTotal += 1;
    }
  }

  return loadSessionFromDisk(sessionId);
}

async function getSession(sessionId) {
  let session = sessions.get(sessionId);
  if (!session) {
    session = await loadSessionFromStore(sessionId);
  }
  if (!session) {
    return null;
  }

  if (Date.now() - session.lastAccessedAt > SESSION_TTL_MS) {
    destroySession(sessionId);
    return null;
  }

  session.lastAccessedAt = Date.now();
  return session;
}

function destroySession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    return false;
  }

  if (session.runtime?.DeceptionEngine?.stopAuto) {
    session.runtime.DeceptionEngine.stopAuto();
  }

  sessions.delete(sessionId);
  return true;
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let received = 0;

    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        reject(new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes`));
        req.destroy();
        return;
      }

      body += chunk;
    });

    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

function applySessionConfig(sim, body) {
  if (body.personality) {
    sim.setPersonality(body.personality);
  }

  if (body.context) {
    sim.setContext(body.context);
  }

  if (body.taskDifficulty != null) {
    sim.setTaskDifficulty(Number(body.taskDifficulty));
  }

  if (body.timePressure != null) {
    sim.setTimePressure(Number(body.timePressure));
  }

  if (body.taskType) {
    sim.setTaskType(String(body.taskType));
  }

  if (body.socialContext) {
    sim.setSocialContext(String(body.socialContext));
  }

  if (body.socialStakes != null) {
    sim.setSocialStakes(Number(body.socialStakes));
  }

  if (body.audienceSize != null) {
    sim.setAudienceSize(Number(body.audienceSize));
  }
}

function updateSessionRuntimeConfig(session, body) {
  session.runtimeConfig = session.runtimeConfig || {};

  if (body.taskDifficulty != null) session.runtimeConfig.taskDifficulty = Number(body.taskDifficulty);
  if (body.timePressure != null) session.runtimeConfig.timePressure = Number(body.timePressure);
  if (body.taskType) session.runtimeConfig.taskType = String(body.taskType);
  if (body.socialContext) session.runtimeConfig.socialContext = String(body.socialContext);
  if (body.socialStakes != null) session.runtimeConfig.socialStakes = Number(body.socialStakes);
  if (body.audienceSize != null) session.runtimeConfig.audienceSize = Number(body.audienceSize);
  if (body.personality) session.runtimeConfig.personality = body.personality;
  if (body.context) session.runtimeConfig.context = body.context;
  if (body.strictMode) session.strictMode = String(body.strictMode);
  if (body.autoSavePolicy) {
    session.autoSavePolicy = {
      everyMutations: Math.max(1, Number(body.autoSavePolicy.everyMutations || AUTO_SAVE_EVERY_MUTATIONS)),
      minIntervalMs: Math.max(0, Number(body.autoSavePolicy.minIntervalMs || 0)),
    };
  }
}

async function maybeAutoSaveSession(session, options = {}) {
  if (!AUTO_SAVE_SESSIONS || !session) {
    return null;
  }

  const policy = {
    everyMutations: Math.max(1, Number(session.autoSavePolicy?.everyMutations || AUTO_SAVE_EVERY_MUTATIONS)),
    minIntervalMs: Math.max(0, Number(session.autoSavePolicy?.minIntervalMs || AUTO_SAVE_MIN_INTERVAL_MS)),
  };
  const mutationWeight = Number(options.mutationWeight || 0);
  const force = options.force === true;
  const now = Date.now();

  session.pendingMutations = Number(session.pendingMutations || 0) + mutationWeight;
  const timeSinceLastSave = now - Number(session.lastSavedAt || 0);
  const shouldSave = force || (session.pendingMutations >= policy.everyMutations && timeSinceLastSave >= policy.minIntervalMs);
  if (!shouldSave) {
    return {
      skipped: true,
      pendingMutations: session.pendingMutations,
      policy,
    };
  }

  serviceMetrics.autosavesTotal += 1;
  const saved = await saveSession(session);
  session.pendingMutations = 0;
  session.lastSavedAt = now;
  return saved;
}

function buildPrometheusMetrics() {
  const lines = [
    '# HELP human_sim_requests_total Total HTTP requests handled',
    '# TYPE human_sim_requests_total counter',
    `human_sim_requests_total ${serviceMetrics.requestsTotal}`,
    '# HELP human_sim_errors_total Total HTTP 5xx responses',
    '# TYPE human_sim_errors_total counter',
    `human_sim_errors_total ${serviceMetrics.errorsTotal}`,
    '# HELP human_sim_sessions_active Active in-memory sessions',
    '# TYPE human_sim_sessions_active gauge',
    `human_sim_sessions_active ${sessions.size}`,
    '# HELP human_sim_sessions_created_total Total sessions created',
    '# TYPE human_sim_sessions_created_total counter',
    `human_sim_sessions_created_total ${serviceMetrics.sessionsCreatedTotal}`,
    '# HELP human_sim_sessions_deleted_total Total sessions deleted',
    '# TYPE human_sim_sessions_deleted_total counter',
    `human_sim_sessions_deleted_total ${serviceMetrics.sessionsDeletedTotal}`,
    '# HELP human_sim_session_restores_total Total sessions restored from disk',
    '# TYPE human_sim_session_restores_total counter',
    `human_sim_session_restores_total ${serviceMetrics.restoresTotal}`,
    '# HELP human_sim_rate_limited_total Total rate-limited requests',
    '# TYPE human_sim_rate_limited_total counter',
    `human_sim_rate_limited_total ${serviceMetrics.rateLimitedTotal}`,
    '# HELP human_sim_foundation_validation_ok Whether foundation validation passes',
    '# TYPE human_sim_foundation_validation_ok gauge',
    `human_sim_foundation_validation_ok ${foundationValidation.ok ? 1 : 0}`,
    '# HELP human_sim_tenants_configured Total configured tenants',
    '# TYPE human_sim_tenants_configured gauge',
    `human_sim_tenants_configured ${tenants.size}`,
    '# HELP human_sim_redis_enabled Whether Redis persistence is enabled',
    '# TYPE human_sim_redis_enabled gauge',
    `human_sim_redis_enabled ${serviceMetrics.redisEnabled}`,
    '# HELP human_sim_redis_errors_total Total Redis persistence errors',
    '# TYPE human_sim_redis_errors_total counter',
    `human_sim_redis_errors_total ${serviceMetrics.redisErrorsTotal}`,
  ];

  return `${lines.join('\n')}\n`;
}

function buildTickPayload(session, tickCount, includeBio, includeEeg) {
  const sim = session.runtime.HumanSim;
  let bio = null;
  let eeg = null;
  let artifactCheck = null;

  for (let index = 0; index < tickCount; index += 1) {
    sim.tick();
  }

  if (includeBio) {
    bio = sim.generateBio();
  }

  if (includeEeg) {
    eeg = sim.generateEEGBands();
  }

  if (bio && eeg && session.runtime.ArtifactDetector?.check) {
    artifactCheck = session.runtime.ArtifactDetector.check(bio, eeg);
  }

  return {
    sessionId: session.id,
    state: sim.getState(),
    displayedEmotion: sim.getDisplayedEmotion(),
    cognitiveLoad: sim.getCognitiveLoad(),
    bio,
    eeg,
    artifactCheck,
    snapshot: sim.snapshot(),
  };
}

function authenticateRequest(req) {
  const apiKey = getRequestApiKey(req);

  if (tenants.size > 0) {
    const tenant = tenants.get(apiKey);
    if (!tenant || !tenant.active) {
      return { ok: false, reason: 'Invalid or inactive tenant API key' };
    }

    return {
      ok: true,
      mode: 'tenant',
      apiKey,
      tenant,
      maskedKey: maskApiKey(apiKey),
    };
  }

  if (!API_KEY) {
    return { ok: true, mode: 'open', apiKey: '', tenant: null, maskedKey: '' };
  }

  if (apiKey === API_KEY) {
    return {
      ok: true,
      mode: 'single',
      apiKey,
      tenant: {
        id: 'default',
        name: 'default',
        plan: 'basic',
        maxSessions: MAX_SESSIONS,
      },
      maskedKey: maskApiKey(apiKey),
    };
  }

  return { ok: false, reason: 'Unauthorized' };
}

function getRouteMatch(pathname, pattern) {
  const pathParts = pathname.split('/').filter(Boolean);
  const patternParts = pattern.split('/').filter(Boolean);

  if (pathParts.length !== patternParts.length) {
    return null;
  }

  const params = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const patternPart = patternParts[index];
    const pathPart = pathParts[index];

    if (patternPart.startsWith(':')) {
      params[patternPart.slice(1)] = pathPart;
      continue;
    }

    if (patternPart !== pathPart) {
      return null;
    }
  }

  return params;
}

function collectSessionStats() {
  const now = Date.now();
  return {
    activeSessions: sessions.size,
    maxSessions: MAX_SESSIONS,
    ttlMs: SESSION_TTL_MS,
    authEnabled: Boolean(API_KEY) || tenants.size > 0,
    adminAuthEnabled: Boolean(ADMIN_API_KEY),
    tenantMode: tenants.size > 0,
    tenantCount: tenants.size,
    autoSaveSessions: AUTO_SAVE_SESSIONS,
    autoSaveEveryMutations: AUTO_SAVE_EVERY_MUTATIONS,
    autoSaveMinIntervalMs: AUTO_SAVE_MIN_INTERVAL_MS,
    strictBootstrapValidation: STRICT_BOOTSTRAP_VALIDATION,
    phasaTawanDefaultStrictMode: PHASA_TAWAN_DEFAULT_STRICT_MODE,
    defaultRateLimitPerWindow: DEFAULT_RATE_LIMIT_PER_WINDOW,
    rateLimitWindowMs: RATE_LIMIT_WINDOW_MS,
    corsEnabled: Boolean(CORS_ALLOW_ORIGIN),
    uptimeSec: Math.floor((now - startedAt) / 1000),
  };
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const context = {
    req,
    pathname,
    bodyBytes: Number(req.headers['content-length'] || 0),
    auth: null,
    sessionId: null,
    requestId: req.headers['x-request-id'] || crypto.randomUUID(),
  };
  serviceMetrics.requestsTotal += 1;
  res.setHeader('X-Request-Id', context.requestId);
  applyCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Content-Length': 0,
      'X-Request-Id': context.requestId,
    });
    res.end();
    recordAccessLog(context, 204, context.bodyBytes || 0);
    return;
  }

  if (req.method === 'GET' && (pathname === '/health' || pathname === '/v1/health')) {
    json(res, 200, {
      ok: true,
      service: 'human-sim-rental-api',
      versionPrefix: '/v1',
      stats: collectSessionStats(),
      now: new Date().toISOString(),
    }, context);
    return;
  }

  if (req.method === 'GET' && (pathname === '/metrics' || pathname === '/v1/metrics')) {
    const metrics = buildPrometheusMetrics();
    res.writeHead(200, {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Content-Length': Buffer.byteLength(metrics),
      'X-Request-Id': context.requestId,
    });
    res.end(metrics);
    recordAccessLog(context, 200, context.bodyBytes || 0);
    return;
  }

  if (req.method === 'GET' && pathname === '/admin') {
    sendFile(res, path.join(PUBLIC_DIR, 'admin.html'), context);
    return;
  }

  if (req.method === 'GET' && pathname === '/admin/app.js') {
    sendFile(res, path.join(PUBLIC_DIR, 'admin-app.js'), context);
    return;
  }

  if (req.method === 'GET' && pathname === '/admin/styles.css') {
    sendFile(res, path.join(PUBLIC_DIR, 'admin.css'), context);
    return;
  }

  if (req.method === 'GET' && pathname === '/hosted') {
    sendFile(res, path.join(__dirname, 'hosted.html'), context);
    return;
  }

  if (req.method === 'GET' && pathname === '/') {
    json(res, 200, {
      service: 'human-sim-rental-api',
      version: '1.0.0',
      endpoints: [
        'GET /v1/health',
        'GET /health (legacy alias)',
        'GET /v1/metrics',
        'GET /metrics (legacy alias)',
        'GET /hosted',
        'GET /v1/tenants/me',
        'GET /v1/phasa-tawan',
        'POST /v1/phasa-tawan/parse',
        'POST /v1/phasa-tawan/evaluate',
        'POST /v1/sessions',
        'GET /v1/sessions/:id',
        'DELETE /v1/sessions/:id',
        'POST /v1/sessions/:id/tick',
        'POST /v1/sessions/:id/event',
        'POST /v1/sessions/:id/config',
        'POST /v1/sessions/:id/action',
        'POST /v1/sessions/:id/deception',
        'POST /v1/sessions/:id/phasa-tawan',
        'GET /v1/sessions/:id/memory',
        'POST /v1/sessions/:id/save',
        'POST /v1/sessions/load',
        'GET /v1/phasa-tawan/validation',
        'GET /v1/admin/usage',
        'GET /v1/admin/usage/export',
        'GET /v1/admin/usage/export.csv',
        'POST /v1/admin/usage/export-file',
        'GET /v1/admin/pricing',
        'POST /v1/admin/billing/quote',
        'POST /v1/admin/billing/invoice-summary',
        'POST /v1/admin/billing/invoice-summary-file',
        'POST /v1/admin/billing/invoice-html-file',
        'POST /v1/admin/billing/invoice-pdf-file',
        'POST /v1/admin/tenants',
        'PATCH /v1/admin/tenants/:id',
      ],
      auth: tenants.size > 0 ? 'tenant Bearer token or x-api-key required' : API_KEY ? 'Bearer token or x-api-key required' : 'disabled',
    }, context);
    return;
  }

  if (req.method === 'GET' && pathname === '/v1/admin/usage') {
    const adminAuth = requireAdminAuth(req);
    if (!adminAuth.ok) {
      unauthorized(res, context, adminAuth.reason);
      return;
    }

    json(res, 200, {
      tenantMode: tenants.size > 0,
      usage: [...usageStats.values()],
    }, context);
    return;
  }

  if (req.method === 'GET' && pathname === '/v1/admin/pricing') {
    const adminAuth = requireAdminAuth(req);
    if (!adminAuth.ok) {
      unauthorized(res, context, adminAuth.reason);
      return;
    }

    json(res, 200, pricingConfig, context);
    return;
  }

  if (req.method === 'POST' && pathname === '/v1/admin/billing/quote') {
    const adminAuth = requireAdminAuth(req);
    if (!adminAuth.ok) {
      unauthorized(res, context, adminAuth.reason);
      return;
    }

    const body = await parseJsonBody(req);
    let usage = body.usage || null;
    const tenant = body.tenantId ? [...tenants.values()].find((entry) => entry.id === String(body.tenantId)) : null;

    if (!usage && body.tenantId) {
      usage = getUsageBucket(String(body.tenantId));
    }

    if (!usage) {
      badRequest(res, '`usage` or `tenantId` is required', context);
      return;
    }

    const quote = buildQuoteFromUsage({
      planId: body.planId || tenant?.plan,
      usage,
    });

    json(res, 200, quote, context);
    return;
  }

  if (req.method === 'POST' && pathname === '/v1/admin/billing/invoice-summary') {
    const adminAuth = requireAdminAuth(req);
    if (!adminAuth.ok) {
      unauthorized(res, context, adminAuth.reason);
      return;
    }

    const body = await parseJsonBody(req);
    if (!body.usage && !body.tenantId) {
      badRequest(res, '`usage` or `tenantId` is required', context);
      return;
    }

    const invoice = buildInvoiceSummary(body);
    const invoiceTenant = invoice.tenantId ? [...tenants.values()].find((entry) => entry.id === invoice.tenantId) : null;
    void notifyTenantBillingWebhook(invoiceTenant, 'billing.invoice_ready', {
      invoice,
      format: 'json',
    });
    json(res, 200, invoice, context);
    return;
  }

  if (req.method === 'POST' && pathname === '/v1/admin/billing/invoice-summary-file') {
    const adminAuth = requireAdminAuth(req);
    if (!adminAuth.ok) {
      unauthorized(res, context, adminAuth.reason);
      return;
    }

    const body = await parseJsonBody(req);
    if (!body.usage && !body.tenantId) {
      badRequest(res, '`usage` or `tenantId` is required', context);
      return;
    }

    const invoice = buildInvoiceSummary(body);
    const filePath = writeInvoiceSummaryFile(invoice);
    const invoiceTenant = invoice.tenantId ? [...tenants.values()].find((entry) => entry.id === invoice.tenantId) : null;
    void notifyTenantBillingWebhook(invoiceTenant, 'billing.invoice_ready', {
      invoice,
      format: 'json-file',
      filePath,
    });
    json(res, 201, {
      success: true,
      filePath,
      invoice,
    }, context);
    return;
  }

  if (req.method === 'POST' && pathname === '/v1/admin/billing/invoice-html-file') {
    const adminAuth = requireAdminAuth(req);
    if (!adminAuth.ok) {
      unauthorized(res, context, adminAuth.reason);
      return;
    }

    const body = await parseJsonBody(req);
    if (!body.usage && !body.tenantId) {
      badRequest(res, '`usage` or `tenantId` is required', context);
      return;
    }

    const invoice = buildInvoiceSummary(body);
    const jsonFilePath = writeInvoiceSummaryFile(invoice);
    const htmlFilePath = writeInvoiceHtmlFile(invoice);
    const invoiceTenant = invoice.tenantId ? [...tenants.values()].find((entry) => entry.id === invoice.tenantId) : null;
    void notifyTenantBillingWebhook(invoiceTenant, 'billing.invoice_ready', {
      invoice,
      format: 'html',
      jsonFilePath,
      htmlFilePath,
    });
    json(res, 201, {
      success: true,
      jsonFilePath,
      htmlFilePath,
      invoice,
    }, context);
    return;
  }

  if (req.method === 'POST' && pathname === '/v1/admin/billing/invoice-pdf-file') {
    const adminAuth = requireAdminAuth(req);
    if (!adminAuth.ok) {
      unauthorized(res, context, adminAuth.reason);
      return;
    }

    const body = await parseJsonBody(req);
    if (!body.usage && !body.tenantId) {
      badRequest(res, '`usage` or `tenantId` is required', context);
      return;
    }

    const invoice = buildInvoiceSummary(body);
    const jsonFilePath = writeInvoiceSummaryFile(invoice);
    const pdfFilePath = writeInvoicePdfFile(invoice);
    const invoiceTenant = invoice.tenantId ? [...tenants.values()].find((entry) => entry.id === invoice.tenantId) : null;
    void notifyTenantBillingWebhook(invoiceTenant, 'billing.invoice_ready', {
      invoice,
      format: 'pdf',
      jsonFilePath,
      pdfFilePath,
    });
    json(res, 201, {
      success: true,
      jsonFilePath,
      pdfFilePath,
      invoice,
    }, context);
    return;
  }

  if (req.method === 'GET' && pathname === '/v1/phasa-tawan/validation') {
    json(res, 200, phasaTawan.validateFoundationSync(), context);
    return;
  }

  if (req.method === 'GET' && pathname === '/v1/admin/usage/export') {
    const adminAuth = requireAdminAuth(req);
    if (!adminAuth.ok) {
      unauthorized(res, context, adminAuth.reason);
      return;
    }

    json(res, 200, buildUsageExport(), context);
    return;
  }

  if (req.method === 'GET' && pathname === '/v1/admin/usage/export.csv') {
    const adminAuth = requireAdminAuth(req);
    if (!adminAuth.ok) {
      unauthorized(res, context, adminAuth.reason);
      return;
    }

    const csv = buildUsageExportCsv(buildUsageExport());
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Length': Buffer.byteLength(csv),
    });
    res.end(csv);
    recordAccessLog(context, 200, context.bodyBytes || 0);
    return;
  }

  if (req.method === 'POST' && pathname === '/v1/admin/usage/export-file') {
    const adminAuth = requireAdminAuth(req);
    if (!adminAuth.ok) {
      unauthorized(res, context, adminAuth.reason);
      return;
    }

    json(res, 201, {
      success: true,
      files: writeBillingExportFiles(),
    }, context);
    return;
  }

  if (req.method === 'POST' && pathname === '/v1/admin/tenants') {
    const adminAuth = requireAdminAuth(req);
    if (!adminAuth.ok) {
      unauthorized(res, context, adminAuth.reason);
      return;
    }

    const body = await parseJsonBody(req);
    if (!body.id || !body.apiKey) {
      badRequest(res, '`id` and `apiKey` are required', context);
      return;
    }

    if ([...tenants.values()].some((tenant) => tenant.id === String(body.id))) {
      badRequest(res, 'Tenant id already exists', context);
      return;
    }

    if (tenants.has(String(body.apiKey))) {
      badRequest(res, 'Tenant apiKey already exists', context);
      return;
    }

    const tenant = {
      id: String(body.id),
      name: String(body.name || body.id),
      apiKey: String(body.apiKey),
      active: body.active !== false,
      plan: String(body.plan || 'basic'),
      maxSessions: Number(body.maxSessions || MAX_SESSIONS),
      rateLimitPerWindow: Number(body.rateLimitPerWindow || DEFAULT_RATE_LIMIT_PER_WINDOW),
      billingWebhookUrl: body.billingWebhookUrl ? String(body.billingWebhookUrl) : '',
      metadata: body.metadata || {},
    };

    tenants.set(tenant.apiKey, tenant);
    saveTenantRegistry();
    json(res, 201, {
      success: true,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        active: tenant.active,
        plan: tenant.plan,
        maxSessions: tenant.maxSessions,
        rateLimitPerWindow: tenant.rateLimitPerWindow,
        billingWebhookUrl: tenant.billingWebhookUrl || '',
      },
    }, context);
    return;
  }

  let adminParams = getRouteMatch(pathname, '/v1/admin/tenants/:id');
  if (req.method === 'PATCH' && adminParams) {
    const adminAuth = requireAdminAuth(req);
    if (!adminAuth.ok) {
      unauthorized(res, context, adminAuth.reason);
      return;
    }

    const existing = [...tenants.values()].find((tenant) => tenant.id === adminParams.id);
    if (!existing) {
      notFound(res, context);
      return;
    }

    const body = await parseJsonBody(req);
    if (body.name != null) existing.name = String(body.name);
    if (body.active != null) existing.active = Boolean(body.active);
    if (body.plan != null) existing.plan = String(body.plan);
    if (body.maxSessions != null) existing.maxSessions = Number(body.maxSessions);
    if (body.rateLimitPerWindow != null) existing.rateLimitPerWindow = Number(body.rateLimitPerWindow);
    if (body.billingWebhookUrl != null) existing.billingWebhookUrl = String(body.billingWebhookUrl || '');
    if (body.metadata != null) existing.metadata = body.metadata;

    if (body.apiKey != null && String(body.apiKey) !== existing.apiKey) {
      if (tenants.has(String(body.apiKey))) {
        badRequest(res, 'Tenant apiKey already exists', context);
        return;
      }
      tenants.delete(existing.apiKey);
      existing.apiKey = String(body.apiKey);
      tenants.set(existing.apiKey, existing);
    }

    saveTenantRegistry();
    json(res, 200, {
      success: true,
      tenant: {
        id: existing.id,
        name: existing.name,
        active: existing.active,
        plan: existing.plan,
        maxSessions: existing.maxSessions,
        rateLimitPerWindow: existing.rateLimitPerWindow,
        billingWebhookUrl: existing.billingWebhookUrl || '',
      },
    }, context);
    return;
  }

  context.auth = authenticateRequest(req);
  if (!context.auth.ok) {
    unauthorized(res, context, context.auth.reason);
    return;
  }

  const rateLimit = enforceRateLimit(context.auth);
  if (!rateLimit.ok) {
    serviceMetrics.rateLimitedTotal += 1;
    tooManyRequests(res, {
      error: 'Rate limit exceeded',
      limit: rateLimit.limit,
      remaining: rateLimit.remaining,
      resetAt: rateLimit.resetAt,
    }, context);
    return;
  }

  if (req.method === 'GET' && pathname === '/v1/tenants/me') {
    const tenant = context.auth.tenant;
    const usage = getUsageBucket(tenant?.id || 'anonymous');
    json(res, 200, {
      tenant: tenant ? {
        id: tenant.id,
        name: tenant.name,
        plan: tenant.plan,
        maxSessions: tenant.maxSessions,
        rateLimitPerWindow: tenant.rateLimitPerWindow,
        apiKeyMasked: context.auth.maskedKey,
        activeSessions: countSessionsForTenant(tenant.id),
      } : null,
      usage,
    }, context);
    return;
  }

  if (req.method === 'POST' && pathname === '/v1/sessions') {
    const tenantLimit = context.auth.tenant?.maxSessions || MAX_SESSIONS;
    const tenantId = context.auth.tenant?.id || 'default';
    if (sessions.size >= MAX_SESSIONS || countSessionsForTenant(tenantId) >= tenantLimit) {
      json(res, 429, { error: 'Session capacity reached' }, context);
      return;
    }

    const body = await parseJsonBody(req);
    const runtime = createRuntime();
    const sim = runtime.HumanSim;
    applySessionConfig(sim, body);

    const sessionId = crypto.randomUUID();
    const session = {
      id: sessionId,
      runtime,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      label: body.label || null,
      tenantId,
      tenantName: context.auth.tenant?.name || 'default',
      strictMode: String(body.strictMode || PHASA_TAWAN_DEFAULT_STRICT_MODE),
      runtimeConfig: {},
      autoSavePolicy: {
        everyMutations: AUTO_SAVE_EVERY_MUTATIONS,
        minIntervalMs: AUTO_SAVE_MIN_INTERVAL_MS,
      },
      pendingMutations: 0,
      lastSavedAt: 0,
    };
    updateSessionRuntimeConfig(session, body);
    sessions.set(sessionId, session);
    context.sessionId = sessionId;
    await maybeAutoSaveSession(session, { force: true });
    serviceMetrics.sessionsCreatedTotal += 1;
    recordUsage(context, { sessionsCreated: 1, bytesIn: context.bodyBytes || 0 });

    json(res, 201, {
      sessionId,
      createdAt: new Date(session.createdAt).toISOString(),
      tenantId,
      strictMode: session.strictMode,
      snapshot: sim.snapshot(),
    }, context);
    return;
  }

  if (req.method === 'GET' && pathname === '/v1/phasa-tawan') {
    recordUsage(context, { bytesIn: context.bodyBytes || 0 });
    json(res, 200, phasaTawan.getFoundationSummary(), context);
    return;
  }

  if (req.method === 'POST' && pathname === '/v1/phasa-tawan/parse') {
    const body = await parseJsonBody(req);
    recordUsage(context, { bytesIn: context.bodyBytes || 0 });
    json(res, 200, phasaTawan.parseScript(body.script || '', { strictMode: body.strictMode || PHASA_TAWAN_DEFAULT_STRICT_MODE }), context);
    return;
  }

  if (req.method === 'POST' && pathname === '/v1/phasa-tawan/evaluate') {
    const body = await parseJsonBody(req);
    recordUsage(context, { bytesIn: context.bodyBytes || 0 });
    json(res, 200, phasaTawan.evaluateSignals(body.input || {}, body.profile || 'gen2'), context);
    return;
  }

  let params = getRouteMatch(pathname, '/v1/sessions/:id');
  if (req.method === 'GET' && params) {
    const session = await getSession(params.id);
    if (!session) {
      notFound(res, context);
      return;
    }
    if (context.auth.tenant && session.tenantId !== context.auth.tenant.id) {
      unauthorized(res, context, 'Session belongs to another tenant');
      return;
    }
    context.sessionId = session.id;
    recordUsage(context, { bytesIn: context.bodyBytes || 0 });

    json(res, 200, {
      sessionId: session.id,
      createdAt: new Date(session.createdAt).toISOString(),
      lastAccessedAt: new Date(session.lastAccessedAt).toISOString(),
      tenantId: session.tenantId,
      strictMode: session.strictMode || PHASA_TAWAN_DEFAULT_STRICT_MODE,
      foundationValidation,
      snapshot: session.runtime.HumanSim.snapshot(),
    }, context);
    return;
  }

  params = getRouteMatch(pathname, '/v1/sessions/:id');
  if (req.method === 'DELETE' && params) {
    const session = await getSession(params.id);
    if (!session) {
      notFound(res, context);
      return;
    }
    if (context.auth.tenant && session.tenantId !== context.auth.tenant.id) {
      unauthorized(res, context, 'Session belongs to another tenant');
      return;
    }
    context.sessionId = session.id;
    destroySession(params.id);
    serviceMetrics.sessionsDeletedTotal += 1;
    recordUsage(context, { sessionsDeleted: 1, bytesIn: context.bodyBytes || 0 });

    json(res, 200, { success: true }, context);
    return;
  }

  params = getRouteMatch(pathname, '/v1/sessions/:id/tick');
  if (req.method === 'POST' && params) {
    const session = await getSession(params.id);
    if (!session) {
      notFound(res, context);
      return;
    }
    if (context.auth.tenant && session.tenantId !== context.auth.tenant.id) {
      unauthorized(res, context, 'Session belongs to another tenant');
      return;
    }
    context.sessionId = session.id;

    const body = await parseJsonBody(req);
    const tickCount = Math.min(Math.max(Number(body.count || 1), 1), 1000);
    const includeBio = body.includeBio !== false;
    const includeEeg = body.includeEeg !== false;
    const payload = buildTickPayload(session, tickCount, includeBio, includeEeg);
    await maybeAutoSaveSession(session, { mutationWeight: 1 });
    recordUsage(context, { ticksRequested: tickCount, bytesIn: context.bodyBytes || 0 });
    json(res, 200, payload, context);
    return;
  }

  params = getRouteMatch(pathname, '/v1/sessions/:id/event');
  if (req.method === 'POST' && params) {
    const session = await getSession(params.id);
    if (!session) {
      notFound(res, context);
      return;
    }
    if (context.auth.tenant && session.tenantId !== context.auth.tenant.id) {
      unauthorized(res, context, 'Session belongs to another tenant');
      return;
    }
    context.sessionId = session.id;

    const body = await parseJsonBody(req);
    if (!body.event) {
      badRequest(res, '`event` is required', context);
      return;
    }

    session.runtime.HumanSim.triggerEvent(String(body.event), Number(body.intensity || 1));
    await maybeAutoSaveSession(session, { mutationWeight: 1 });
    recordUsage(context, { eventsTriggered: 1, bytesIn: context.bodyBytes || 0 });
    json(res, 200, {
      success: true,
      snapshot: session.runtime.HumanSim.snapshot(),
    }, context);
    return;
  }

  params = getRouteMatch(pathname, '/v1/sessions/:id/config');
  if (req.method === 'POST' && params) {
    const session = await getSession(params.id);
    if (!session) {
      notFound(res, context);
      return;
    }
    if (context.auth.tenant && session.tenantId !== context.auth.tenant.id) {
      unauthorized(res, context, 'Session belongs to another tenant');
      return;
    }
    context.sessionId = session.id;

    const body = await parseJsonBody(req);
    applySessionConfig(session.runtime.HumanSim, body);
    updateSessionRuntimeConfig(session, body);
    await maybeAutoSaveSession(session, { mutationWeight: 1 });
    recordUsage(context, { bytesIn: context.bodyBytes || 0 });

    json(res, 200, {
      success: true,
      snapshot: session.runtime.HumanSim.snapshot(),
    }, context);
    return;
  }

  params = getRouteMatch(pathname, '/v1/sessions/:id/action');
  if (req.method === 'POST' && params) {
    const session = await getSession(params.id);
    if (!session) {
      notFound(res, context);
      return;
    }
    if (context.auth.tenant && session.tenantId !== context.auth.tenant.id) {
      unauthorized(res, context, 'Session belongs to another tenant');
      return;
    }
    context.sessionId = session.id;

    const body = await parseJsonBody(req);
    if (!body.action) {
      badRequest(res, '`action` is required', context);
      return;
    }

    const ok = session.runtime.HumanSim.performAction(String(body.action));
    await maybeAutoSaveSession(session, { mutationWeight: 1 });
    recordUsage(context, { actionsApplied: 1, bytesIn: context.bodyBytes || 0 });
    json(res, 200, {
      success: ok,
      snapshot: session.runtime.HumanSim.snapshot(),
    }, context);
    return;
  }

  params = getRouteMatch(pathname, '/v1/sessions/:id/deception');
  if (req.method === 'POST' && params) {
    const session = await getSession(params.id);
    if (!session) {
      notFound(res, context);
      return;
    }
    if (context.auth.tenant && session.tenantId !== context.auth.tenant.id) {
      unauthorized(res, context, 'Session belongs to another tenant');
      return;
    }
    context.sessionId = session.id;

    const body = await parseJsonBody(req);
    const engine = session.runtime.DeceptionEngine;

    if (body.active === false) {
      engine.stopAuto();
      engine.setLevel(0);
    } else if (body.level != null) {
      engine.setLevel(Number(body.level));
    } else {
      badRequest(res, '`level` or `active=false` is required', context);
      return;
    }

    await maybeAutoSaveSession(session, { mutationWeight: 1 });
    recordUsage(context, { deceptionChanges: 1, bytesIn: context.bodyBytes || 0 });
    json(res, 200, {
      success: true,
      level: engine.getLevel(),
      label: engine.getLevelName(),
    }, context);
    return;
  }

  params = getRouteMatch(pathname, '/v1/sessions/:id/phasa-tawan');
  if (req.method === 'POST' && params) {
    const session = await getSession(params.id);
    if (!session) {
      notFound(res, context);
      return;
    }
    if (context.auth.tenant && session.tenantId !== context.auth.tenant.id) {
      unauthorized(res, context, 'Session belongs to another tenant');
      return;
    }
    context.sessionId = session.id;

    const body = await parseJsonBody(req);
    if (!body.script) {
      badRequest(res, '`script` is required', context);
      return;
    }

    if (body.strictMode) {
      session.strictMode = String(body.strictMode);
    }
    const parsed = phasaTawan.applyScriptToSession(session, body.script, {
      strictMode: body.strictMode || session.strictMode || PHASA_TAWAN_DEFAULT_STRICT_MODE,
    });
    await maybeAutoSaveSession(session, { mutationWeight: 1 });
    recordUsage(context, { languageScriptsApplied: 1, bytesIn: context.bodyBytes || 0 });
    json(res, 200, {
      sessionId: session.id,
      ok: parsed.ok,
      parsed,
      languageContext: session.languageContext || {},
      snapshot: session.runtime.HumanSim.snapshot(),
    }, context);
    return;
  }

  params = getRouteMatch(pathname, '/v1/sessions/:id/save');
  if (req.method === 'POST' && params) {
    const session = await getSession(params.id);
    if (!session) {
      notFound(res, context);
      return;
    }
    if (context.auth.tenant && session.tenantId !== context.auth.tenant.id) {
      unauthorized(res, context, 'Session belongs to another tenant');
      return;
    }
    context.sessionId = session.id;
    const saved = AUTO_SAVE_SESSIONS
      ? await maybeAutoSaveSession(session, { force: true })
      : await saveSession(session);
    recordUsage(context, { bytesIn: context.bodyBytes || 0 });
    json(res, 200, {
      success: true,
      sessionId: session.id,
      filePath: saved.filePath,
      strictMode: session.strictMode || PHASA_TAWAN_DEFAULT_STRICT_MODE,
    }, context);
    return;
  }

  if (req.method === 'POST' && pathname === '/v1/sessions/load') {
    const body = await parseJsonBody(req);
    if (!body.sessionId) {
      badRequest(res, '`sessionId` is required', context);
      return;
    }

    const existing = await getSession(body.sessionId);
    if (!existing) {
      notFound(res, context);
      return;
    }
    if (context.auth.tenant && existing.tenantId !== context.auth.tenant.id) {
      unauthorized(res, context, 'Session belongs to another tenant');
      return;
    }
    context.sessionId = existing.id;
    recordUsage(context, { bytesIn: context.bodyBytes || 0 });
    json(res, 200, {
      success: true,
      sessionId: existing.id,
      restoredFromDisk: Boolean(existing.restoredFromDisk),
      snapshot: existing.runtime.HumanSim.snapshot(),
      languageContext: existing.languageContext || {},
      strictMode: existing.strictMode || PHASA_TAWAN_DEFAULT_STRICT_MODE,
      foundationValidation,
    }, context);
    return;
  }

  params = getRouteMatch(pathname, '/v1/sessions/:id/memory');
  if (req.method === 'GET' && params) {
    const session = await getSession(params.id);
    if (!session) {
      notFound(res, context);
      return;
    }
    if (context.auth.tenant && session.tenantId !== context.auth.tenant.id) {
      unauthorized(res, context, 'Session belongs to another tenant');
      return;
    }
    context.sessionId = session.id;
    recordUsage(context, { bytesIn: context.bodyBytes || 0 });

    json(res, 200, {
      sessionId: session.id,
      memory: session.runtime.HumanSim.getMemory(),
      languageContext: session.languageContext || {},
    }, context);
    return;
  }

  notFound(res, context);
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    serviceMetrics.errorsTotal += 1;
    const context = {
      req,
      pathname: new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname,
      bodyBytes: Number(req.headers['content-length'] || 0),
      auth: null,
      sessionId: null,
      requestId: req.headers['x-request-id'] || crypto.randomUUID(),
    };
    json(res, 500, {
      error: error.message || 'Internal server error',
    }, context);
  });
});

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.lastAccessedAt > SESSION_TTL_MS) {
      destroySession(sessionId);
    }
  }
}, CLEANUP_INTERVAL_MS);

if (typeof cleanupTimer.unref === 'function') {
  cleanupTimer.unref();
}

server.listen(PORT, HOST, () => {
  console.log(`Human Sim rental API listening on http://${HOST}:${PORT}`);
  if (!API_KEY && tenants.size === 0) {
    console.warn('Warning: no API key or tenant registry is configured. API is running without auth.');
  }
  if (ADMIN_API_KEY) {
    console.log('Admin API authentication is enabled');
  }
  if (tenants.size > 0) {
    console.log(`Tenant registry loaded from ${TENANTS_PATH} (${tenants.size} tenants)`);
  }
});
