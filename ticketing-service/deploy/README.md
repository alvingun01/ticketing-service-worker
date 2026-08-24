# Deploying to two GCP VMs

One repo, two images, two VMs:

```
                    ┌─────────────────────────────┐
  internet ────────▶│ VM1  (tag: ticketing-api)   │
  (frontend,        │  postgres  (5432)           │
   Stripe webhooks) │  redis     (6379)           │
                    │  api       (8000)           │
                    └──────────────┬──────────────┘
                                   │  public IP, firewall-locked
                    ┌──────────────▼──────────────┐
                    │ VM2 (tag: ticketing-worker) │
                    │  reservation-worker (no     │
                    │  ports; outbound only)      │
                    └─────────────────────────────┘
```

The worker is a separate image built from the same repo (the Dockerfile's
`worker` target). It reaches VM1's Redis and Postgres over VM1's external IP and
coordinates with the API through Redis Pub/Sub.

---

## Prerequisites

- Two GCP VMs (any Ubuntu/Debian image), one for VM1 and one for VM2.
- Docker installed on your **local machine** (to build + push the images).
- A [Docker Hub](https://hub.docker.com) account/repo name.
- `gcloud` CLI installed and authenticated.

---

## Recommended: deploy via GitHub Actions

The workflow in [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)
builds both images on GitHub's x86_64 runners (so there's no CPU-arch mismatch
with the GCP VMs, unlike building on an Apple Silicon laptop), pushes
`api`/`worker` plus immutable `api-<sha>`/`worker-<sha>` tags, then SSHs into
both VMs to pull and restart. Push to `main` and it deploys itself.

### One-time CI setup

1. **Push this repo to GitHub** (it currently has no commits or remote):

   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin git@github.com:<you>/ticketing-service.git
   git push -u origin main
   ```

   `.env` files are gitignored, so no secrets get committed.

2. **Generate an SSH keypair for CI** and install its public key on both VMs:

   ```bash
   ./deploy/setup-ssh-keys.sh VM1_NAME VM2_NAME [ZONE]
   ```
   This generates `~/.ssh/ticketing-deploy` and prints the exact
   `gcloud compute ssh` commands to install the public key on both VMs.
   (Manual alternative: `ssh-keygen -t ed25519 -f ~/.ssh/ticketing-deploy -N ""`,
   then `gcloud compute ssh` into each VM and append the `.pub` to
   `~/.ssh/authorized_keys`.)

3. **Add these secrets** in GitHub → repo → Settings → Secrets and variables →
   Actions:

   | Secret | Value |
   |--------|-------|
   | `DOCKERHUB_USERNAME` | your Docker Hub username |
   | `DOCKERHUB_TOKEN` | a Docker Hub access token (Settings → Security → Access Tokens) |
   | `VM1_HOST` | VM1's external IP |
   | `VM1_USER` | SSH user on VM1 |
   | `VM1_SSH_KEY` | contents of `~/.ssh/ticketing-deploy` (the private key) |
   | `VM2_HOST` | VM2's external IP |
   | `VM2_USER` | SSH user on VM2 |
   | `VM2_SSH_KEY` | same private key (or a separate one per VM) |

4. **Do the manual deploy once** (Steps 2–5 below) so both VMs have Docker, the
   generated `.env` files, and the initial containers running. From then on, CI
   takes over.

> **Public vs private Docker Hub repo:** CI pushes with a token, so either works
> for push. But the VMs *pull* the image, so if the repo is private you must run
> `docker login` once on each VM (same token). Easiest is to leave the repo
> public.

### Deploying / redeploying

Push to `main`, or click **Run workflow** on the Actions tab to redeploy the
current `main` without a new commit. No local Docker needed.

### Rollback

Every build is also tagged `api-<sha>` / `worker-<sha>`. To roll back, on the VM
edit `.env` to `API_TAG=api-<oldsha>` (or `WORKER_TAG=worker-<oldsha>`) and run
`docker compose pull api && docker compose up -d api`.

---

## Step 1 — Build & push the images (manual fallback)

Use this only if you're not using GitHub Actions. From the repo root:

```bash
docker build --target api    -t <your-dockerhub-user>/ticketing-service:api    .
docker build --target worker -t <your-dockerhub-user>/ticketing-service:worker .
docker push <your-dockerhub-user>/ticketing-service:api
docker push <your-dockerhub-user>/ticketing-service:worker
```

`api` and `worker` are the Dockerfile's two final stages (shared build cache).
VM1 pulls the `api` tag and VM2 pulls the `worker` tag, so each can be versioned
independently.

---

## Step 2 — Tag the VMs

```bash
gcloud compute instances add-tags VM1_NAME --tags=ticketing-api --zone=YOUR_ZONE
gcloud compute instances add-tags VM2_NAME --tags=ticketing-worker --zone=YOUR_ZONE
```

---

## Step 3 — GCP firewall rules

Get VM2's external IP first:

```bash
gcloud compute instances describe VM2_NAME --zone=YOUR_ZONE \
  --format='value(networkInterfaces[0].accessConfigs[0].natIP)'
