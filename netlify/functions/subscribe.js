// Netlify Function — reçoit les leads de la landing page et les envoie dans systeme.io
exports.handler = async (event) => {
  // Accepter seulement les POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // Parser le corps application/x-www-form-urlencoded
    const params = new URLSearchParams(event.body || '');
    const email     = (params.get('email') || '').trim();
    const firstName = (params.get('first_name') || '').trim();

    if (!email) {
      return { statusCode: 400, body: 'Email requis' };
    }

    // Appel API systeme.io
    const res = await fetch('https://api.systeme.io/api/contacts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.SYSTEME_API_KEY || ''
      },
      body: JSON.stringify({
        email,
        firstName,
        fields: []
      })
    });

    // On retourne 200 dans tous les cas pour ne pas bloquer la redirection côté client
    return { statusCode: 200, body: 'OK' };

  } catch (err) {
    console.error('subscribe error:', err);
    // Toujours 200 pour ne pas bloquer la redirection
    return { statusCode: 200, body: 'OK' };
  }
};
