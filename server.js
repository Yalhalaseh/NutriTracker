import 'dotenv/config';

import express from 'express';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const port = Number(process.env.PORT || 3000);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL) {
  console.error('Missing SUPABASE_URL');
}

if (!SUPABASE_ANON_KEY) {
  console.error('Missing SUPABASE_ANON_KEY');
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));


/* =========================================================
   DEFAULT USER DATA
   ========================================================= */

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


/* =========================================================
   CREATE SUPABASE CLIENT FOR LOGGED-IN USER
   ========================================================= */

function createUserClient(token) {
  return createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      },

      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    }
  );
}


/* =========================================================
   LOAD USER STATE
   ========================================================= */

async function loadUserState(token, user) {

  const client = createUserClient(token);

  const {
    data,
    error
  } = await client
    .from('user_state')
    .select('data')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    console.error('Load user_state error:', error);
    throw error;
  }


  /*
    Existing user
  */

  if (data?.data) {
    return data.data;
  }


  /*
    New user
  */

  const name =
    user.user_metadata?.name ||
    user.user_metadata?.full_name ||
    user.email?.split('@')[0] ||
    'Friend';

  const initialData = defaultData(name);


  const {
    error: insertError
  } = await client
    .from('user_state')
    .insert({
      user_id: user.id,
      data: initialData,
      updated_at: new Date().toISOString()
    });


  /*
    If another request already created the row,
    try loading it again instead of destroying anything.
  */

  if (insertError) {

    console.error(
      'Initial user_state insert error:',
      insertError
    );

    const {
      data: retryData,
      error: retryError
    } = await client
      .from('user_state')
      .select('data')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!retryError && retryData?.data) {
      return retryData.data;
    }

    throw insertError;
  }


  return initialData;
}


/* =========================================================
   AUTHENTICATION MIDDLEWARE
   ========================================================= */

async function requireAuth(req, res, next) {

  try {

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


    if (error || !data?.user) {

      return res.status(401).json({
        error:
          'Session expired. Please sign in again.'
      });

    }


    const userData =
      await loadUserState(
        token,
        data.user
      );


    req.accessToken = token;
    req.supabaseUser = data.user;
    req.userData = userData;

    next();

  } catch (error) {

    console.error(
      'Authentication error:',
      error
    );

    res.status(500).json({
      error:
        'Unable to load your account.'
    });

  }

}


/* =========================================================
   HEALTH CHECK
   ========================================================= */

app.get(
  '/api/health',
  (_req, res) => {

    res.json({

      ok: true,

      aiConfigured:
        Boolean(
          process.env.OPENAI_API_KEY
        ),

      supabaseConfigured:
        Boolean(
          SUPABASE_URL &&
          SUPABASE_ANON_KEY
        )

    });

  }
);


/* =========================================================
   CREATE ACCOUNT
   ========================================================= */

