#!/usr/bin/env bash
# One-time (and re-runnable) Google Cloud setup for nido-agent. See docs/SETUP.md.
#
#   PROJECT_ID=my-project ./infra/bootstrap.sh
#
# Optional: export TMDB_API_TOKEN, OMDB_API_KEY and GOOGLE_API_KEY first and they are stored in
# Secret Manager (only when the secret has no version yet; never overwritten).
#
# Idempotent: every resource is created only if a describe call says it is missing; IAM bindings
# are re-applied (a no-op when they exist). The script never changes your gcloud configuration.
#
# Creates: APIs, Firestore (native mode, TTL on cache/expire_at), Artifact Registry repo (keeps 5
# versions), Secret Manager secrets for the API keys, service accounts nido-api / nido-github,
# Workload Identity Federation for GitHub Actions, a placeholder Cloud Run service nido-api that
# allows unauthenticated calls (Firebase Hosting forwards /api/** to it; the app checks Firebase
# sign-in itself), a monthly budget with email alerts and, unless BILLING_CAP=0, a kill switch
# that unlinks billing once actual spend reaches the budget. Prints the GitHub variables.

set -euo pipefail

# --- Configuration (override via environment) ------------------------------------------------
: "${PROJECT_ID:?Set PROJECT_ID, e.g. PROJECT_ID=my-project ./infra/bootstrap.sh}"
# europe-north1 (Finland): Cloud Run's lower price tier, close to Sweden.
REGION="${REGION:-europe-north1}"
FIRESTORE_LOCATION="${FIRESTORE_LOCATION:-${REGION}}"
GITHUB_REPO="${GITHUB_REPO:-glrodasz/nido-agent}"
# Only workflows running on this branch may impersonate nido-github.
GITHUB_BRANCH="${GITHUB_BRANCH:-main}"
AR_REPO="${AR_REPO:-nido}"
SERVICE="${SERVICE:-nido-api}"
WIF_POOL="${WIF_POOL:-github}"
WIF_PROVIDER="${WIF_PROVIDER:-github}"
PLACEHOLDER_IMAGE="${PLACEHOLDER_IMAGE:-us-docker.pkg.dev/cloudrun/container/hello:latest}"
# Monthly budget, in the billing account's currency. Empty = 5 when that currency is USD, EUR,
# GBP or CHF; any other currency needs an explicit amount (5 SEK would cut the project off).
BUDGET_AMOUNT="${BUDGET_AMOUNT:-}"
# 1 = unlink billing once actual spend reaches BUDGET_AMOUNT; 0 = email alerts only.
BILLING_CAP="${BILLING_CAP:-1}"
# Workflows and Eventarc are not offered in every region.
BILLING_CAP_REGION="${BILLING_CAP_REGION:-europe-west1}"
BUDGET_NAME="nido ${PROJECT_ID}"
BUDGET_TOPIC="nido-budget"
BILLING_CAP_NAME="nido-billing-cap"

API_SA_NAME="nido-api"
GITHUB_SA_NAME="nido-github"
API_SA="${API_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
GITHUB_SA="${GITHUB_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
BILLING_SA="${BILLING_CAP_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# secret name -> environment variable that may hold its first value
SECRETS=(nido-tmdb-token:TMDB_API_TOKEN nido-omdb-key:OMDB_API_KEY nido-gemini-key:GOOGLE_API_KEY)

APIS=(
  run.googleapis.com
  artifactregistry.googleapis.com
  firestore.googleapis.com
  secretmanager.googleapis.com
  firebase.googleapis.com
  firebasehosting.googleapis.com
  firebaserules.googleapis.com
  identitytoolkit.googleapis.com
  iam.googleapis.com
  iamcredentials.googleapis.com
  sts.googleapis.com
  logging.googleapis.com
  cloudbuild.googleapis.com
  cloudbilling.googleapis.com
  billingbudgets.googleapis.com
  pubsub.googleapis.com
  serviceusage.googleapis.com
)
if [[ "${BILLING_CAP}" == 1 ]]; then
  APIS+=(workflows.googleapis.com eventarc.googleapis.com)
fi

export CLOUDSDK_CORE_PROJECT="${PROJECT_ID}"
export CLOUDSDK_CORE_DISABLE_PROMPTS=1

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

