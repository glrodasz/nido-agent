# Setup: Google Cloud, Firebase and GitHub Actions

How to get Nido running at `https://<project>.web.app` for your family. Everything is
reproducible: `infra/bootstrap.sh` is idempotent and `.github/workflows/deploy.yml` does the rest.

```
Browser ── https://<project>.web.app ──► Firebase Hosting (static Astro build, web/dist)
   │  Google sign-in (Firebase Auth)          │  /api/** rewrite
   │                                          ▼
   └── Authorization: Bearer <ID token> ──► Cloud Run service nido-api (europe-north1)
                                              │  checks the token and NIDO_ALLOWED_EMAILS
                                              ├─► Firestore: families/, watchlist/, cache/
                                              ├─► TMDB, OMDb (keys from Secret Manager)
                                              └─► Gemini API (free tier key, chat only)
```

| Workflow | When | What |
|---|---|---|
| `ci.yml` | every push and pull request | ruff, pytest, web `astro check` + vitest + build, `docker build` |
| `deploy.yml` | push to `main` touching code, web or deploy files; or manual from `main` | build and push the image, `gcloud run deploy nido-api`, build the web app, `firebase deploy` (hosting + Firestore rules) |

## 1. Create the project

1. In the [Google Cloud console](https://console.cloud.google.com/projectcreate) create a project
   (or pick one) and **link a billing account**. Cloud Run and Secret Manager require billing even
   when usage stays inside the free tier; step 2 adds a budget and a kill switch.
2. In the [Firebase console](https://console.firebase.google.com/) choose **Add project** and
   select that Google Cloud project. Analytics is not needed.
3. Firebase console > **Build > Authentication > Get started > Sign-in method > Google > Enable**.
4. Firebase console > **Project settings > Your apps > Web (`</>`)**: register an app (no Hosting
   checkbox needed). Note `apiKey`, `authDomain` and `appId`. They are public identifiers, not
   secrets.

## 2. Bootstrap Google Cloud

In [Cloud Shell](https://shell.cloud.google.com/) (it has `gcloud` and `gh`):

```bash
git clone https://github.com/glrodasz/nido-agent.git && cd nido-agent
# Optional: the keys are stored in Secret Manager on the first run.
export TMDB_API_TOKEN=... OMDB_API_KEY=... GOOGLE_API_KEY=...
PROJECT_ID=my-project ./infra/bootstrap.sh
# A billing account in SEK (or any currency other than USD/EUR/GBP/CHF) needs an amount:
PROJECT_ID=my-project BUDGET_AMOUNT=50 ./infra/bootstrap.sh
```

| Variable | Default | Purpose |
|---|---|---|
| `PROJECT_ID` | (required) | Google Cloud project |
| `REGION` | `europe-north1` | Cloud Run, Artifact Registry |
| `FIRESTORE_LOCATION` | `$REGION` | Firestore database location (cannot change later) |
| `BUDGET_AMOUNT` | 5 in USD, EUR, GBP or CHF | monthly budget in the billing account's currency |
| `BILLING_CAP` | `1` | `1` = unlink billing when the budget is spent; `0` = email alerts only |
| `BILLING_CAP_REGION` | `europe-west1` | Workflows and Eventarc region for the kill switch |
| `GITHUB_REPO` / `GITHUB_BRANCH` | `glrodasz/nido-agent` / `main` | the only repo and branch Workload Identity Federation trusts |

What it creates:

| Resource | Detail |
|---|---|
| Firestore `(default)` | native mode; TTL policy on `cache.expire_at` |
| Artifact Registry `nido` | Docker, keeps the 5 most recent images |
| Secrets `nido-tmdb-token`, `nido-omdb-key`, `nido-gemini-key` | values from the environment on first run only |
| `nido-api@` | Cloud Run identity: `datastore.user`, `logging.logWriter`, `secretAccessor` on the three secrets |
| `nido-github@` | deploys: `artifactregistry.writer`, `run.developer`, `firebasehosting.admin`, `firebaserules.admin`, `serviceUsageConsumer`, `serviceAccountUser` on `nido-api`, `secretmanager.viewer` on the secrets |
| Workload Identity Federation | pool and provider `github`, restricted to `glrodasz/nido-agent` on `main` |
| Cloud Run `nido-api` | placeholder image until the first deploy; public invoker (see below), max 1 instance |
| Budget + kill switch | as in haggler-agent: Pub/Sub topic `nido-budget`, workflow and Eventarc trigger `nido-billing-cap` |

No service account keys are created: GitHub Actions uses short-lived OIDC tokens.

**Why the Cloud Run service is public.** Firebase Hosting forwards `/api/**` without credentials,
so the service must accept unauthenticated calls. The app itself rejects every request without a
valid Firebase ID token for this project from a verified email, except `/api/health` and
`/api/config`, and every family endpoint also needs a family membership: an email in
`NIDO_ALLOWED_EMAILS` starts its own family on first sign-in, any other account only gets in by
opening an invite link that a family member made in the Family tab (single use, valid 7 days).
With an empty allowlist nobody can start a family.

Add a missing key later with:

```bash
printf %s "$GOOGLE_API_KEY" | gcloud secrets versions add nido-gemini-key --data-file=- --project my-project
```

## 3. GitHub repository variables

Settings > Secrets and variables > Actions > **Variables** (none of these is a credential). The
bootstrap prints the `gh variable set` commands with the values filled in.

| Variable | Example |
|---|---|
| `GCP_PROJECT_ID` | `my-project` |
| `GCP_REGION` | `europe-north1` |
| `GCP_WIF_PROVIDER` | `projects/123/locations/global/workloadIdentityPools/github/providers/github` |
| `GCP_GITHUB_SA` | `nido-github@my-project.iam.gserviceaccount.com` |
| `GCP_API_SA` | `nido-api@my-project.iam.gserviceaccount.com` |
| `AR_REPOSITORY` | `nido` |
| `NIDO_ALLOWED_EMAILS` | `you@gmail.com` (who may start a family; others join by invite link) |
| `FIREBASE_API_KEY` | from step 1.4 |
| `FIREBASE_AUTH_DOMAIN` | `my-project.firebaseapp.com` |
| `FIREBASE_APP_ID` | `1:123:web:abc` |
| `NIDO_MODEL`, `NIDO_FALLBACK_MODEL`, `NIDO_REGIONS`, `NIDO_MAX_CHAT_TURNS_PER_DAY`, `NIDO_MAX_SEARCHES_PER_DAY` | optional overrides of the defaults in `src/nido/config.py` (`NIDO_FALLBACK_MODEL=none` turns the fallback off) |

Until they are all set, `deploy.yml` only leaves a notice.

## 4. Deploy

Merge to `main` or run **Actions > deploy > Run workflow** on `main`. The summary links the app.
Sign in with an allowed Google account and fill in the family profile. To share it, open the
Family tab, press **Invite someone** and send the link: whoever opens it and signs in with Google
joins your family and sees the same profile, watchlist and marks.

## Running it locally

```bash
uv sync && cp .env.example .env     # TMDB_API_TOKEN, OMDB_API_KEY, optional GOOGLE_API_KEY
uv run nido serve                   # API on http://127.0.0.1:8080, no sign-in, memory store
cd web && npm install && npm run dev  # web app on http://localhost:4321, /api proxied to 8080
```

Or one origin: `(cd web && npm run build) && NIDO_WEB_DIR=web/dist uv run nido serve`.

Without `GOOGLE_API_KEY` the chat box is hidden and the filter search still works.

## Cost guard

- Cloud Run scales to zero, runs at most one instance, and bills only while a request runs.
- Each chat turn is capped at `NIDO_MAX_LLM_CALLS` model calls. Each family (all its members
  together) gets `NIDO_MAX_CHAT_TURNS_PER_DAY` Ask Nido turns (default 40) and
  `NIDO_MAX_SEARCHES_PER_DAY` searches (default 150) per UTC day, counted in Firestore so a
  restart does not reset them. Families whose owner is on `NIDO_ALLOWED_EMAILS` have no limit
  and see today's usage instead. The filter search never calls the model.
- TMDB details are cached for a day and IMDb scores for a week in Firestore, so repeated searches
  do not spend the OMDb free quota.
- The budget sends emails at 50, 90 and 100 % and the kill switch unlinks billing at 100 %.
  Billing data lags by hours, so spend can overshoot slightly before it fires.

Free-tier limits change; check the current Cloud Run, Firestore and Gemini API quotas before
relying on them.

### Billing kill switch

`infra/billing_cap.yaml` runs on every budget notification and, once the month's actual cost
reaches the budget, sets the project's billing account to none. Every paid service stops,
including Cloud Run. Forecasts never trigger it.

### Recovering from the kill switch

Billing > Account management > **Link a billing account** for the project, then re-run the
`deploy` workflow. Firestore data and secrets survive a short outage, but Google may delete
resources of a project left without billing for long, so relink soon.
