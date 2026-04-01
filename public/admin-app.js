(function () {
  const state = {
    baseUrl: window.location.origin,
    apiKey: '',
  };

  const $ = (id) => document.getElementById(id);
  const setCode = (id, value) => { $(id).textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); };

  function headers() {
    return {
      Authorization: `Bearer ${state.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async function api(path, options) {
    const response = await fetch(`${state.baseUrl}${path}`, {
      ...options,
      headers: {
        ...(options && options.headers ? options.headers : {}),
        ...headers(),
      },
    });

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      throw new Error(typeof payload === 'string' ? payload : JSON.stringify(payload));
    }
    return payload;
  }

  function renderStats(usage) {
    const stats = [
      ['Tenants', Array.isArray(usage.usage) ? usage.usage.length : 0],
      ['Requests', usage.usage?.reduce((sum, item) => sum + (item.requests || 0), 0) || 0],
      ['Sessions', usage.usage?.reduce((sum, item) => sum + (item.sessionsCreated || 0), 0) || 0],
      ['Units', usage.usage?.reduce((sum, item) => sum + (item.estimatedBillableUnits || 0), 0).toFixed?.(2) || '0.00'],
    ];
    $('stats').innerHTML = stats.map(([label, value]) => `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`).join('');
  }

  async function refresh() {
    $('status').textContent = 'Loading...';
    const [pricing, usage] = await Promise.all([
      api('/v1/admin/pricing'),
      api('/v1/admin/usage'),
    ]);
    setCode('pricingView', pricing);
    setCode('usageView', usage);
    renderStats(usage);
    $('status').textContent = 'Connected';
  }

  $('baseUrl').value = state.baseUrl;
  $('connectBtn').addEventListener('click', async () => {
    state.baseUrl = $('baseUrl').value.trim() || window.location.origin;
    state.apiKey = $('apiKey').value.trim();
    try {
      await refresh();
    } catch (error) {
      $('status').textContent = `Error: ${error.message}`;
    }
  });

  $('refreshBtn').addEventListener('click', async () => {
    try {
      await refresh();
    } catch (error) {
      $('status').textContent = `Error: ${error.message}`;
    }
  });

  $('quoteBtn').addEventListener('click', async () => {
    try {
      const payload = await api('/v1/admin/billing/quote', {
        method: 'POST',
        body: JSON.stringify({
          tenantId: $('quoteTenantId').value.trim(),
          planId: $('quotePlanId').value.trim(),
        }),
      });
      setCode('quoteView', payload);
    } catch (error) {
      setCode('quoteView', { error: error.message });
    }
  });

  $('invoiceBtn').addEventListener('click', async () => {
    try {
      const payload = await api('/v1/admin/billing/invoice-html-file', {
        method: 'POST',
        body: JSON.stringify({
          tenantId: $('invoiceTenantId').value.trim(),
          customerName: $('invoiceCustomerName').value.trim(),
          planId: $('invoicePlanId').value.trim(),
          billingPeriod: { label: $('invoicePeriod').value.trim() },
        }),
      });
      setCode('invoiceView', payload);
    } catch (error) {
      setCode('invoiceView', { error: error.message });
    }
  });
})();
