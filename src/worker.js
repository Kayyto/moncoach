// Mon Coach — Worker (Cloudflare Workers + D1 + R2)
// Migration depuis Firebase Auth + Firestore.
//
// Auth : même principe que l'app Firebase d'origine — un prénom (unique
// dans le groupe) + un mot de passe, sans vraie adresse email. Le prénom
// "Kayto" est automatiquement administrateur (comme ADMIN_ACCOUNT_NAME
// côté Firebase).

const ADMIN_NAME = 'kayto';
const SESSION_DAYS = 90;
const COOKIE_NAME = 'mc_session';

function slugify(name) {
  return String(name || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function b64(bytes) {
  let bin = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

async function hacherMdp(mdp) {
  const sel = crypto.getRandomValues(new Uint8Array(16));
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(mdp), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: sel, iterations: 100000, hash: 'SHA-256' }, base, 256);
  return `pbkdf2$100000$${b64(sel)}$${b64(bits)}`;
}

async function verifierMdp(mdp, stocke) {
  if (!stocke) return false;
  const parts = stocke.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1], 10);
  const sel = Uint8Array.from(atob(parts[2]), c => c.charCodeAt(0));
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(mdp), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: sel, iterations, hash: 'SHA-256' }, base, 256);
  const calcule = b64(bits);
  if (calcule.length !== parts[3].length) return false;
  let diff = 0;
  for (let i = 0; i < calcule.length; i++) diff |= calcule.charCodeAt(i) ^ parts[3].charCodeAt(i);
  return diff === 0;
}

function lireCookie(req, nom) {
  const m = (req.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${nom}=([^;]+)`));
  return m ? m[1] : null;
}

function cookieReponse(token) {
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toUTCString();
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${expires}`;
}

function json(data, init) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...(init && init.headers) },
  });
}

async function getUtilisateurCourant(req, env) {
  const token = lireCookie(req, COOKIE_NAME);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT m.uid, m.name, m.is_admin FROM sessions s
     JOIN members m ON m.uid = s.uid
     WHERE s.token = ? AND s.expires_at > datetime('now')`
  ).bind(token).first();
  if (!row) return null;
  return { uid: row.uid, name: row.name, isAdmin: !!row.is_admin };
}

async function creerSession(env, uid) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await env.DB.prepare('INSERT INTO sessions (token, uid, expires_at) VALUES (?, ?, ?)')
    .bind(token, uid, expires).run();
  return token;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;

    try {
      if (p === '/api/auth/signup' && req.method === 'POST') return await handleSignup(req, env);
      if (p === '/api/auth/login' && req.method === 'POST') return await handleLogin(req, env);
      if (p === '/api/auth/logout' && req.method === 'POST') return await handleLogout(req, env);
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

      if (p.startsWith('/api/carnet-proxy/') && (req.method === 'GET' || req.method === 'PUT')) {
        return await handleCarnetProxy(req, env, decodeURIComponent(p.slice('/api/carnet-proxy/'.length)));
      }

      return env.ASSETS.fetch(req);
    } catch (err) {
      console.error('MonCoach — erreur serveur', err);
      return json({ error: 'Erreur serveur' }, { status: 500 });
    }
  },
};

async function handleSignup(req, env) {
  const body = await req.json().catch(() => null);
  const name = (body && body.name || '').trim();
  const password = body && body.password || '';
  if (!name || name.length < 2) return json({ error: 'Prénom invalide' }, { status: 400 });
  if (!password || password.length < 4) return json({ error: 'Mot de passe trop court (4 caractères min.)' }, { status: 400 });

  const existing = await env.DB.prepare('SELECT uid FROM members WHERE name = ?').bind(name).first();
  if (existing) return json({ error: 'Ce prénom est déjà pris dans le groupe' }, { status: 409 });

  const uid = crypto.randomUUID();
  const hash = await hacherMdp(password);
  const isAdmin = slugify(name) === ADMIN_NAME ? 1 : 0;

  await env.DB.batch([
    env.DB.prepare('INSERT INTO members (uid, name, password_hash, is_admin) VALUES (?, ?, ?, ?)').bind(uid, name, hash, isAdmin),
    env.DB.prepare("INSERT INTO private_data (uid, data) VALUES (?, '{}')").bind(uid),
    env.DB.prepare("INSERT INTO streaks (uid, data) VALUES (?, '{}')").bind(uid),
  ]);

  const token = await creerSession(env, uid);
  return json({ uid, name, isAdmin: !!isAdmin }, { headers: { 'Set-Cookie': cookieReponse(token) } });
}

async function handleLogin(req, env) {
  const body = await req.json().catch(() => null);
  const name = (body && body.name || '').trim();
  const password = body && body.password || '';
  const row = await env.DB.prepare('SELECT uid, name, password_hash, is_admin FROM members WHERE name = ?').bind(name).first();
  if (!row || !(await verifierMdp(password, row.password_hash))) {
    return json({ error: 'Prénom ou mot de passe incorrect' }, { status: 401 });
  }

  // Promotion admin automatique si le prénom correspond, comme côté Firebase.
  let isAdmin = !!row.is_admin;
  if (slugify(row.name) === ADMIN_NAME && !isAdmin) {
    await env.DB.prepare('UPDATE members SET is_admin = 1 WHERE uid = ?').bind(row.uid).run();
    isAdmin = true;
  }

  const token = await creerSession(env, row.uid);
  return json({ uid: row.uid, name: row.name, isAdmin }, { headers: { 'Set-Cookie': cookieReponse(token) } });
}

async function handleLogout(req, env) {
  const token = lireCookie(req, COOKIE_NAME);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  return json({ ok: true }, { headers: { 'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` } });
}

async function handleMe(req, env) {
  const user = await getUtilisateurCourant(req, env);
  if (!user) return json({ user: null });
  return json({ user });
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

// Petit relais côté serveur vers l'app "Carnet" (liste.kayto.org), utilisé par
// l'envoi de la liste de courses depuis MonCoach. Un fetch direct depuis le
// navigateur serait bloqué par CORS (liste.kayto.org ne renvoie pas
// Access-Control-Allow-Origin) ; en passant par notre propre Worker (même
// origine que la page), aucun en-tête CORS n'est nécessaire.
async function handleCarnetProxy(req, env, code) {
  if (!code) return json({ error: 'Code manquant' }, { status: 400 });
  const target = `https://liste.kayto.org/api/carnet/${encodeURIComponent(code)}`;
  try {
    const init = { method: req.method, headers: { 'Content-Type': 'application/json' } };
    if (req.method === 'PUT') init.body = await req.text();
    const upstream = await fetch(target, init);
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return json({ error: 'Carnet injoignable pour le moment' }, { status: 502 });
  }
}
