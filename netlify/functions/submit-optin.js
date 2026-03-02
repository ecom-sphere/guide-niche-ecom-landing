// Netlify Function — proxy vers Systeme.io (contourne CORS)
const https = require('https');

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let data;
  try { data = JSON.parse(event.body); } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { email, first_name } = data;
  if (!email || !first_name) {
    return { statusCode: 400, body: 'Missing fields' };
  }

  const payload = JSON.stringify({
    optin: {
      fields: { first_name, email },
      timeZone: data.timeZone || 'Europe/Paris',
      popupId: null,
      isDesktop: data.isDesktop !== undefined ? data.isDesktop : true,
      entityId: 'ecd924bb-1db9-44a4-86c5-8473271a5cad',
      checkBoxIds: []
    }
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'www.speed-ecom.com',
      path: '/optin-guide-2026',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, redirect: 'https://www.speed-ecom.com/guide-niche-2026' })
        });
      });
    });

    req.on('error', (err) => {
      resolve({
        statusCode: 500,
        body: JSON.stringify({ success: false, error: err.message })
      });
    });

    req.write(payload);
    req.end();
  });
};