# --- Helpers -----------------------------------------------------------------------------------
step() { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}
WARNINGS=()
warn() {
  printf '    WARNING: %s\n' "$*" >&2
  WARNINGS+=("$*")
}
exists() { "$@" >/dev/null 2>&1; }

# IAM is eventually consistent: a service account created seconds ago can be "not found" by the
# next binding call. Retry a few times before giving up.
retry() {
  local attempt=1 max=6 delay=10
  until "$@"; do
    ((attempt >= max)) && return 1
    info "retrying in ${delay}s (${attempt}/${max})..."
    sleep "${delay}"
    attempt=$((attempt + 1))
  done
}

bind_project() { # member role
  retry gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="$1" --role="$2" --condition=None --format=none
  info "project: $2 -> $1"
}

bind_sa() { # target_sa member role
  retry gcloud iam service-accounts add-iam-policy-binding "$1" \
    --member="$2" --role="$3" --format=none
  info "${1}: $3 -> $2"
}

bind_secret() { # secret member role
  retry gcloud secrets add-iam-policy-binding "$1" --member="$2" --role="$3" --format=none
  info "secret $1: $3 -> $2"
}

ensure_sa() { # name display_name
  local email="$1@${PROJECT_ID}.iam.gserviceaccount.com"
  if exists gcloud iam service-accounts describe "${email}"; then
    info "service account ${email} already exists"
  else
    gcloud iam service-accounts create "$1" --display-name="$2" --format=none
    info "created service account ${email}"
  fi
}

# --- Preflight ---------------------------------------------------------------------------------
step "Preflight"
command -v gcloud >/dev/null 2>&1 || die "gcloud CLI not found (https://cloud.google.com/sdk)"
ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null |
  head -n1 || true)"
[[ -n "${ACCOUNT}" ]] || die "no active gcloud account; run: gcloud auth login"
PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')" ||
  die "cannot read project ${PROJECT_ID} (does it exist, and can ${ACCOUNT} see it?)"
info "account=${ACCOUNT} project=${PROJECT_ID} (#${PROJECT_NUMBER}) region=${REGION}"
case "${BILLING_CAP}" in
  0 | 1) ;;
  *) die "BILLING_CAP must be 0 (alerts only) or 1 (kill switch), got '${BILLING_CAP}'" ;;
esac
if [[ -n "${BUDGET_AMOUNT}" ]]; then
  [[ "${BUDGET_AMOUNT}" =~ ^[0-9]+([.][0-9]{1,2})?$ ]] ||
    die "BUDGET_AMOUNT must be a plain amount such as 5 or 7.50 (the billing account's currency)"
  [[ ! "${BUDGET_AMOUNT}" =~ ^0+([.]0+)?$ ]] || die "BUDGET_AMOUNT must be greater than 0"
fi
if [[ "${BILLING_CAP}" == 1 ]]; then
  [[ -f "${SCRIPT_DIR}/billing_cap.yaml" ]] || die "missing ${SCRIPT_DIR}/billing_cap.yaml"
fi
BILLING="$(gcloud billing projects describe "${PROJECT_ID}" --format='value(billingEnabled)' \
  2>/dev/null || true)"
case "${BILLING}" in
  False | false) die "billing is not enabled on ${PROJECT_ID}; Cloud Run and Secret Manager need it" ;;
esac

# --- APIs --------------------------------------------------------------------------------------
step "APIs"
ENABLED="$(gcloud services list --enabled --format='value(config.name)')"
MISSING=()
for api in "${APIS[@]}"; do
  grep -qxF "${api}" <<<"${ENABLED}" || MISSING+=("${api}")
