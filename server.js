import 'dotenv/config';

import express from 'express';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const app = express();
const port = Number(process.env.PORT || 3000);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const blankStore = () => ({
  users: {}
});

async function loadStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    return JSON.parse(
      await fs.readFile(DATA_FILE, 'utf8')
    );
  } catch {
    const store = blankStore();
    await saveStore(store);
    return store;
  }
}

async function saveStore(store) {
  await fs.mkdir(DATA_DIR, { recursive: true });

  await fs.writeFile(
    DATA_FILE,
    JSON.stringify(store, null, 2)
  );
}

function defaultData(name = 'Friend') {
  return {
    profile: {
      name,
      goal: 'Maintain weight',
      targetCalories: 2000,
      targetProtein: 120,
      targetWater: 8,
      dietStyle: 'Balanced',
      likes: '',
      avoid: ''
    },

    days: {},
    weights: [],
    grocery: [],
    weeklyReports: [],
    chat: []
  };
}

async function getOrCreateLocalUser(supabaseUser) {
  const store = await loadStore();

  const userId = supabaseUser.id;

  const name =
    supabaseUser.user_metadata?.name ||
    supabaseUser.user_metadata?.full_name ||
    supabaseUser.email?.split('@')[0] ||
    'Friend';

  if (!store.users[userId]) {
    store.users[userId] = {
      id: userId,
      email: supabaseUser.email,
      name,
      data: defaultData(name)
    };

    await saveStore(store);
  } else {
    store.users[userId].email =
      supabaseUser.email;

    if (!store.users[userId].name) {
      store.users[userId].name = name;
    }

    await saveStore(store);
  }

  return {
    store,
    user: store.users[userId]
  };
}

async function requireAuth(req, res, next) {
  const token = (
    req.headers.authorization || ''
  ).replace(/^Bearer\s+/i, '');

  if (!token) {
    return res.status(401).json({
      error: 'Please sign in.'
    });
  }

  const {
    data,
    error
  } = await supabase.auth.getUser(token);

  if (
    error ||
    !data?.user
  ) {
    return res.status(401).json({
      error:
        'Session expired. Please sign in again.'
    });
  }

  const {
    store,
    user
  } = await getOrCreateLocalUser(
    data.user
  );

  req.accessToken = token;
  req.supabaseUser = data.user;
  req.store = store;
  req.user = user;
  req.userId = data.user.id;

  next();
}

app.get(
  '/api/health',
  (_req, res) => {
    res.json({
      ok: true,

      aiConfigured: Boolean(
        process.env.OPENAI_API_KEY
      ),

      supabaseConfigured: Boolean(
        process.env.SUPABASE_URL &&
        process.env.SUPABASE_ANON_KEY
      )
    });
  }
);

app.post(
  '/api/auth/register',
  async (req, res) => {
    const email = String(
      req.body?.email || ''
    )
      .trim()
      .toLowerCase();

    const name = String(
      req.body?.name || ''
    )
      .trim()
      .slice(0, 60);

    const password = String(
      req.body?.password || ''
    );

    if (
      !/^\S+@\S+\.\S+$/.test(email)
    ) {
      return res
        .status(400)
        .json({
          error:
            'Enter a valid email.'
        });
    }

    if (password.length < 8) {
      return res
        .status(400)
        .json({
          error:
            'Password must be at least 8 characters.'
        });
    }

    const {
      data,
      error
    } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name:
            name ||
            email.split('@')[0]
        }
      }
    });

    if (error) {
      return res
        .status(400)
        .json({
          error: error.message
        });
    }

    if (!data.user) {
      return res
        .status(400)
        .json({
          error:
            'Unable to create account.'
        });
    }

    const {
      user
    } = await getOrCreateLocalUser(
      data.user
    );

    if (!data.session?.access_token) {
      return res.json({
        needsConfirmation: true,
        message:
          'Account created. Check your email if confirmation is required.'
      });
    }

    res.json({
      token:
        data.session.access_token,

      user: {
        id: data.user.id,
        email: data.user.email,
        name: user.name
      },

      data: user.data
    });
  }
);

