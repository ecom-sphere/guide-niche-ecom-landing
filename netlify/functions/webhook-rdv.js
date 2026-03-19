// Netlify Function — Webhook RDV
// Compatible : Calendly v2, Cal.com, Tidycal, Acuity
// Quand quelqu'un réserve un RDV, met à jour le contact Brevo : RDV = "Oui" + RDV_DATE
//
// Config Calendly :
//   Dashboard → Intégrations → Webhooks → URL : https://go.speed-ecom.com/.netlify/functions/webhook-rdv
//   Events : invitee.created
//
// Config Cal.com :
//   Settings → Developer → Webhooks → URL identique, event : BOOKING_CREATED

const https = require('https');

function makeRequest(method, hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method, headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function updateBrevoContact(email, rdvDate, apiKey) {
  const payload = JSON.stringify({
    attributes: {
      RDV: 'Oui',
      RDV_DATE: rdvDate
    },
    updateEnabled: true
  });
  return makeRequest('PUT', 'api.brevo.com', `/v3/contacts/${encodeURIComponent(email)}`, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'api-key': apiKey
  }, payload);
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return { statusCode: 500, body: 'Server config error' };

  let payload;
  try { payload = JSON.parse(event.body); } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  let email = null;
  let rdvDate = new Date().toISOString().split('T')[0];

  // ── Calendly v2 ──
  if (payload.event === 'invitee.created' && payload.payload) {
    email = payload.payload.email;
    if (payload.payload.scheduled_event?.start_time) {
      rdvDate = payload.payload.scheduled_event.start_time.split('T')[0];
    }
  }

  // ── Cal.com ──
  if (!email && payload.triggerEvent === 'BOOKING_CREATED' && payload.payload) {
    email = payload.payload.attendees?.[0]?.email || payload.payload.email;
    if (payload.payload.startTime) {
      rdvDate = payload.payload.startTime.split('T')[0];
    }
  }

  // ── Acuity Scheduling ──
  if (!email && payload.action === 'scheduled' && payload.email) {
    email = payload.email;
    if (payload.datetime) rdvDate = payload.datetime.split('T')[0];
  }

  // ── Tidycal (simple JSON) ──
  if (!email && payload.type === 'booking.created') {
    email = payload.booking?.contact_email || payload.contact?.email;
    if (payload.booking?.start_at) rdvDate = payload.booking.start_at.split('T')[0];
  }

  if (!email) {
    console.error('Webhook RDV : email non trouvé dans payload', JSON.stringify(payload).substring(0, 300));
    return { statusCode: 400, body: 'Email not found in webhook payload' };
  }

  try {
    const resp = await updateBrevoContact(email, rdvDate, apiKey);
    if (resp.statusCode !== 200 && resp.statusCode !== 204) {
      console.error('Brevo update error:', resp.statusCode, resp.body);
      return { statusCode: 500, body: 'Failed to update contact' };
    }
    console.log(`RDV marqué pour ${email} le ${rdvDate}`);
    return { statusCode: 200, body: JSON.stringify({ success: true, email, rdvDate }) };
  } catch (err) {
    console.error('Webhook RDV error:', err.message);
    return { statusCode: 500, body: 'Internal error' };
  }
};
