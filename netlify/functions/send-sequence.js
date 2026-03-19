// Netlify Scheduled Function — Séquence email Brevo
// Tourne tous les jours à 9h UTC
// Logique :
//   SEQUENCE_STEP=1 → email 1 déjà envoyé → envoyer template 3 (email 2) si today >= SIGNUP_DATE + 1 jour
//   SEQUENCE_STEP=N → envoyer template N+2 si today >= SIGNUP_DATE + N jours
//   S'arrête à SEQUENCE_STEP=12 (email 13 envoyé → SEQUENCE_STEP devient 13)

const https = require('https');

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

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

function today() {
  return new Date().toISOString().split('T')[0];
}

async function getContactsFromList(apiKey, listId, offset = 0, limit = 500) {
  const path = `/v3/contacts?listId=${listId}&limit=${limit}&offset=${offset}&sort=desc`;
  const resp = await makeRequest('GET', 'api.brevo.com', path, {
    'api-key': apiKey,
    'Content-Type': 'application/json'
  }, null);
  if (resp.statusCode !== 200) {
    throw new Error(`Brevo list contacts error: ${resp.statusCode} ${resp.body}`);
  }
  return JSON.parse(resp.body);
}

async function sendEmailTemplate(apiKey, email, firstName, templateId) {
  const payload = JSON.stringify({
    to: [{ email, name: firstName }],
    templateId,
    params: { PRENOM: firstName }
  });
  const resp = await makeRequest('POST', 'api.brevo.com', '/v3/smtp/email', {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'api-key': apiKey
  }, payload);
  return resp;
}

async function updateContactStep(apiKey, email, newStep) {
  const payload = JSON.stringify({
    attributes: { SEQUENCE_STEP: newStep }
  });
  const encodedEmail = encodeURIComponent(email);
  const resp = await makeRequest('PUT', 'api.brevo.com', `/v3/contacts/${encodedEmail}`, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'api-key': apiKey
  }, payload);
  return resp;
}

exports.handler = async function() {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.error('BREVO_API_KEY manquante');
    return { statusCode: 500 };
  }

  const todayStr = today();
  console.log(`[send-sequence] Démarrage — ${todayStr}`);

  let offset = 0;
  const limit = 500;
  let totalProcessed = 0;
  let totalSent = 0;
  let hasMore = true;

  while (hasMore) {
    let data;
    try {
      data = await getContactsFromList(apiKey, 3, offset, limit);
    } catch (err) {
      console.error('Erreur récupération contacts:', err.message);
      break;
    }

    const contacts = data.contacts || [];
    console.log(`[send-sequence] Batch offset=${offset} — ${contacts.length} contacts`);

    for (const contact of contacts) {
      const attrs = contact.attributes || {};
      const email = contact.email;
      const step = parseInt(attrs.SEQUENCE_STEP || '0', 10);
      const signupDate = attrs.SIGNUP_DATE || '';
      const firstName = attrs.PRENOM || 'Ami(e)';

      // Ignorer les contacts hors séquence (step=0 = pas passé par le form, step>=13 = séquence terminée)
      if (step < 1 || step > 12 || !signupDate) continue;

      // Vérifier si c'est le bon jour pour envoyer le prochain email
      const sendDate = addDays(signupDate, step);
      if (todayStr < sendDate) continue;

      // templateId = step + 2 (step=1 → template 3, step=12 → template 14)
      const templateId = step + 2;

      console.log(`[send-sequence] ${email} step=${step} → template ${templateId}`);

      try {
        const emailResp = await sendEmailTemplate(apiKey, email, firstName, templateId);
        if (emailResp.statusCode === 201) {
          totalSent++;
          // Incrémenter SEQUENCE_STEP
          await updateContactStep(apiKey, email, step + 1);
          console.log(`[send-sequence] ✓ Envoyé template ${templateId} à ${email} → SEQUENCE_STEP=${step + 1}`);
        } else {
          console.error(`[send-sequence] ✗ Échec template ${templateId} pour ${email}: ${emailResp.statusCode} ${emailResp.body}`);
        }
      } catch (err) {
        console.error(`[send-sequence] Erreur pour ${email}:`, err.message);
      }

      totalProcessed++;
    }

    // Pagination
    if (contacts.length < limit) {
      hasMore = false;
    } else {
      offset += limit;
    }
  }

  console.log(`[send-sequence] Terminé — ${totalProcessed} contacts traités, ${totalSent} emails envoyés`);
  return { statusCode: 200 };
};