app.post(
  '/api/auth/login',
  async (req, res) => {
    const email = String(
      req.body?.email || ''
    )
      .trim()
      .toLowerCase();

    const password = String(
      req.body?.password || ''
    );

    const {
      data,
      error
    } =
      await supabase.auth.signInWithPassword({
        email,
        password
      });

    if (
      error ||
      !data.user ||
      !data.session
    ) {
      return res
        .status(401)
        .json({
          error:
            error?.message ||
            'Incorrect email or password.'
        });
    }

    const {
      user
    } = await getOrCreateLocalUser(
      data.user
    );

    res.json({
      token:
        data.session.access_token,

      user: {
        id: data.user.id,
        email: data.user.email,
        name: user.name
      },

      data: user.data
    });
  }
);

app.post(
  '/api/auth/logout',
  requireAuth,
  async (_req, res) => {
    res.json({
      ok: true
    });
  }
);

app.get(
  '/api/me',
  requireAuth,
  async (req, res) => {
    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name
      },

      data: req.user.data
    });
  }
);

app.put(
  '/api/data',
  requireAuth,
  async (req, res) => {
    const data =
      req.body?.data;

    if (
      !data ||
      typeof data !== 'object'
    ) {
      return res
        .status(400)
        .json({
          error:
            'Invalid data.'
        });
    }

    req.user.data = data;

    await saveStore(
      req.store
    );

    res.json({
      ok: true
    });
  }
);

function summarizeData(data) {
  const entries =
    Object.entries(
      data.days || {}
    )
      .sort()
      .slice(-7);

  const recent =
    entries.map(
      ([date, day]) => ({
        date,

        meals: (
          day.meals || []
        ).map((meal) => ({
          name: meal.name,
          type: meal.type,
          calories:
            meal.calories,
          protein:
            meal.protein
        })),

        water:
          day.water,

        habits:
          day.habits
      })
    );

  return {
    profile:
      data.profile,

    recent,

    weights: (
      data.weights || []
    ).slice(-8)
  };
}

async function runAI(
  instructions,
  input
) {
  if (
    !process.env
      .OPENAI_API_KEY
  ) {
    throw Object.assign(
      new Error(
        'AI is not configured.'
      ),
      {
        status: 503
      }
    );
  }

  const client =
    new OpenAI({
      apiKey:
        process.env
          .OPENAI_API_KEY
    });

  const response =
    await client.responses.create({
      model:
        process.env
          .OPENAI_MODEL ||
        'gpt-5.6-luna',

      instructions,
      input
    });

  return (
    response.output_text ||
    'No response generated.'
  );
}

app.post(
  '/api/chat',
  requireAuth,
  async (req, res) => {
    const message = String(
      req.body?.message || ''
    ).trim();

    if (!message) {
      return res
        .status(400)
        .json({
          error:
            'Write a question first.'
        });
    }

    try {
      const context =
        JSON.stringify(
          summarizeData(
            req.user.data
          )
        ).slice(
          0,
          14000
        );

      const reply =
        await runAI(
          `You are a supportive nutrition and habit coach inside a wellness app. Use the supplied app data only as context. Give practical, non-judgmental suggestions. Do not diagnose disease or prescribe treatment. Do not encourage crash diets, purging, starvation, unsafe supplements, or extreme restriction. If pregnancy, eating disorders, serious symptoms, medical conditions, or medically prescribed diets are relevant, recommend a qualified clinician or registered dietitian. Avoid false precision around calorie needs. Keep replies concise and actionable. App data: ${context}`,
          message
        );

      res.json({
        reply
      });
    } catch (error) {
      res
        .status(
          error.status || 500
        )
        .json({
          error:
            error.status === 503
              ? error.message
              : 'AI feedback failed.'
        });
    }
  }
);

app.post(
  '/api/weekly-report',
  requireAuth,
  async (req, res) => {
    try {
      const context =
        JSON.stringify(
          summarizeData(
            req.user.data
          )
        ).slice(
          0,
          16000
        );

      const report =
        await runAI(
          `Create a short weekly nutrition and habit review from the supplied data. Use four headings: Wins, Patterns, Next-week focus, Encouragement. Never diagnose or shame. If data is sparse, say so. Keep recommendations practical and moderate. App data: ${context}`,
          'Generate my weekly review.'
        );

      res.json({
        report
      });
    } catch (error) {
      res
        .status(
          error.status || 500
        )
        .json({
          error:
            error.status === 503
              ? error.message
              : 'Weekly report failed.'
        });
    }
  }
);

app.use(
  (_req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        'public',
        'index.html'
      )
    );
  }
);

app.listen(
  port,
  () => {
    console.log(
      `NutriTrack AI running at http://localhost:${port}`
    );
  }
);