done
if ((${#MISSING[@]})); then
  info "enabling: ${MISSING[*]}"
  gcloud services enable "${MISSING[@]}"
else
  info "all ${#APIS[@]} APIs already enabled"
fi

# --- Firestore -----------------------------------------------------------------------------------
# Only the (default) database gets Firestore's free quota.
step "Firestore (default) database (${FIRESTORE_LOCATION})"
if exists gcloud firestore databases describe --database='(default)'; then
  info "already exists"
else
  gcloud firestore databases create --database='(default)' --location="${FIRESTORE_LOCATION}" \
    --type=firestore-native --format=none
  info "created"
fi
# Cached API responses carry expire_at; Firestore deletes them some time after it passes.
gcloud firestore fields ttls update expire_at --collection-group=cache --enable-ttl \
  --format=none --async ||
  warn "could not enable the TTL policy on cache.expire_at (stale cache entries stay; harmless)"
info "TTL policy on cache.expire_at"

# --- Artifact Registry ---------------------------------------------------------------------------
step "Artifact Registry repository ${AR_REPO} (${REGION})"
if exists gcloud artifacts repositories describe "${AR_REPO}" --location="${REGION}"; then
  info "already exists"
else
  gcloud artifacts repositories create "${AR_REPO}" --location="${REGION}" \
    --repository-format=docker --description="nido-agent images" --format=none
  info "created"
fi
cat >"${TMP_DIR}/cleanup.json" <<'JSON'
[
  {"name": "keep-5-most-recent", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 5}},
  {"name": "delete-older", "action": {"type": "Delete"}, "condition": {"tagState": "any", "olderThan": "1d"}}
]
JSON
gcloud artifacts repositories set-cleanup-policies "${AR_REPO}" --location="${REGION}" \
  --policy="${TMP_DIR}/cleanup.json" --no-dry-run --format=none
info "cleanup policy: keep 5 most recent versions"

# --- Service accounts --------------------------------------------------------------------------
step "Service accounts"
ensure_sa "${API_SA_NAME}" "nido API (Cloud Run)"
ensure_sa "${GITHUB_SA_NAME}" "nido GitHub Actions (deploy)"

step "IAM: ${API_SA_NAME}"
bind_project "serviceAccount:${API_SA}" roles/datastore.user
bind_project "serviceAccount:${API_SA}" roles/logging.logWriter

step "IAM: ${GITHUB_SA_NAME}"
retry gcloud artifacts repositories add-iam-policy-binding "${AR_REPO}" --location="${REGION}" \
  --member="serviceAccount:${GITHUB_SA}" --role=roles/artifactregistry.writer --format=none
info "Artifact Registry ${AR_REPO}: roles/artifactregistry.writer -> ${GITHUB_SA}"
bind_project "serviceAccount:${GITHUB_SA}" roles/run.developer
bind_project "serviceAccount:${GITHUB_SA}" roles/firebasehosting.admin
bind_project "serviceAccount:${GITHUB_SA}" roles/firebaserules.admin
bind_project "serviceAccount:${GITHUB_SA}" roles/serviceusage.serviceUsageConsumer
# Needed to deploy a service that runs as nido-api.
bind_sa "${API_SA}" "serviceAccount:${GITHUB_SA}" roles/iam.serviceAccountUser

# --- Secrets -----------------------------------------------------------------------------------
step "Secret Manager"
for entry in "${SECRETS[@]}"; do
  secret="${entry%%:*}"
  var="${entry#*:}"
  if exists gcloud secrets describe "${secret}"; then
    info "secret ${secret} already exists"
  else
    gcloud secrets create "${secret}" --replication-policy=automatic --format=none
    info "created secret ${secret}"
  fi
  if [[ -z "$(gcloud secrets versions list "${secret}" --filter=state=enabled \
    --format='value(name)' --limit=1)" ]]; then
    if [[ -n "${!var:-}" ]]; then
      printf '%s' "${!var}" | gcloud secrets versions add "${secret}" --data-file=- --format=none
      info "stored ${var} as the first version of ${secret}"
    else
      warn "secret ${secret} has no value yet: printf %s \"\$${var}\" |" \
        "gcloud secrets versions add ${secret} --data-file=- --project ${PROJECT_ID}"
    fi
  fi
  bind_secret "${secret}" "serviceAccount:${API_SA}" roles/secretmanager.secretAccessor
  # Metadata only (does a version exist?), so deploy.yml can skip a secret that has none.
  bind_secret "${secret}" "serviceAccount:${GITHUB_SA}" roles/secretmanager.viewer
done

# --- Workload Identity Federation (GitHub OIDC) ------------------------------------------------
step "Workload Identity Federation: pool ${WIF_POOL}, provider ${WIF_PROVIDER}"
POOL_STATE="$(gcloud iam workload-identity-pools describe "${WIF_POOL}" --location=global \
  --format='value(state)' 2>/dev/null || true)"
if [[ -z "${POOL_STATE}" ]]; then
  gcloud iam workload-identity-pools create "${WIF_POOL}" --location=global \
    --display-name="GitHub Actions" --format=none
  info "created pool"
elif [[ "${POOL_STATE}" == "DELETED" ]]; then
  gcloud iam workload-identity-pools undelete "${WIF_POOL}" --location=global --format=none
  info "undeleted pool"
else
  info "pool already exists (${POOL_STATE})"
fi

WIF_MAPPING="google.subject=assertion.sub,attribute.repository=assertion.repository"
WIF_MAPPING+=",attribute.ref=assertion.ref"
# Repository AND branch: a workflow on any other branch (claude/**, a PR) gets no token.
WIF_CONDITION="assertion.repository=='${GITHUB_REPO}' && assertion.ref=='refs/heads/${GITHUB_BRANCH}'"
PROVIDER_STATE="$(gcloud iam workload-identity-pools providers describe "${WIF_PROVIDER}" \
  --workload-identity-pool="${WIF_POOL}" --location=global --format='value(state)' \
  2>/dev/null || true)"
if [[ -z "${PROVIDER_STATE}" ]]; then
  gcloud iam workload-identity-pools providers create-oidc "${WIF_PROVIDER}" \
    --workload-identity-pool="${WIF_POOL}" --location=global --display-name="GitHub OIDC" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="${WIF_MAPPING}" --attribute-condition="${WIF_CONDITION}" --format=none
  info "created OIDC provider"
else
  if [[ "${PROVIDER_STATE}" == "DELETED" ]]; then
    gcloud iam workload-identity-pools providers undelete "${WIF_PROVIDER}" \
      --workload-identity-pool="${WIF_POOL}" --location=global --format=none
    info "undeleted OIDC provider"
  fi
  gcloud iam workload-identity-pools providers update-oidc "${WIF_PROVIDER}" \
    --workload-identity-pool="${WIF_POOL}" --location=global \
    --attribute-mapping="${WIF_MAPPING}" --attribute-condition="${WIF_CONDITION}" --format=none
  info "OIDC provider already exists; mapping/condition re-applied"
fi
WIF_PROVIDER_NAME="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}/providers/${WIF_PROVIDER}"
WIF_PRINCIPAL="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}/attribute.repository/${GITHUB_REPO}"
bind_sa "${GITHUB_SA}" "${WIF_PRINCIPAL}" roles/iam.workloadIdentityUser

# --- Cloud Run service (placeholder) ----------------------------------------------------------
step "Cloud Run service ${SERVICE} (${REGION})"
if exists gcloud run services describe "${SERVICE}" --region="${REGION}"; then
  info "already exists (not touched; deploy.yml manages its image and settings)"
else
  # A public sample image, so Firebase Hosting has a rewrite target before the first deploy.
  # max-instances 1 caps cost and keeps the in-memory chat sessions and limits consistent.
  retry gcloud run deploy "${SERVICE}" --region="${REGION}" --image="${PLACEHOLDER_IMAGE}" \
    --service-account="${API_SA}" --max-instances=1 --min-instances=0 \
    --labels=managed-by=nido-bootstrap --format=none
  info "created placeholder service (image ${PLACEHOLDER_IMAGE})"
fi
# Public on purpose: Firebase Hosting calls it without credentials. The app itself only answers
# verified Firebase users on NIDO_ALLOWED_EMAILS. deploy.yml cannot change this (run.developer).
retry gcloud run services add-iam-policy-binding "${SERVICE}" --region="${REGION}" \
  --member=allUsers --role=roles/run.invoker --format=none ||
  warn "could not allow unauthenticated calls to ${SERVICE} (an organization policy may block" \
    "allUsers); Firebase Hosting's /api rewrite will get 403 until it is allowed"
info "service ${SERVICE}: roles/run.invoker -> allUsers"

# --- Budget and billing kill switch ---------------------------------------------------------------
# A budget alone only sends emails. With BILLING_CAP=1 its Pub/Sub notifications also run the
# workflow infra/billing_cap.yaml, which unlinks the project from its billing account once actual
# spend reaches the budget. Billing data lags by hours, so spend can overshoot a little first.
BUDGET_TOPIC_PATH="projects/${PROJECT_ID}/topics/${BUDGET_TOPIC}"
BUDGET_SUMMARY="none (see the warnings below)"
BUDGET_OK=0

if [[ "${BILLING_CAP}" == 1 ]]; then
  step "Pub/Sub topic ${BUDGET_TOPIC} (budget notifications)"
  if exists gcloud pubsub topics describe "${BUDGET_TOPIC}"; then
    info "already exists"
  else
    gcloud pubsub topics create "${BUDGET_TOPIC}" --format=none
    info "created"
  fi
  retry gcloud pubsub topics add-iam-policy-binding "${BUDGET_TOPIC}" \
    --member=serviceAccount:billing-budget-alert@system.gserviceaccount.com \
    --role=roles/pubsub.publisher --format=none
  info "topic ${BUDGET_TOPIC}: roles/pubsub.publisher -> Cloud Billing budget alerts"

  step "Service account ${BILLING_CAP_NAME}"
  ensure_sa "${BILLING_CAP_NAME}" "nido billing kill switch (Workflows)"
  bind_project "serviceAccount:${BILLING_SA}" roles/billing.projectManager
  bind_project "serviceAccount:${BILLING_SA}" roles/workflows.invoker
  bind_project "serviceAccount:${BILLING_SA}" roles/eventarc.eventReceiver
  bind_project "serviceAccount:${BILLING_SA}" roles/logging.logWriter
  PUBSUB_AGENT="service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com"
  if retry gcloud iam service-accounts add-iam-policy-binding "${BILLING_SA}" \
    --member="serviceAccount:${PUBSUB_AGENT}" --role=roles/iam.serviceAccountTokenCreator \
    --format=none; then
    info "${BILLING_SA}: roles/iam.serviceAccountTokenCreator -> ${PUBSUB_AGENT}"
  else
    warn "could not grant ${PUBSUB_AGENT} roles/iam.serviceAccountTokenCreator on ${BILLING_SA};" \
      "only projects older than April 2021 need it"
  fi

  step "Workflow ${BILLING_CAP_NAME} (${BILLING_CAP_REGION})"
  retry gcloud workflows deploy "${BILLING_CAP_NAME}" --location="${BILLING_CAP_REGION}" \
    --source="${SCRIPT_DIR}/billing_cap.yaml" --service-account="${BILLING_SA}" \
    --description="Unlinks billing once the nido budget is spent (docs/SETUP.md)" \
    --labels=managed-by=nido-bootstrap --format=none
  info "deployed from infra/billing_cap.yaml"

  step "Eventarc trigger ${BILLING_CAP_NAME}: topic ${BUDGET_TOPIC} -> workflow"
  if exists gcloud eventarc triggers describe "${BILLING_CAP_NAME}" \
    --location="${BILLING_CAP_REGION}"; then
    info "already exists"
  else
    retry gcloud eventarc triggers create "${BILLING_CAP_NAME}" \
      --location="${BILLING_CAP_REGION}" \
      --destination-workflow="${BILLING_CAP_NAME}" \
      --destination-workflow-location="${BILLING_CAP_REGION}" \
      --event-filters="type=google.cloud.pubsub.topic.v1.messagePublished" \
      --transport-topic="${BUDGET_TOPIC_PATH}" \
      --service-account="${BILLING_SA}" --format=none
    info "created"
  fi
fi

# Budgets live on the billing account: creating one needs Billing Account Administrator or
# Billing Account Costs Manager there, which a project Owner may lack.
ensure_budget() {
  local account currency amount listing budget_id rule
  account="$(gcloud billing projects describe "${PROJECT_ID}" \
    --format='value(billingAccountName)' 2>/dev/null || true)"
  account="${account#billingAccounts/}"
  if [[ -z "${account}" ]]; then
    warn "could not read the billing account of ${PROJECT_ID}; no budget created (docs/SETUP.md)"
    return 0
  fi
  currency="$(gcloud billing accounts describe "${account}" --format='value(currencyCode)' \
    2>/dev/null || true)"
  amount="${BUDGET_AMOUNT}"
  if [[ -z "${amount}" ]]; then
    case "${currency}" in
      USD | EUR | GBP | CHF) amount=5 ;;
      *)
        warn "billing account ${account} bills in '${currency:-unknown currency}': re-run with" \
          "BUDGET_AMOUNT in that currency (e.g. BUDGET_AMOUNT=50 for SEK); no budget created"
        return 0
        ;;
    esac
  fi

  local thresholds=(percent=0.5 percent=0.9 percent=1.0 percent=1.0,basis=forecasted-spend)
  local args=(
    --billing-account="${account}"
    --billing-project="${PROJECT_ID}"
    --budget-amount="${amount}"
    --calendar-period=month
    --filter-projects="projects/${PROJECT_ID}"
    --format=none
  )
  if [[ "${BILLING_CAP}" == 1 ]]; then
    args+=(--notifications-rule-pubsub-topic="${BUDGET_TOPIC_PATH}")
  fi

  if ! listing="$(gcloud billing budgets list --billing-account="${account}" \
    --billing-project="${PROJECT_ID}" --format='value(name,displayName)')"; then
    warn "cannot list the budgets of billing account ${account} (needs Billing Account" \
      "Administrator or Costs Manager); create '${BUDGET_NAME}' by hand (docs/SETUP.md)"
    return 0
  fi
  budget_id="$(awk -F '\t' -v name="${BUDGET_NAME}" '$2 == name { print $1; exit }' \
    <<<"${listing}")"

  if [[ -n "${budget_id}" ]]; then
    args+=(--clear-threshold-rules)
    for rule in "${thresholds[@]}"; do args+=(--add-threshold-rule="${rule}"); done
    if ! gcloud billing budgets update "${budget_id##*/}" "${args[@]}"; then
      warn "could not update budget '${BUDGET_NAME}' (${budget_id})"
      return 0
    fi
    info "already exists; amount, scope, thresholds and topic re-applied"
  else
    for rule in "${thresholds[@]}"; do args+=(--threshold-rule="${rule}"); done
    if ! gcloud billing budgets create --display-name="${BUDGET_NAME}" "${args[@]}"; then
      warn "could not create budget '${BUDGET_NAME}' on billing account ${account} (needs" \
        "Billing Account Administrator or Costs Manager; docs/SETUP.md)"
      return 0
    fi
    info "created"
  fi
  BUDGET_SUMMARY="${amount} ${currency:-(billing account currency)}/month on billing account"
  BUDGET_SUMMARY+=" ${account}; emails at 50/90/100 % and at a 100 % forecast"
  BUDGET_OK=1
}

