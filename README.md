# RoyScript Contact API

A small Node.js (Express) service that receives contact-form submissions from
the RoyScript Technologies website and stores them in PostgreSQL.

- Runs on `127.0.0.1:3000` (reachable only through Nginx)
- Postgres lives on the **host machine** (not in Docker)
- Container uses `--network host` so it can reach host Postgres on `127.0.0.1:5432`
- CI/CD via Jenkins + Docker

---

## 1. Prepare Postgres (one time)

Run on the server, where Postgres 17 already lives:

```bash
sudo -u postgres psql -c "CREATE DATABASE royscript_site;"
sudo -u postgres psql -c "CREATE USER royscript_app WITH PASSWORD 'STRONG_PASSWORD_HERE';"
sudo -u postgres psql -d royscript_site -c "GRANT ALL ON SCHEMA public TO royscript_app;"

# Create the table (as the app user, so it owns it):
psql "postgresql://royscript_app:STRONG_PASSWORD_HERE@127.0.0.1:5432/royscript_site" -f db/schema.sql
```

> No changes to `listen_addresses`, `pg_hba.conf`, or UFW are needed.
> With `--network host` the container talks to Postgres over the loopback,
> exactly as a normal host process would. Postgres stays bound to localhost.

## 2. Configure environment

```bash
cp .env.example .env
nano .env        # set DB_PASSWORD (and the rest)
```

## 3. First deploy (manual)

Uses Docker Compose under the hood (requires the `docker compose` v2 plugin):

```bash
chmod +x deploy.sh
./deploy.sh
```

Or run Compose directly:

```bash
docker compose up -d --build      # build + start
docker compose logs -f            # tail logs
docker compose ps                 # status
docker compose down               # stop + remove
```

Verify:

```bash
curl http://127.0.0.1:3000/health          # -> {"ok":true,"db":"up"}

curl -X POST http://127.0.0.1:3000/api/contact \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test","email":"test@example.com","message":"Hello"}'
# -> {"ok":true}
```

Check the row landed:

```bash
psql "postgresql://royscript_app:...@127.0.0.1:5432/royscript_site" \
  -c "SELECT name, email, created_at FROM contact_submissions ORDER BY created_at DESC LIMIT 5;"
```

## 4. Wire up Nginx

Add the block in `nginx-snippet.conf` inside your existing HTTPS `server { }`
for royscript.com, then:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Now `https://www.royscript.com/api/contact` reaches the app. Because it's the
same origin as the site, no CORS is needed (you can leave `ALLOWED_ORIGIN` empty).

## 5. Update the website form

In your `index.html`, set the form to post to the API and replace the old
Formspree handler. Set the action:

```html
<form id="form" action="/api/contact" method="POST">
```

Add a honeypot field (helps block bots) just inside the form:

```html
<input type="text" name="_gotcha" tabindex="-1" autocomplete="off"
       style="position:absolute;left:-9999px" aria-hidden="true">
```

Replace the form submit handler script with:

```js
form.addEventListener('submit', async function (e) {
  e.preventDefault();
  if (!form.checkValidity()) { form.reportValidity(); return; }
  var btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    var res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.value,
        email: form.email.value,
        company: form.company.value,
        message: form.message.value,
        _gotcha: form._gotcha ? form._gotcha.value : ''
      })
    });
    if (!res.ok) throw new Error('bad status');
    form.style.display = 'none';
    success.style.display = 'flex';
  } catch (err) {
    btn.disabled = false;
    alert('Sorry, something went wrong. Please email info@royscript.com directly.');
  }
});
```

## 6. Jenkins CI/CD

Prerequisites on the server:
- Jenkins user can run Docker: `sudo usermod -aG docker jenkins` then restart Jenkins.
- The `docker compose` v2 plugin and `curl` are installed.

Set up the job:
1. **Manage Jenkins → Credentials →** add a **Secret file** credential.
   Upload your production `.env`. Set its **ID** to `royscript-contact-env`
   (must match the `credentialsId` in the Jenkinsfile).
2. Create a **Pipeline** job → Pipeline from SCM → point to your Git repo,
   script path `Jenkinsfile`.
3. Since Jenkins is bound to localhost (no inbound webhooks), enable a trigger:
   **Poll SCM** with a schedule like `H/5 * * * *`, or trigger builds manually,
   or via a local `git` post-receive hook.

Each build: checks out, builds the image via `docker compose build`, redeploys
with `docker compose up -d`, runs the health check, and prunes old images. The
production `.env` is written from the Jenkins credential at deploy time and
removed from the workspace afterward.

> Note: deploy stops the old container before starting the new one, so there's
> a few seconds of downtime per deploy. Fine for this service; can be upgraded
> to blue-green later if needed.

## Security notes

- App binds to `127.0.0.1` only — never exposed on the public IP, only via Nginx.
- Keep UFW allowing just `22/80/443`. Do **not** open `3000` or `5432`.
- `.env` is gitignored. Production secrets live only in the Jenkins credential.
- Input is validated and length-clamped; queries are parameterized (no SQL injection).
- Rate limited to 20 submissions / IP / 15 min, plus a honeypot field.

## Endpoints

| Method | Path           | Purpose                          |
|--------|----------------|----------------------------------|
| GET    | `/health`      | Liveness + DB connectivity check |
| POST   | `/api/contact` | Accept a contact submission      |
