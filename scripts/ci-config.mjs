export function requireValues(env, keys) {
  const missing = keys.filter(key => typeof env[key] !== 'string' || !env[key].trim());
  if (missing.length) throw new Error(`Configure required values: ${missing.join(', ')}`);
}

export function apiBase(value, allowRelative = false) {
  if (allowRelative && value === '/api/v1') return value;
  let url;
  try { url = new URL(value); } catch { throw new Error('API_BASE_URL must be an absolute HTTPS URL ending in /api/v1'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.pathname.replace(/\/$/, '') !== '/api/v1' ||
      /(^|\.)(localhost|example\.(com|org|net)|invalid)$/.test(url.hostname) ||
      url.hostname.endsWith('.invalid') || url.hostname.endsWith('.example')) {
    throw new Error('API_BASE_URL must be a real HTTPS API URL ending in /api/v1, without credentials, query or fragment');
  }
  return `${url.origin}/api/v1`;
}

export function website(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('WEB_SITE_URL must be an absolute HTTPS website origin'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.pathname !== '/' || url.hostname.endsWith('.invalid') || url.hostname.endsWith('.example')) {
    throw new Error('WEB_SITE_URL must be an HTTPS website origin without credentials or a path');
  }
  return url.origin;
}

export function revision(value) {
  if (!/^[a-f0-9]{40}$/.test(value || '')) throw new Error('GITHUB_SHA must be a complete Git commit SHA');
  return value;
}

export function deploymentConfig(env) {
  requireValues(env, ['API_BASE_URL', 'WEB_SITE_URL', 'RENDER_API_KEY', 'RENDER_SERVICE_ID',
    'VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID', 'GITHUB_SHA']);
  if (!/^srv-[A-Za-z0-9]+$/.test(env.RENDER_SERVICE_ID)) throw new Error('RENDER_SERVICE_ID must be a Render service ID');
  return { apiBaseUrl: apiBase(env.API_BASE_URL), webSiteUrl: website(env.WEB_SITE_URL), commit: revision(env.GITHUB_SHA) };
}
