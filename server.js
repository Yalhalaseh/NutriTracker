import 'dotenv/config';
import express from 'express';
import OpenAI from 'openai';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const app = express();
const port = Number(process.env.PORT || 3000);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-change-me';
const TOKEN_TTL = 1000 * 60 * 60 * 24 * 30;

app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const blankStore = () => ({ users: {}, sessions: {} });
async function loadStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try { return JSON.parse(await fs.readFile(DATA_FILE, 'utf8')); }
  catch { const s = blankStore(); await saveStore(s); return s; }
}
async function saveStore(store) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2));
}
function id() { return crypto.randomUUID(); }
function hashText(v) { return crypto.createHmac('sha256', SESSION_SECRET).update(v).digest('hex'); }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, expected) {
  const actual = crypto.scryptSync(password, salt, 64);
  const target = Buffer.from(expected, 'hex');
  return actual.length === target.length && crypto.timingSafeEqual(actual, target);
}
function defaultData(name = 'Friend') {
  return {
    profile: { name, goal: 'Maintain weight', targetCalories: 2000, targetProtein: 120, targetWater: 8, dietStyle: 'Balanced', likes: '', avoid: '' },
    days: {}, weights: [], grocery: [], weeklyReports: [], chat: []
  };
}
async function requireAuth(req, res, next) {
  const raw = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!raw) return res.status(401).json({ error: 'Please sign in.' });
  const store = await loadStore();
  const session = store.sessions[hashText(raw)];
  if (!session || session.expiresAt < Date.now() || !store.users[session.userId]) return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  req.store = store; req.user = store.users[session.userId]; req.userId = session.userId;
  next();
}

app.get('/api/health', (_req, res) => res.json({ ok: true, aiConfigured: Boolean(process.env.OPENAI_API_KEY) }));

app.post('/api/auth/register', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const name = String(req.body?.name || '').trim().slice(0, 60);
  const password = String(req.body?.password || '');
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const store = await loadStore();
  if (Object.values(store.users).some(u => u.email === email)) return res.status(409).json({ error: 'An account already exists for that email.' });
  const userId = id(); const pw = hashPassword(password);
  store.users[userId] = { id: userId, email, name: name || email.split('@')[0], ...pw, data: defaultData(name || email.split('@')[0]) };
  const token = crypto.randomBytes(32).toString('hex');
  store.sessions[hashText(token)] = { userId, expiresAt: Date.now() + TOKEN_TTL };
  await saveStore(store);
  res.json({ token, user: { id: userId, email, name: store.users[userId].name }, data: store.users[userId].data });
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const store = await loadStore();
  const user = Object.values(store.users).find(u => u.email === email);
  if (!user || !verifyPassword(password, user.salt, user.hash)) return res.status(401).json({ error: 'Incorrect email or password.' });
  const token = crypto.randomBytes(32).toString('hex');
  store.sessions[hashText(token)] = { userId: user.id, expiresAt: Date.now() + TOKEN_TTL };
  await saveStore(store);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name }, data: user.data });
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  const raw = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  delete req.store.sessions[hashText(raw)]; await saveStore(req.store); res.json({ ok: true });
});

app.get('/api/me', requireAuth, async (req, res) => res.json({ user: { id: req.user.id, email: req.user.email, name: req.user.name }, data: req.user.data }));
app.put('/api/data', requireAuth, async (req, res) => {
  const data = req.body?.data;
  if (!data || typeof data !== 'object') return res.status(400).json({ error: 'Invalid data.' });
  req.user.data = data; await saveStore(req.store); res.json({ ok: true });
});

function summarizeData(data) {
  const entries = Object.entries(data.days || {}).sort().slice(-7);
  const recent = entries.map(([date, d]) => ({ date, meals: (d.meals || []).map(m => ({ name:m.name, type:m.type, calories:m.calories, protein:m.protein })), water:d.water, habits:d.habits }));
  return { profile: data.profile, recent, weights: (data.weights || []).slice(-8) };
}
async function runAI(instructions, input) {
  if (!process.env.OPENAI_API_KEY) throw Object.assign(new Error('AI is not configured.'), { status: 503 });
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({ model: process.env.OPENAI_MODEL || 'gpt-5.6-luna', instructions, input });
  return response.output_text || 'No response generated.';
}

app.post('/api/chat', requireAuth, async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Write a question first.' });
  try {
    const context = JSON.stringify(summarizeData(req.user.data)).slice(0, 14000);
    const reply = await runAI(`You are a supportive nutrition and habit coach inside a wellness app. Use the supplied app data only as context. Give practical, non-judgmental suggestions. Do not diagnose disease or prescribe treatment. Do not encourage crash diets, purging, starvation, unsafe supplements, or extreme restriction. If pregnancy, eating disorders, serious symptoms, medical conditions, or medically prescribed diets are relevant, recommend a qualified clinician or registered dietitian. Avoid false precision around calorie needs. Keep replies concise and actionable. App data: ${context}`, message);
    res.json({ reply });
  } catch (e) { res.status(e.status || 500).json({ error: e.status === 503 ? e.message : 'AI feedback failed.' }); }
});

app.post('/api/weekly-report', requireAuth, async (req, res) => {
  try {
    const context = JSON.stringify(summarizeData(req.user.data)).slice(0, 16000);
    const report = await runAI(`Create a short weekly nutrition and habit review from the supplied data. Use four headings: Wins, Patterns, Next-week focus, Encouragement. Never diagnose or shame. If data is sparse, say so. Keep recommendations practical and moderate. App data: ${context}`, 'Generate my weekly review.');
    res.json({ report });
  } catch (e) { res.status(e.status || 500).json({ error: e.status === 503 ? e.message : 'Weekly report failed.' }); }
});

app.use((_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(port, () => console.log(`NutriTrack AI v2 running at http://localhost:${port}`));
