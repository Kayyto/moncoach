// Mon Coach — Worker (Cloudflare Workers + D1 + R2)
//
// Connexion : compte central Kayto (compte.kayto.org). Le navigateur envoie le
// cookie kc_coach ; le Worker le fait valider par le service de comptes, puis
// retrouve le profil MonCoach de la personne (colonne members.account_id).
// Une personne inconnue obtient un profil VIDE (jamais de reprise automatique
// d'un ancien profil). L'application reste utilisable sans connexion : seul le
// "Groupe" (séries, recettes partagées, sauvegarde en ligne) demande un compte.
// Administrateur = colonne members.is_admin (attribuée à la main dans la base).

const COMPTE_URL = 'https://compte.kayto.org';
const APP_SLUG = 'coach';
const SESSION_COOKIE = 'kc_coach';
const SESSION_CACHE_MS = 30000;
const sessionCache = new Map(); // empreinte du cookie -> { at, account }
const authWhy = new WeakMap();  // requête -> raison de l'échec (visible dans X-Auth-Why de /api/me)
const CARNET_LIST_ID = 'moncoach-courses';

function json(data, init) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...(init && init.headers) },
  });
}

function lireCookie(req, nom) {
  const m = (req.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${nom}=([^;]+)`));
  return m ? m[1] : null;
}

async function sha256Hex(str) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Demande au service de comptes si le cookie est valide pour cette app (30 s en mémoire).
async function getCentralAccount(req, env) {
  const token = lireCookie(req, SESSION_COOKIE);
  if (!token) { authWhy.set(req, 'pas-de-cookie'); return null; }
  const key = await sha256Hex(token);
  const hit = sessionCache.get(key);
  if (hit && Date.now() - hit.at < SESSION_CACHE_MS) return hit.account;
  let account = null;
  try {
    const sessionUrl = `${(env && env.COMPTE_URL) || COMPTE_URL}/api/session?app=${APP_SLUG}`;
    const init = { headers: { Cookie: `${SESSION_COOKIE}=${token}` } };
    const res = env && env.COMPTE && typeof env.COMPTE.fetch === 'function'
      ? await env.COMPTE.fetch(new Request(sessionUrl, init))
      : await fetch(sessionUrl, init);
    if (!res.ok) authWhy.set(req, `comptes-http-${res.status}`);
    if (res.ok) {
      const data = await res.json();
      if (data.authenticated && data.account && data.account.app === APP_SLUG && typeof data.account.id === 'string' && data.account.id) {
        account = { id: data.account.id, name: String(data.account.name || '').trim() || 'Profil', email: String(data.account.email || '').trim().toLowerCase() };
      }
    }
  } catch (e) {
    console.error('Service de comptes injoignable :', e.message);
    authWhy.set(req, 'comptes-injoignable');
    return null;
  }
  if (!account) {
    if (authWhy.has(req)) return null; // erreur technique : pas gardée en cache
    authWhy.set(req, 'session-refusee-par-comptes');
  }
  if (sessionCache.size > 500) sessionCache.clear();
  sessionCache.set(key, { at: Date.now(), account });
  return account;
}

// Retrouve le profil lié à un compte central ; sinon en crée un VIDE.
async function membrePourCompte(env, account) {
  const sel = 'SELECT uid, name, is_admin FROM members WHERE account_id = ?';
  const existant = await env.DB.prepare(sel).bind(account.id).first();
  if (existant) return existant;
  const base = account.name.slice(0, 40);
  for (let i = 1; i <= 20; i++) {
    const nom = i === 1 ? base : `${base} ${i}`;
    const uid = crypto.randomUUID();
    try {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO members (uid, name, password_hash, is_admin, account_id) VALUES (?, ?, '', 0, ?)").bind(uid, nom, account.id),
        env.DB.prepare("INSERT INTO private_data (uid, data) VALUES (?, '{}')").bind(uid),
        env.DB.prepare("INSERT INTO streaks (uid, data) VALUES (?, '{}')").bind(uid),
      ]);
      break;
    } catch (e) {
      // prénom déjà pris (ou création simultanée du même compte) : on réessaie
      const deja = await env.DB.prepare(sel).bind(account.id).first();
      if (deja) return deja;
    }
  }
  return env.DB.prepare(sel).bind(account.id).first();
}

// Personne connectée : { uid, name, isAdmin, email } ou null.
async function getUtilisateurCourant(req, env) {
  // Protection CSRF : une requête qui modifie des données doit venir de ce site.
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.headers.get('Origin');
    if (origin && origin !== new URL(req.url).origin) { authWhy.set(req, 'origine-refusee'); return null; }
  }
  const account = await getCentralAccount(req, env);
  if (!account) return null;
  const m = await membrePourCompte(env, account);
  if (!m) return null;
  return { uid: m.uid, name: m.name, isAdmin: !!m.is_admin, email: account.email };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;

    try {
      if (p === '/api/me' && req.method === 'GET') return await handleMe(req, env);

      if (p === '/api/private' && req.method === 'GET') return await handleGetPrivate(req, env);
      if (p === '/api/private' && req.method === 'PUT') return await handlePutPrivate(req, env);

      if (p === '/api/group' && req.method === 'GET') return await handleGetGroup(req, env);
      if (p === '/api/group/streak' && req.method === 'PUT') return await handlePutStreak(req, env);

      if (p === '/api/recipes' && req.method === 'GET') return await handleGetRecipes(req, env);
      if (p === '/api/recipes' && req.method === 'POST') return await handlePostRecipe(req, env);
      if (p.startsWith('/api/recipes/') && req.method === 'PUT') return await handlePutRecipe(req, env, p.slice('/api/recipes/'.length));
      if (p.startsWith('/api/recipes/') && req.method === 'DELETE') return await handleDeleteRecipe(req, env, p.slice('/api/recipes/'.length));

      if (p === '/api/recipe-overrides' && req.method === 'GET') return await handleGetOverrides(req, env);
      if (p.startsWith('/api/recipe-overrides/') && req.method === 'PUT') return await handlePutOverride(req, env, decodeURIComponent(p.slice('/api/recipe-overrides/'.length)));

      if (p.startsWith('/api/admin/members/') && req.method === 'DELETE') return await handleAdminRemoveMember(req, env, p.slice('/api/admin/members/'.length));
      if (p.startsWith('/api/admin/streaks/') && p.endsWith('/reset') && req.method === 'POST') {
        const uid = p.slice('/api/admin/streaks/'.length, -'/reset'.length);
        return await handleAdminResetStreak(req, env, uid);
      }

      if (p.startsWith('/photos/') && req.method === 'GET') return await handlePhoto(req, env, p.slice('/photos/'.length));

      if (p === '/api/carnet-send' && req.method === 'POST') return await handleCarnetSend(req, env);

      return env.ASSETS.fetch(req);
    } catch (err) {
      console.error('MonCoach — erreur serveur', err);
      return json({ error: 'Erreur serveur' }, { status: 500 });
    }
  },
};

async function handleMe(req, env) {
  const user = await getUtilisateurCourant(req, env);
  if (!user) return json({ user: null }, { headers: { 'X-Auth-Why': authWhy.get(req) || 'inconnu' } });
  return json({ user: { uid: user.uid, name: user.name, isAdmin: user.isAdmin } });
}

function requireAuth(user) {
  if (!user) return json({ error: 'Non connecté' }, { status: 401 });
  return null;
}

async function handleGetPrivate(req, env) {
  const user = await getUtilisateurCourant(req, env);
  const unauth = requireAuth(user); if (unauth) return unauth;
  const row = await env.DB.prepare('SELECT data FROM private_data WHERE uid = ?').bind(user.uid).first();
  return json({ data: row ? JSON.parse(row.data) : {} });
}

async function handlePutPrivate(req, env) {
  const user = await getUtilisateurCourant(req, env);
  const unauth = requireAuth(user); if (unauth) return unauth;
  const body = await req.json().catch(() => null);
  if (!body) return json({ error: 'Corps JSON invalide' }, { status: 400 });
  await env.DB.prepare("INSERT INTO private_data (uid, data, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(uid) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
    .bind(user.uid, JSON.stringify(body)).run();
  return json({ ok: true });
}

async function handleGetGroup(req, env) {
  const user = await getUtilisateurCourant(req, env);
  const unauth = requireAuth(user); if (unauth) return unauth;
  const { results: members } = await env.DB.prepare('SELECT uid, name, is_admin FROM members').all();
  const { results: streaks } = await env.DB.prepare('SELECT uid, data FROM streaks').all();
  const streaksByUid = {};
  for (const s of streaks) streaksByUid[s.uid] = JSON.parse(s.data);
  return json({
    members: members.map(m => ({ uid: m.uid, name: m.name, isAdmin: !!m.is_admin })),
    streaks: streaksByUid,
    isAdmin: user.isAdmin,
  });
}

async function handlePutStreak(req, env) {
  const user = await getUtilisateurCourant(req, env);
  const unauth = requireAuth(user); if (unauth) return unauth;
  const body = await req.json().catch(() => null);
  if (!body) return json({ error: 'Corps JSON invalide' }, { status: 400 });
  await env.DB.prepare("INSERT INTO streaks (uid, data, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(uid) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
    .bind(user.uid, JSON.stringify(body)).run();
  return json({ ok: true });
}

async function handleGetRecipes(req, env) {
  const user = await getUtilisateurCourant(req, env);
  const unauth = requireAuth(user); if (unauth) return unauth;
  const { results } = await env.DB.prepare('SELECT id, data, created_by FROM recipes').all();
  return json({ recipes: results.map(r => ({ id: r.id, createdBy: r.created_by, ...JSON.parse(r.data) })) });
}

async function handlePostRecipe(req, env) {
  const user = await getUtilisateurCourant(req, env);
  const unauth = requireAuth(user); if (unauth) return unauth;
  const body = await req.json().catch(() => null);
  if (!body) return json({ error: 'Corps JSON invalide' }, { status: 400 });
  const id = body.id || crypto.randomUUID();
  await env.DB.prepare('INSERT INTO recipes (id, data, created_by) VALUES (?, ?, ?)')
    .bind(id, JSON.stringify(body), user.uid).run();
  return json({ ok: true, id });
}

async function handlePutRecipe(req, env, id) {
  const user = await getUtilisateurCourant(req, env);
  const unauth = requireAuth(user); if (unauth) return unauth;
  const existing = await env.DB.prepare('SELECT created_by FROM recipes WHERE id = ?').bind(id).first();
  if (!existing) return json({ error: 'Recette introuvable' }, { status: 404 });
  if (existing.created_by !== user.uid && !user.isAdmin) return json({ error: 'Non autorisé' }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body) return json({ error: 'Corps JSON invalide' }, { status: 400 });
  await env.DB.prepare("UPDATE recipes SET data = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(JSON.stringify(body), id).run();
  return json({ ok: true });
}

async function handleDeleteRecipe(req, env, id) {
  const user = await getUtilisateurCourant(req, env);
  const unauth = requireAuth(user); if (unauth) return unauth;
  const existing = await env.DB.prepare('SELECT created_by FROM recipes WHERE id = ?').bind(id).first();
  if (!existing) return json({ error: 'Recette introuvable' }, { status: 404 });
  if (existing.created_by !== user.uid && !user.isAdmin) return json({ error: 'Non autorisé' }, { status: 403 });
  await env.DB.prepare('DELETE FROM recipes WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

async function handleGetOverrides(req, env) {
  // Lecture publique (pas besoin d'être connecté) : les corrections de
  // recettes profitent à tout le monde, y compris avant connexion au groupe —
  // comme en lecture Firestore côté app d'origine. L'écriture reste réservée
  // à l'administrateur (voir handlePutOverride).
  const { results } = await env.DB.prepare('SELECT name, data FROM recipe_overrides').all();
  const overrides = {};
  for (const r of results) overrides[r.name] = JSON.parse(r.data);
  return json({ overrides });
}

async function handlePutOverride(req, env, name) {
  const user = await getUtilisateurCourant(req, env);
  const unauth = requireAuth(user); if (unauth) return unauth;
  if (!user.isAdmin) return json({ error: 'Réservé à l\'administrateur' }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body) return json({ error: 'Corps JSON invalide' }, { status: 400 });
  await env.DB.prepare("INSERT INTO recipe_overrides (name, data, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(name) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
    .bind(name, JSON.stringify(body)).run();
  return json({ ok: true });
}

async function handleAdminRemoveMember(req, env, uid) {
  const user = await getUtilisateurCourant(req, env);
  const unauth = requireAuth(user); if (unauth) return unauth;
  if (!user.isAdmin) return json({ error: 'Réservé à l\'administrateur' }, { status: 403 });
  await env.DB.prepare('DELETE FROM members WHERE uid = ?').bind(uid).run();
  return json({ ok: true });
}

async function handleAdminResetStreak(req, env, uid) {
  const user = await getUtilisateurCourant(req, env);
  const unauth = requireAuth(user); if (unauth) return unauth;
  if (!user.isAdmin) return json({ error: 'Réservé à l\'administrateur' }, { status: 403 });
  await env.DB.prepare("UPDATE streaks SET data = '{}', updated_at = datetime('now') WHERE uid = ?").bind(uid).run();
  return json({ ok: true });
}

async function handlePhoto(req, env, key) {
  const obj = await env.PHOTOS.get(decodeURIComponent(key));
  if (!obj) return new Response('Not found', { status: 404 });
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

// Envoi de la liste de courses vers la To Do List (liste.kayto.org) de LA PERSONNE
// CONNECTÉE uniquement : le carnet est retrouvé par l'e-mail de son compte central
// (liaison de service interne, aucun code à saisir, aucun accès aux carnets des autres).
// La personne doit avoir déjà ouvert la To Do List avec la même adresse e-mail.
async function handleCarnetSend(req, env) {
  const user = await getUtilisateurCourant(req, env);
  const unauth = requireAuth(user); if (unauth) return unauth;
  if (!env.LISTE) return json({ error: 'no_carnet' }, { status: 404 });
  const body = await req.json().catch(() => null);
  const list = body && body.list;
  if (!list || typeof list !== 'object' || !Array.isArray(list.items) || list.items.length > 500) {
    return json({ error: 'Liste invalide' }, { status: 400 });
  }
  const propre = {
    id: CARNET_LIST_ID,
    name: 'Courses (MonCoach)',
    color: 'sage',
    emoji: '🛒',
    items: list.items.map((it, i) => ({
      id: String(it && it.id || `${CARNET_LIST_ID}-${i}`).slice(0, 120),
      text: String(it && it.text || '').slice(0, 300),
      done: !!(it && it.done),
      qty: 1,
    })),
  };
  let payload = await env.LISTE.getPayload(user.email);
  if (payload === null || payload === undefined) return json({ error: 'no_carnet' }, { status: 404 });
  if (typeof payload !== 'object' || Array.isArray(payload)) payload = {};
  const lists = Array.isArray(payload.lists) ? payload.lists.slice() : [];
  const idx = lists.findIndex(l => l && l.id === CARNET_LIST_ID);
  if (idx >= 0) lists[idx] = propre; else lists.push(propre);
  const ok = await env.LISTE.putPayload(user.email, Object.assign({}, payload, { lists }));
  if (!ok) return json({ error: 'no_carnet' }, { status: 404 });
  return json({ ok: true });
}
