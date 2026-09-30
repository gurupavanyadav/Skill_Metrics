const crypto = require('crypto');

const configuredApiKey = process.env.PARTNER_API_KEY ||
  (process.env.NODE_ENV === 'test' ? 'test-partner-key' : null);

module.exports = (req, res, next) => {
  if (!configuredApiKey) {
    return res.status(503).json({ error: 'partner_authentication_not_configured' });
  }

  const suppliedKey = req.get('x-api-key');
  if (typeof suppliedKey === 'string' && suppliedKey.length <= 512) {
    const expected = Buffer.from(configuredApiKey, 'utf8');
    const supplied = Buffer.from(suppliedKey, 'utf8');
    if (expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied)) {
      return next();
    }
  }

  return res.status(401).json({ error: 'invalid_api_key' });
};
