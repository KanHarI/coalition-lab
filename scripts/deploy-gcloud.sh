#!/usr/bin/env bash
set -euo pipefail
if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: npm run deploy:gcloud -- PROJECT_ID [REGION]" >&2
  exit 2
fi
PROJECT_ID="$1"
REGION="${2:-europe-west1}"
JOB="coalition-market-refresh"
BUCKET="${PROJECT_ID}-coalition-data"
RUNTIME_ACCOUNT="coalition-lab-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
SCHEDULER_ACCOUNT="coalition-lab-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"
BUILD_TAG="$(date -u +%Y%m%dT%H%M%S)"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy/market-refresh:${BUILD_TAG}"
cd "$(dirname "$0")/.."

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  iam.googleapis.com cloudscheduler.googleapis.com storage.googleapis.com \
  firebase.googleapis.com firebasehosting.googleapis.com --project="$PROJECT_ID" --quiet

for account in coalition-lab-runtime coalition-lab-scheduler; do
  if ! gcloud iam service-accounts describe "${account}@${PROJECT_ID}.iam.gserviceaccount.com" --project="$PROJECT_ID" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$account" --project="$PROJECT_ID"
  fi
done
if ! gcloud storage buckets describe "gs://${BUCKET}" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${BUCKET}" --location="$REGION" --uniform-bucket-level-access --project="$PROJECT_ID"
fi
gcloud storage buckets update "gs://${BUCKET}" --cors-file=deploy/storage-cors.json --project="$PROJECT_ID"
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" --member=allUsers --role=roles/storage.objectViewer --project="$PROJECT_ID" >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" --member="serviceAccount:${RUNTIME_ACCOUNT}" --role=roles/storage.objectUser --project="$PROJECT_ID" >/dev/null
if ! gcloud artifacts repositories describe cloud-run-source-deploy --location="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud artifacts repositories create cloud-run-source-deploy --repository-format=docker --location="$REGION" --project="$PROJECT_ID"
fi

gcloud builds submit . --tag="$IMAGE" --region="$REGION" --project="$PROJECT_ID" --quiet
gcloud run jobs deploy "$JOB" --image="$IMAGE" --project="$PROJECT_ID" --region="$REGION" \
  --service-account="$RUNTIME_ACCOUNT" --set-env-vars="DATA_BUCKET=${BUCKET}" \
  --tasks=1 --parallelism=1 --max-retries=0 --task-timeout=60s --cpu=1 --memory=512Mi --quiet
gcloud run jobs add-iam-policy-binding "$JOB" --project="$PROJECT_ID" --region="$REGION" \
  --member="serviceAccount:${SCHEDULER_ACCOUNT}" --role=roles/run.invoker >/dev/null

action=create
if gcloud scheduler jobs describe "$JOB" --project="$PROJECT_ID" --location="$REGION" >/dev/null 2>&1; then action=update; fi
gcloud scheduler jobs "$action" http "$JOB" --project="$PROJECT_ID" --location="$REGION" \
  --schedule='*/20 * * * *' --time-zone=Etc/UTC \
  --uri="https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/${JOB}:run" \
  --http-method=POST --message-body='{}' --headers=Content-Type=application/json \
  --oauth-service-account-email="$SCHEDULER_ACCOUNT" --max-retry-attempts=0 --quiet

gcloud run jobs execute "$JOB" --project="$PROJECT_ID" --region="$REGION" --wait --quiet
printf 'Market snapshot: https://storage.googleapis.com/%s/markets.json\n' "$BUCKET"
