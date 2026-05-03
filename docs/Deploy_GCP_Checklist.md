# GCP Deployment Checklist (Step by Step)

Muc tieu: Deploy he thong len Google Cloud theo mo hinh Cloud Run + Cloud SQL Postgres.

## 0) Chuan bi

- [ ] Co tai khoan Google Cloud va billing da bat.
- [ ] Mo Google Cloud Console.
- [ ] Mo Cloud Shell trong Console.
- [ ] Clone source code vao Cloud Shell.

```bash
git clone <YOUR_REPO_URL>
cd "sachihouse78 (1)"
```

## 1) Khai bao bien dung chung

- [ ] Khai bao cac bien moi truong cho toan bo qua trinh deploy.

```bash
export PROJECT_ID="your-gcp-project-id"
export REGION="asia-southeast1"
export REPO="sachihouse"

export SERVICE_API="sachihouse-api"
export SERVICE_WEB="sachihouse-web"

export SQL_INSTANCE="sachihouse-db"
export DB_NAME="sachihouse"
export DB_USER="sachihouse"
export DB_PASS="CHANGE_THIS_STRONG_PASSWORD"

# Chon project dang lam viec
gcloud config set project "$PROJECT_ID"
```

## 2) Bat cac API can thiet

- [ ] Bat day du cac API phuc vu Cloud Run, Build, Registry, SQL, Secret.

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com
```

## 3) Tao Artifact Registry

- [ ] Tao Docker repository de luu image.

```bash
gcloud artifacts repositories create "$REPO" \
  --repository-format=docker \
  --location="$REGION" \
  --description="Sachihouse container images"
```

## 4) Tao Cloud SQL Postgres

- [ ] Tao Cloud SQL instance (PostgreSQL 16).
- [ ] Tao database.
- [ ] Tao user + password.

```bash
gcloud sql instances create "$SQL_INSTANCE" \
  --database-version=POSTGRES_16 \
  --cpu=1 \
  --memory=3840MB \
  --region="$REGION"

gcloud sql databases create "$DB_NAME" \
  --instance="$SQL_INSTANCE"

gcloud sql users create "$DB_USER" \
  --instance="$SQL_INSTANCE" \
  --password="$DB_PASS"
```

- [ ] Lay Cloud SQL connection name.

```bash
export INSTANCE_CONNECTION_NAME=$(gcloud sql instances describe "$SQL_INSTANCE" --format='value(connectionName)')
echo "$INSTANCE_CONNECTION_NAME"
```

## 5) Tao secrets cho API

- [ ] Tao JWT secret an toan.
- [ ] Tao DATABASE_URL dung Cloud SQL Unix socket.

```bash
export JWT_SECRET_VALUE="CHANGE_THIS_TO_A_LONG_RANDOM_SECRET"
export DATABASE_URL_VALUE="postgresql://${DB_USER}:${DB_PASS}@/${DB_NAME}?host=/cloudsql/${INSTANCE_CONNECTION_NAME}"

echo -n "$JWT_SECRET_VALUE" | gcloud secrets create JWT_SECRET --data-file=-
echo -n "$DATABASE_URL_VALUE" | gcloud secrets create DATABASE_URL --data-file=-
```

Neu secret da ton tai, them version moi:

```bash
echo -n "$JWT_SECRET_VALUE" | gcloud secrets versions add JWT_SECRET --data-file=-
echo -n "$DATABASE_URL_VALUE" | gcloud secrets versions add DATABASE_URL --data-file=-
```

## 6) Build va deploy API len Cloud Run

- [ ] Build image backend.
- [ ] Deploy API service.

```bash
export API_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/api:$(date +%Y%m%d-%H%M%S)"

gcloud builds submit ./backend --tag "$API_IMAGE"

gcloud run deploy "$SERVICE_API" \
  --image "$API_IMAGE" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --add-cloudsql-instances "$INSTANCE_CONNECTION_NAME" \
  --set-env-vars "STORE_MODE=postgres,NODE_ENV=production,PORT=3001" \
  --set-secrets "DATABASE_URL=DATABASE_URL:latest,JWT_SECRET=JWT_SECRET:latest"
```

- [ ] Lay API URL sau khi deploy.

```bash
export API_URL=$(gcloud run services describe "$SERVICE_API" --region "$REGION" --format='value(status.url)')
echo "$API_URL"
```

## 7) Build frontend voi VITE_API_BASE_URL va deploy Web

Luu y: Frontend dang dung Vite build-time variable, nen phai build voi API URL that.

- [ ] Repo da co san pipeline file:
- [ ] [cloudbuild.api.yaml](../cloudbuild.api.yaml)
- [ ] [cloudbuild.web.yaml](../cloudbuild.web.yaml)

- [ ] Build image frontend voi API URL moi.

```bash
export WEB_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/web:$(date +%Y%m%d-%H%M%S)"