```

Then create the rules:

```bash
# API is public (frontend + Stripe webhooks)
gcloud compute firewall-rules create allow-ticketing-api \
  --allow tcp:8000 \
  --source-ranges 0.0.0.0/0 \
  --target-tags ticketing-api

# Redis + Postgres are reachable ONLY from VM2's external IP
gcloud compute firewall-rules create allow-ticketing-worker-to-datastores \
  --allow tcp:5432,tcp:6379 \
  --source-ranges VM2_EXTERNAL_IP/32 \
  --target-tags ticketing-api
```

> **If VM2's external IP is ephemeral** (changes on reboot), either reserve a
> [static external IP](https://cloud.google.com/compute/docs/ip-addresses/reserve-static-external-ip-address)
> for VM2, or — if both VMs are in the same VPC — prefer this internal variant
> and point the worker at VM1's **internal** IP instead:
>
> ```bash
> gcloud compute firewall-rules create allow-ticketing-worker-to-datastores \
>   --allow tcp:5432,tcp:6379 \
>   --source-tags ticketing-worker \
>   --target-tags ticketing-api
> ```

---

## Step 4 — Deploy VM1 (API + Redis + Postgres)

SSH in, install Docker:

```bash
gcloud compute ssh VM1_NAME --zone=YOUR_ZONE
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # then log out and back in
```

Generate the env files locally (once), then copy everything up:

```bash
./deploy/generate-env.sh <your-dockerhub-user>/ticketing-service
# Optionally edit deploy/vm1/.env and deploy/vm2/.env now to fill in real
# Stripe keys and VM1_PUBLIC_IP (otherwise they're left as REPLACE_ME).
gcloud compute scp --recurse deploy/vm1 VM1_NAME:~/ --zone=YOUR_ZONE
gcloud compute ssh VM1_NAME --zone=YOUR_ZONE
cd ~/vm1
docker compose up -d
docker compose ps
```

> **Start VM1 before VM2.** The API owns TypeORM schema sync (runs the DDL that
> creates the tables); the worker runs with `DB_SYNCHRONIZE=false` and expects
> the schema to already exist.

---

## Step 5 — Deploy VM2 (worker only)

```bash
gcloud compute scp --recurse deploy/vm2 VM2_NAME:~/ --zone=YOUR_ZONE
gcloud compute ssh VM2_NAME --zone=YOUR_ZONE
cd ~/vm2
# .env was generated in Step 4 (same DB_PASSWORD as VM1; VM1_PUBLIC_IP set here)
docker compose up -d
docker compose logs -f reservation-worker
```

---

## Verify end-to-end

1. **API up:** `curl http://VM1_EXTERNAL_IP:8000/` → a hello string.
2. **Worker connected:** on VM2, `docker compose logs reservation-worker`
   should show `Reservation expiry worker ready - listening for reservations`
   with no Redis/Postgres connection errors.
3. **Data seeded:** `curl -X POST http://VM1_EXTERNAL_IP:8000/seed`.
4. **Cross-VM expiry path:** create a reservation through the API, then watch
   VM2's logs for `[Reservation Expired] … - stock released` firing after
   `RESERVATION_TTL_SECONDS`. This proves Redis Pub/Sub + the shared ZSET work
   across the two VMs.

---

## Redeploying an update

**With GitHub Actions:** just push to `main` (or **Run workflow**). Done.

**Manual fallback:**

```bash
docker build --target api    -t <your-dockerhub-user>/ticketing-service:api    .
docker build --target worker -t <your-dockerhub-user>/ticketing-service:worker .
docker push <your-dockerhub-user>/ticketing-service:api
docker push <your-dockerhub-user>/ticketing-service:worker
# on each VM:
docker compose pull && docker compose up -d
```

> Building on an Apple Silicon Mac produces `linux/arm64` images, which won't
> run on x86_64 GCP VMs (`exec format error`). If you must build locally, force
> the arch: `docker buildx build --platform linux/amd64 --target api -t ... .`

---

## Hardening (recommended follow-ups)

- **Redis auth** — the app has no Redis password. A public-IP topology makes
  this more urgent: add `REDIS_PASSWORD` support in
  `src/redis/redis.module.ts` and `src/adapters/redis-io.adapter.ts`, set a
  strong password, and rebuild. Until then the `--source-ranges VM2_EXTERNAL_IP/32`
  firewall rule is the only thing protecting Redis.
- **Redis persistence** — there is no Redis volume/AOF, so a Redis restart drops
  the reservation ZSET mid-sale. Consider `command: ["redis-server",
  "--appendonly", "yes"]` plus a named volume.
- **Postgres password** — `DB_PASSWORD` is required and must be strong (e.g.
  `openssl rand -base64 32`); never use `postgres/postgres`.
- **TLS** — the API is plain HTTP. Stripe test-mode webhooks work over HTTP,
  but add a reverse proxy (Caddy/Nginx) + Let's Encrypt for live mode.
