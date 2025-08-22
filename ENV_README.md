ENV setup and secret handling for essentia-audio-service

This project expects the following environment variables to be set (do not commit secrets):

- MONGODB_URI: MongoDB connection string. Example pattern:
  mongodb+srv://<USER>:<PASSWORD>@sonaredm.g4cdx.mongodb.net/<DB>?retryWrites=true&w=majority&appName=SonarEDM

- ESSENTIA_SERVICE_URL (optional): URL to the Essentia analysis service. Defaults to http://localhost:3001 or project default.

NOTE: SoundCloud is no longer used. SoundCloud did not reliably expose stable 30s preview URLs for our analysis pipeline. Use `APPLE` and `DEEZER` only.

- MIN_REAL_TRACKS (optional): gating value used by front-end and health checks (default: 5)

Security best practices:
- Never commit `.env` files with real credentials.
- Use Heroku config vars or a secrets manager for production.
- Limit database user permissions to necessary scopes.

How to run locally (PowerShell):

```pwsh
copy .env.example .env
# edit .env and paste real credentials locally (do not commit)
$env:MONGODB_URI = 'mongodb+srv://<USER>:<PASSWORD>@host/<DB>?retryWrites=true&w=majority'  # replace with your secret in local env; do NOT commit
node .\scripts\coverage-report.js
```
