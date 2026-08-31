# ticketing-service-worker

The **reservation-expiry worker** for the ticketing service: it owns the
per-reservation expiry timers and releases held stock when a hold times out,
coordinated with the API over Redis Pub/Sub plus a shared Redis ZSET.

The API and everything else lives in
[`alvingun01/ticketing-service`](https://github.com/alvingun01/ticketing-service);
this repo vendors it as a git submodule and adds the three worker source files
at the repo root, which are overlaid into `src/reservation-worker/` before
compiling:

```
ticketing-service-worker/
├── expiry-worker.service.ts      ← the expiry logic
├── main.ts                       ← the worker entrypoint
├── reservation-worker.module.ts  ← the worker's Nest module
├── ticketing-service/            ← git submodule: shared code (entities,
│                                    database/redis/stripe/reservations modules)
├── Dockerfile                    ← builds submodule + overlay → worker image
├── deploy/vm2/                   ← compose + env for the worker VM
└── .github/workflows/deploy.yml  ← build, push, and deploy to VM2
```

## Local development

The submodule provides `package.json`, `tsconfig.json`, and every dependency —
the worker's relative imports (`../redis/...`, `../stripe/...`) resolve inside
it.

```bash
git submodule update --init          # first time
git submodule update --remote        # pull the latest shared code

# compile + run against your local redis/postgres (see the main repo's
# docker-compose.yml for those):
cd ticketing-service
npm ci
cp ../expiry-worker.service.ts src/reservation-worker/
cp ../main.ts src/reservation-worker/
cp ../reservation-worker.module.ts src/reservation-worker/
npm run start:dev -- --entryFile reservation-worker/main
```

(The `cp` steps mirror what the Dockerfile does; a git checkout of the
submodule overwrites them, so re-copy after `submodule update`.)

Or build the image the same way CI does:

```bash
docker build -t <your-dockerhub-user>/ticketing-service-worker:worker .
```

> On an Apple Silicon Mac this produces `linux/arm64`; for the x86_64 GCP VMs
> use `docker buildx build --platform linux/amd64 ...` or let CI build it.

## Deploy

See `deploy/README.md` in the
[main repo](https://github.com/alvingun01/ticketing-service) for the full
two-VM runbook. In short: this repo's CI builds the worker image on GitHub's
x86_64 runners, pushes `worker` + `worker-<sha>` tags to Docker Hub, and SSHs
into VM2 to pull and restart — on every push to `main`.

### One-time VM2 setup

1. On the worker VM, install Docker (`curl -fsSL https://get.docker.com | sh`).
2. Generate the env (DB_PASSWORD must match VM1's `deploy/vm1/.env` exactly):

   ```bash
   DB_PASSWORD=<from-vm1/.env> ./deploy/generate-env.sh <your-dockerhub-user>/ticketing-service-worker
   # then fill in VM1_PUBLIC_IP and the Stripe key in deploy/vm2/.env
   ```

3. Copy it up and start:

   ```bash
   gcloud compute scp --recurse deploy/vm2 worker:~/ --zone=us-central1-c
   gcloud compute ssh worker --zone=us-central1-c
   cd ~/vm2
   docker compose up -d
   docker compose logs -f reservation-worker
   ```

   Expect: `Reservation expiry worker ready - listening for reservations`.

### CI secrets (Settings → Secrets and variables → Actions)

| Secret | Value |
|--------|-------|
| `DOCKERHUB_USERNAME` | Docker Hub username |
| `DOCKERHUB_TOKEN` | Docker Hub access token |
| `VM2_HOST` | the worker VM's external IP |
| `VM2_USER` | SSH user on that VM |
| `VM2_SSH_KEY` | the CI deploy private key (same `~/.ssh/ticketing-deploy` as VM1) |

The CI build always updates the submodule to the main repo's `main` branch, so
shared-code changes deploy here without a manual pin bump. The committed pin
matters only for local builds.

### Rollback

On the VM: edit `~/vm2/.env` to `WORKER_TAG=worker-<oldsha>` and run
`docker compose pull reservation-worker && docker compose up -d reservation-worker`.
