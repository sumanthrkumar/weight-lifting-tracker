# Mandatory Rules: Data Persistence, Deployment, and Mobile Networking

These rules are strict, inviolable constraints for this codebase. The agent must adhere to them without exception.

## 1. Zero Tolerance for Ephemeral Storage
- Never propose, configure, or use any deployment platform, hosting provider, container, or server architecture that relies on ephemeral or temporary filesystems (e.g., Render Web Services free tier, Heroku dynos).
- Any SQLite or database storage MUST use a verified, indestructible physical host directory bind mount (such as `./data/prod:/app/data/prod` on the host Mac).
- Before suggesting any hosting solution, the agent MUST explicitly audit and verify:
  1. Does the storage survive instance sleep, restarts, and redeployments?
  2. Is storage physically mounted to persistent disk with guaranteed persistence?
  3. If free tier, does the free tier provide persistent disk? If not, do NOT suggest it.

## 2. Never Suggest Dynamic, Temporary, or Rotating URLs for PWAs
- The frontend is an offline-first Progressive Web App (PWA) with Service Workers, IndexedDB, and Add-to-Home-Screen installations.
- Browsers bind IndexedDB and PWA installations strictly to the origin (scheme + domain + port).
- NEVER propose quick tunnels or dynamic services that generate random or rotating URLs (such as Cloudflare `trycloudflare.com` quick tunnels or temporary ngrok URLs).
- A rotating URL breaks PWA shortcuts, forces re-downloading/re-installing, and strands local IndexedDB data on the old origin.
- Only suggest permanent, fixed domain names (e.g., Tailscale permanent MagicDNS/IP, or a permanent static domain).

## 3. Strict Separation Between Production and Development/Testing
- Production server (Port 8000, `weight_tracker_prod.db`) is strictly reserved for the user's real workout data from their phone.
- Development server (Port 8001, `weight_tracker_dev.db`) is strictly reserved for developer experimentation, feature development, curl tests, and automated checks.
- The agent must NEVER run test commands, test mutations, mock workouts, or schema migrations directly against the production database or port 8000.