app.post(
  '/api/auth/register',
  async (req, res) => {

    try {

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


      if (
        password.length < 8
      ) {

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
      } =
        await supabase.auth.signUp({

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


      /*
        Email confirmation enabled
      */

      if (
        !data.session?.access_token
      ) {

        return res.json({

          needsConfirmation: true,

          message:
            'Account created. Please confirm your email, then sign in.'

        });

      }


      const token =
        data.session.access_token;


      const userData =
        await loadUserState(
          token,
          data.user
        );


      res.json({

        token,

        user: {

          id: data.user.id,

          email:
            data.user.email,

          name:
            data.user
              .user_metadata
              ?.name ||
            email.split('@')[0]

        },

        data: userData

      });


    } catch (error) {

      console.error(
        'Registration error:',
        error
      );

      res.status(500).json({
        error:
          'Unable to create account.'
      });

    }

  }
);


/* =========================================================
   LOGIN
   ========================================================= */

app.post(
  '/api/auth/login',
  async (req, res) => {

    try {

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
        await supabase.auth
          .signInWithPassword({
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


      const token =
        data.session.access_token;


      const userData =
        await loadUserState(
          token,
          data.user
        );


      res.json({

        token,

        user: {

          id:
            data.user.id,

          email:
            data.user.email,

          name:
            data.user
              .user_metadata
              ?.name ||
            data.user.email
              ?.split('@')[0] ||
            'Friend'

        },

        data:
          userData

      });


    } catch (error) {

      console.error(
        'Login error:',
        error
      );

      res.status(500).json({
        error:
          'Unable to sign in.'
      });

    }

  }
);


/* =========================================================
   LOGOUT
   ========================================================= */

app.post(
  '/api/auth/logout',
  requireAuth,
  async (req, res) => {

    try {

      const client =
        createUserClient(
          req.accessToken
        );

      await client.auth.signOut();

    } catch (error) {

      console.error(
        'Logout error:',
        error
      );

    }


    res.json({
      ok: true
    });

  }
);


/* =========================================================
   CURRENT USER
   ========================================================= */

app.get(
  '/api/me',
  requireAuth,
  async (req, res) => {

    const user =
      req.supabaseUser;


    res.json({

      user: {

        id:
          user.id,

        email:
          user.email,

        name:
          user.user_metadata
            ?.name ||
          user.email
            ?.split('@')[0] ||
          'Friend'

      },

      data:
        req.userData

    });

  }
);


/* =========================================================
   SAVE ALL NUTRITION DATA
   ========================================================= */

app.put(
  '/api/data',
  requireAuth,
  async (req, res) => {

    try {

      const data =
        req.body?.data;


      if (
        !data ||
        typeof data !== 'object' ||
        Array.isArray(data)
      ) {

        return res
          .status(400)
          .json({
            error:
              'Invalid data.'
          });

      }


      /*
        Never allow the browser to choose
        which user owns this row.

        The authenticated Supabase user's ID
        is always used here.
      */

      const userId =
        req.supabaseUser.id;


      const client =
        createUserClient(
          req.accessToken
        );


      const {
        error
      } = await client
        .from('user_state')
        .upsert(

          {

            user_id:
              userId,

            data,

            updated_at:
              new Date()
                .toISOString()

          },

          {

            onConflict:
              'user_id'

          }

        );


      if (error) {

        console.error(
          'SAVE FAILED:',
          error
        );

        return res
          .status(500)
          .json({

            error:
              'Unable to save progress.',

            details:
              error.message

          });

      }


      console.log(
        `Saved NutriTrack state for user ${userId}`
      );


      res.json({

        ok: true,

        savedAt:
          new Date()
            .toISOString()

      });


    } catch (error) {

      console.error(
        'Data save error:',
        error
      );


      res.status(500).json({

        error:
          'Unable to save progress.'

      });

    }

  }
);


/* =========================================================
   SUMMARIZE DATA FOR AI
   ========================================================= */

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

        meals:
          (day.meals || [])
            .map(
              meal => ({

                name:
                  meal.name,

                type:
                  meal.type,

                calories:
                  meal.calories,

                protein:
                  meal.protein

              })
            ),

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

    weights:
      (data.weights || [])
        .slice(-8)

  };

}


/* =========================================================
   OPENAI HELPER
   ========================================================= */

async function runAI(
  instructions,
  input
) {

  if (
    !process.env.OPENAI_API_KEY
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
        process.env.OPENAI_API_KEY

    });


  const response =
    await client.responses.create({

      model:
        process.env.OPENAI_MODEL ||
        'gpt-5.6-luna',

      instructions,

      input

    });


  return (
    response.output_text ||
    'No response generated.'
  );

}


/* =========================================================
   AI COACH
   ========================================================= */

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
            req.userData
          )
        ).slice(
          0,
          14000
        );


      const reply =
        await runAI(

          `You are a supportive nutrition and habit coach inside a wellness app.

Use the supplied app data only as context.

Give practical, non-judgmental suggestions.

Do not diagnose disease or prescribe treatment.

Do not encourage crash diets, starvation, purging, unsafe supplements, or extreme restriction.

If pregnancy, eating disorders, serious symptoms, medical conditions, or medically prescribed diets are relevant, recommend a qualified clinician or registered dietitian.

Keep replies concise and actionable.

App data:

${context}`,

          message

        );


      res.json({
        reply
      });


    } catch (error) {

      console.error(
        'AI chat error:',
        error
      );


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


/* =========================================================
   WEEKLY REPORT
   ========================================================= */

app.post(
  '/api/weekly-report',
  requireAuth,
  async (req, res) => {

    try {

      const context =
        JSON.stringify(
          summarizeData(
            req.userData
          )
        ).slice(
          0,
          16000
        );


      const report =
        await runAI(

          `Create a short weekly nutrition and habit review from the supplied data.

Use four headings:

Wins
Patterns
Next-week focus
Encouragement

Never diagnose or shame.

If data is sparse, say so.

Keep recommendations practical and moderate.

App data:

${context}`,

          'Generate my weekly review.'

        );


      res.json({
        report
      });


    } catch (error) {

      console.error(
        'Weekly report error:',
        error
      );


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


/* =========================================================
   APPLICATION FALLBACK
   ========================================================= */

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


/* =========================================================
   START SERVER
   ========================================================= */

app.listen(
  port,
  () => {

    console.log(
      `NutriTrack AI running on port ${port}`
    );

    console.log(
      `Supabase configured: ${
        Boolean(
          SUPABASE_URL &&
          SUPABASE_ANON_KEY
        )
      }`
    );

  }
);
