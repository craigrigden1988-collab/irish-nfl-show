// Irish NFL Show — Netlify Edge Function
// Proxies ESPN, Open-Meteo and nflverse requests with caching
// Deployed automatically when pushed to GitHub

const TTL = {
  scores:    60,
  standings: 300,
  schedule:  300,
  teams:     86400,
  roster:    3600,
  injuries:  300,
  leaders:   300,
  athlete:   3600,
  weather:   1800,
  games_csv: 86400,
  default:   300,
};

function ttlFor(url){
  if(url.includes('/scoreboard'))  return TTL.scores;
  if(url.includes('/standings'))   return TTL.standings;
  if(url.includes('/schedule'))    return TTL.schedule;
  if(url.includes('/teams'))       return TTL.teams;
  if(url.includes('/roster'))      return TTL.roster;
  if(url.includes('/injuries'))    return TTL.injuries;
  if(url.includes('/leaders'))     return TTL.leaders;
  if(url.includes('/athletes/'))   return TTL.athlete;
  if(url.includes('open-meteo'))   return TTL.weather;
  if(url.includes('githubusercontent') || url.includes('nflverse')) return TTL.games_csv;
  return TTL.default;
}

const ALLOWED_DOMAINS = [
  'site.api.espn.com',
  'site.web.api.espn.com',
  'api.open-meteo.com',
  'raw.githubusercontent.com',
  'github.com',
];

export default async (request, context) => {
  const url = new URL(request.url);

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if(request.method === 'OPTIONS'){
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if(url.pathname === '/proxy/health'){
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  if(!url.pathname.startsWith('/proxy')){
    return new Response('Not found', { status: 404, headers: corsHeaders });
  }

  const target = url.searchParams.get('url');
  if(!target){
    return new Response('Missing url param', { status: 400, headers: corsHeaders });
  }

  // Only proxy known safe domains
  let targetHost;
  try{ targetHost = new URL(target).hostname; }
  catch(e){ return new Response('Invalid URL', { status: 400, headers: corsHeaders }); }

  if(!ALLOWED_DOMAINS.some(d => targetHost === d || targetHost.endsWith('.'+d))){
    return new Response('Blocked domain', { status: 403, headers: corsHeaders });
  }

  const ttl = ttlFor(target);

  // Use Netlify's built-in CDN caching via Cache-Control headers
  try{
    const upstream = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; IrishNFLShow/1.0)',
        'Accept': 'application/json, text/plain, */*',
      }
    });

    if(!upstream.ok){
      return new Response(JSON.stringify({ error: 'Upstream error', status: upstream.status }), {
        status: upstream.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const body = await upstream.text();
    const contentType = upstream.headers.get('Content-Type') || 'application/json';

    return new Response(body, {
      headers: {
        ...corsHeaders,
        'Content-Type': contentType,
        'Cache-Control': `public, s-maxage=${ttl}, stale-while-revalidate=60`,
        'Netlify-CDN-Cache-Control': `public, s-maxage=${ttl}, stale-while-revalidate=60`,
        'X-Cache-TTL': String(ttl),
      }
    });
  }catch(e){
    return new Response(JSON.stringify({ error: 'Fetch failed', detail: e.message }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
};

export const config = { path: '/proxy' };
