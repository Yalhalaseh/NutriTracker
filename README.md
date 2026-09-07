# NutriTrack AI v2

A GitHub-ready nutrition and habit tracking web app with optional OpenAI feedback.

## Features

- Local user accounts with hashed passwords
- Persistent server-side data without a paid database
- Meal logging with calories and protein
- Optional meal photo capture/upload
- Barcode camera scanning when the browser supports `BarcodeDetector`, plus manual UPC entry
- Water and daily habit tracking
- Weight history and trend chart
- Grocery list and meal-plan grocery suggestions
- Flexible diet-plan templates
- Optional ChatGPT-style nutrition feedback through the OpenAI Responses API
- Optional AI-generated weekly review
- Responsive mobile-friendly interface

## Important scope

This project is a wellness/planning starter app, not a medical device. It should not be used to diagnose disease or replace individualized care from a physician or registered dietitian. The included file-based data store is appropriate for personal prototypes and demos, not regulated health data or high-scale production use.

## Run locally

1. Install Node.js 20 or newer.
2. Clone the repository.
3. Install dependencies:

```bash
npm install
```

4. Copy the environment template:

```bash
cp .env.example .env
```

5. Change `SESSION_SECRET` in `.env` to a long random value.
6. Optional: add `OPENAI_API_KEY` to enable AI feedback. The default AI model is `gpt-5.6-luna`; you can change `OPENAI_MODEL` in `.env`.
7. Start the app:

```bash
npm start
```

8. Open `http://localhost:3000`.

## GitHub

```bash
git init
git add .
git commit -m "Build NutriTrack AI v2"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

## Deployment notes

The current version writes account data to `data/store.json`. This keeps the starter inexpensive, but many serverless hosts use ephemeral storage. For a durable public deployment, migrate the persistence layer to PostgreSQL/Supabase/Neon or another managed database.

Meal photos are stored as compressed/base64 browser uploads inside the same data store. For a public product, move images to object storage such as Supabase Storage, S3-compatible storage, or Cloudflare R2.

## Suggested production upgrades

- PostgreSQL database and proper migration system
- Email verification and password-reset flow
- Object storage for meal images
- Food nutrition database integration for barcode lookup
- Rate limiting and CSRF/security hardening
- Privacy policy, terms, consent, export/delete-account flows
- Automated tests and CI/CD
