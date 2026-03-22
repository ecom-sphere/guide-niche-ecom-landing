// Netlify Function — Brevo Integration with Geo-Blocking + CORS
const https = require('https');

const BLOCKED_COUNTRIES = ['NG', 'GH', 'SN', 'CI', 'CM', 'BF', 'ML', 'NE', 'TG', 'BJ', 'GN', 'SL', 'LR', 'GM', 'GW', 'MR', 'TD', 'CF', 'CG', 'CD', 'GA', 'GQ'];
const ALLOWED_ORIGINS = ['https://go.speed-ecom.com', 'https://speed-ecom.eu'];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
}

function makeRequest(method, hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method, headers }, (res) => {
      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: responseBody }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

exports.handler = async function(event) {
  const origin = event.headers.origin || event.headers.Origin || '';
  const headers = corsHeaders(origin);

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method Not Allowed' }) };
  }

  let data;
  try { data = JSON.parse(event.body); } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Invalid JSON' }) };
  }

  const { email, first_name, tunnel, utm_source, utm_medium, utm_campaign, utm_content, referrer, timeZone, isDesktop } = data;
  if (!email || !first_name) {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Missing fields' }) };
  }

  // Geo-blocking
  const country = (event.headers['x-country'] || event.headers['X-Country'] || 'UNKNOWN').toUpperCase();
  if (BLOCKED_COUNTRIES.includes(country)) {
    return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'This offer is not available in your region' }) };
  }

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Server config error' }) };
  }

  try {
    const today = new Date().toISOString().split('T')[0];

    // Build contact attributes (include all tracking data)
    const contactAttributes = {
      PRENOM: first_name,
      SIGNUP_DATE: today,
      SEQUENCE_STEP: 1,
      PAYS: country,
      TUNNEL: tunnel || 'guide-niche-ecom',
      UTM_SOURCE: utm_source || 'direct',
      UTM_MEDIUM: utm_medium || 'organic',
      UTM_CAMPAIGN: utm_campaign || '',
      UTM_CONTENT: utm_content || '',
      REFERRER: (referrer || '').substring(0, 200),
      TIMEZONE: timeZone || '',
      DEVICE: isDesktop ? 'desktop' : 'mobile'
    };

    // Step 1: Create/update contact in Brevo (list 3 = "Guide Niches 2026")
    const contactPayload = JSON.stringify({
      email,
      attributes: contactAttributes,
      listIds: [3],
      updateEnabled: true
    });

    const contactResp = await makeRequest('POST', 'api.brevo.com', '/v3/contacts', {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(contactPayload),
      'api-key': apiKey
    }, contactPayload);

    if (contactResp.statusCode !== 201 && contactResp.statusCode !== 204) {
      console.error('Brevo contact error:', contactResp.statusCode, contactResp.body);
      return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Failed to create contact' }) };
    }

    // Step 2: Send email template 2 (transactional)
    const emailPayload = JSON.stringify({
      to: [{ email, name: first_name }],
      templateId: 2,
      params: { PRENOM: first_name }
    });

    const emailResp = await makeRequest('POST', 'api.brevo.com', '/v3/smtp/email', {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(emailPayload),
      'api-key': apiKey
    }, emailPayload);

    if (emailResp.statusCode !== 201) {
      console.error('Brevo email error:', emailResp.statusCode, emailResp.body);
      return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Failed to send email' }) };
    }

    const redirectUrl = 'https://speed-ecom.eu/merci-guide?email=' + encodeURIComponent(email) + '&name=' + encodeURIComponent(first_name);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, redirect: redirectUrl }) };

  } catch (err) {
    console.error('Error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Internal server error' }) };
  }
};
