const fetch = require('node-fetch');

async function getLinkPreview(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const res = await fetch(url, { 
      signal: controller.signal,
      headers: { 'User-Agent': 'RosterChirpBot/1.0' }
    });
    clearTimeout(timeout);

    const html = await res.text();
    
    const getTag = (name) => {
      const match = html.match(new RegExp(`<meta[^>]*property=["']${name}["'][^>]*content=["']([^"']+)["']`, 'i')) ||
                    html.match(new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']${name}["']`, 'i')) ||
                    html.match(new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']+)["']`, 'i'));
      return match?.[1] || '';
    };

    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    
    return {
      url,
      title: getTag('og:title') || titleMatch?.[1] || url,
      description: getTag('og:description') || getTag('description') || '',
      image: getTag('og:image') || '',
      siteName: getTag('og:site_name') || new URL(url).hostname,
    };
  } catch (e) {
    return null;
  }
}

module.exports = { getLinkPreview };