step "Budget '${BUDGET_NAME}'"
ensure_budget

# --- Output --------------------------------------------------------------------------------------
step "Done. Set these GitHub repository VARIABLES (Settings > Secrets and variables > Actions >"
info "Variables), not secrets:"
cat <<EOF

  gh variable set GCP_PROJECT_ID   --repo ${GITHUB_REPO} --body '${PROJECT_ID}'
  gh variable set GCP_REGION       --repo ${GITHUB_REPO} --body '${REGION}'
  gh variable set GCP_WIF_PROVIDER --repo ${GITHUB_REPO} --body '${WIF_PROVIDER_NAME}'
  gh variable set GCP_GITHUB_SA    --repo ${GITHUB_REPO} --body '${GITHUB_SA}'
  gh variable set GCP_API_SA       --repo ${GITHUB_REPO} --body '${API_SA}'
  gh variable set AR_REPOSITORY    --repo ${GITHUB_REPO} --body '${AR_REPO}'
  gh variable set NIDO_ALLOWED_EMAILS --repo ${GITHUB_REPO} --body 'you@gmail.com,partner@gmail.com'

Plus the Firebase web app config (Firebase console > Project settings > Your apps):

  gh variable set FIREBASE_API_KEY     --repo ${GITHUB_REPO} --body '...'
  gh variable set FIREBASE_AUTH_DOMAIN --repo ${GITHUB_REPO} --body '${PROJECT_ID}.firebaseapp.com'
  gh variable set FIREBASE_APP_ID      --repo ${GITHUB_REPO} --body '...'

Next: run the "deploy" workflow from ${GITHUB_BRANCH} (or merge to it).

Budget: ${BUDGET_SUMMARY}
EOF
if [[ "${BILLING_CAP}" == 1 && "${BUDGET_OK}" == 1 ]]; then
  info "Kill switch: ON. Once actual spend reaches the budget, workflow ${BILLING_CAP_NAME}"
  info "(${BILLING_CAP_REGION}) unlinks billing and every paid service stops (docs/SETUP.md)."
elif [[ "${BILLING_CAP}" == 1 ]]; then
  info "Kill switch: deployed but IDLE until a budget notifies topic ${BUDGET_TOPIC_PATH}."
else
  info "Kill switch: OFF (BILLING_CAP=0): the budget only sends emails."
fi
if ((${#WARNINGS[@]})); then
  printf '\nWarnings:\n' >&2
  for warning in "${WARNINGS[@]}"; do
    printf '  - %s\n' "${warning}" >&2
  done
fi