gcloud builds submit ./frontend \
  --config=cloudbuild.web.yaml \
  --substitutions=_IMAGE="$WEB_IMAGE",_API_BASE_URL="${API_URL}/api"
```

- [ ] Deploy web service.

```bash
gcloud run deploy "$SERVICE_WEB" \
  --image "$WEB_IMAGE" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated
```

- [ ] Lay Web URL.

```bash
export WEB_URL=$(gcloud run services describe "$SERVICE_WEB" --region "$REGION" --format='value(status.url)')
echo "$WEB_URL"
```

## 8) Smoke test sau deploy

- [ ] Kiem tra API health.

```bash
curl -sS "${API_URL}/api/health"
```

- [ ] Mo Web URL va test:
- [ ] Dang nhap admin.
- [ ] Trang listings/property/admin load du lieu.
- [ ] Sua property, luu thanh cong.
- [ ] iCal blocked dates va quote hoat dong.

## 9) Hardening production (nen lam)

- [ ] Gioi han CORS theo domain web production.
- [ ] Bat backup va PITR cho Cloud SQL.
- [ ] Dung Secret Manager cho moi secret (khong hardcode).
- [ ] Dat min instances cho API neu can giam cold start.
- [ ] Gan custom domain + SSL managed cert cho web.
- [ ] Dat budget alert va monitoring.

## 10) Rollback nhanh khi can

- [ ] Liet ke revision.

```bash
gcloud run revisions list --service="$SERVICE_API" --region="$REGION"
gcloud run revisions list --service="$SERVICE_WEB" --region="$REGION"
```

- [ ] Rollback ve revision cu.

```bash
gcloud run services update-traffic "$SERVICE_API" \
  --region="$REGION" \
  --to-revisions REVISION_NAME=100

gcloud run services update-traffic "$SERVICE_WEB" \
  --region="$REGION" \
  --to-revisions REVISION_NAME=100
```

## 11) Checklist hoan tat

- [ ] API deploy OK
- [ ] Web deploy OK
- [ ] Cloud SQL connect OK
- [ ] Login/CRUD test OK
- [ ] Secrets da tach rieng
- [ ] Backup + Monitoring da bat

## 12) Tu dong deploy (khong can manual moi lan)

Tra loi ngan: Khong, ban khong can manual moi lan neu da setup trigger CI/CD.

- [ ] Tao trigger cho API (file [cloudbuild.api.yaml](../cloudbuild.api.yaml))
- [ ] Tao trigger cho Web (file [cloudbuild.web.yaml](../cloudbuild.web.yaml))
- [ ] Dat filter path de trigger theo thu muc thay doi

### 12.1 Tao trigger API

- [ ] Cloud Build > Triggers > Create trigger
- [ ] Event: Push to branch (vd main)
- [ ] Source: ket noi GitHub repo cua ban
- [ ] Configuration: Cloud Build configuration file
- [ ] File location: cloudbuild.api.yaml
- [ ] Included files: backend/**
- [ ] Substitution can dat trong trigger:
- [ ] _SERVICE=sachihouse-api
- [ ] _REGION=asia-southeast1
- [ ] _REPO=sachihouse
- [ ] _INSTANCE_CONNECTION_NAME=project-id:region:instance-name
- [ ] _JWT_SECRET_NAME=JWT_SECRET
- [ ] _DATABASE_URL_SECRET_NAME=DATABASE_URL

### 12.2 Tao trigger Web

- [ ] Cloud Build > Triggers > Create trigger
- [ ] Event: Push to branch (vd main)
- [ ] Source: cung repo
- [ ] Configuration: Cloud Build configuration file
- [ ] File location: cloudbuild.web.yaml
- [ ] Included files: frontend/**
- [ ] Substitution can dat trong trigger:
- [ ] _SERVICE=sachihouse-web
- [ ] _REGION=asia-southeast1
- [ ] _REPO=sachihouse
- [ ] _API_BASE_URL=https://YOUR_API_CLOUD_RUN_URL/api

### 12.3 Quyen cho Cloud Build service account

- [ ] Cap cac role toi thieu cho service account Cloud Build:
- [ ] Cloud Run Admin
- [ ] Service Account User
- [ ] Artifact Registry Writer
- [ ] Secret Manager Secret Accessor

Neu API deploy kem Cloud SQL:

- [ ] Dam bao runtime service account cua Cloud Run API co role Cloud SQL Client

### 12.4 Luong update sau khi da setup trigger

- [ ] Push code len nhanh main
- [ ] Cloud Build tu chay
- [ ] Cloud Run tu cap nhat revision moi
- [ ] Ban chi can kiem tra smoke test
