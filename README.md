# Vixi LightShow

## Overview
Vixi LightShow is a web-based application designed to manage and display LightShow.

## Project Structure
- **public/**: Contains static assets such as images, CSS, and JavaScript files.
- **server/**: Contains server-side scripts and configuration files.
- **src/styles/**: Contains SCSS files for styling the application.
- **tests/**: Contains test scripts and configuration files.

## Setup Instructions
1. Clone the repository to your local machine.
2. Navigate to the project directory.
3. Install the dependencies using `npm install`.

## Firebase Info
 - The baseSettings Collection is where all the defaults are stored (with the exception of the default programs, which is stored in the lightShow Collection under programs/default, this is where the default program data for all deployments is pulled), and is all the info that is copied over when a new org is created.
 - The deployments Collection is a list of all the deployments, this is how the list of deployments is built for the hepler, it's also the list we use to iterate through all the org collections, it contains the orgID, name, firestoreRoot, and token for each deployment.
 - The lightShow collection/deployment is the test one, and the one that is tied to the Z - Amber Org in the suite, the token for this deployment is the one you want to use when testing locally. 

## Usage
- Start the server using `npm run dev`. 
- Participant: http://localhost:3000/go/i/[token]
- Producer: http://localhost:3000/producer/[token]
- Output: http://localhost:3000/output/[token]
- helper: http://localhost:3000/helper/[token]

## Local test mode (sandbox org)

Set `APP_MODE=test` in `.env` so this process cannot open or write any live Firebase org. Only the sandbox token is valid. Other tokens (including the Z - Amber / `lightShow` token) return 404.

Default sandbox (override with env vars if needed):

| Field | Value |
|---|---|
| Token | `lwtest_k8m2n4p6q` |
| Firestore collection | `lwLocalTest` (created from `baseSettings` on first open; not added to the live deployments list) |
| Display name | `Lightwave Local Test` |

Local URLs when `APP_MODE=test`:

- Participant: http://localhost:3000/go/i/lwtest_k8m2n4p6q
- Participant with section: http://localhost:3000/go/i/lwtest_k8m2n4p6q?lw_section=142
- Producer: http://localhost:3000/producer/lwtest_k8m2n4p6q
- Output: http://localhost:3000/output/lwtest_k8m2n4p6q
- Helper: http://localhost:3000/helper/lwtest_k8m2n4p6q

Set `APP_MODE=live` (or omit it) before deploying to Render so every org works as usual. Never set `APP_MODE=test` on a production host.


## Dependencies
- Node.js
- Firebase

## Load Testing
To run the load test, follow these steps:
1. use the following command `artillery run tests/test.yaml`

## Cache headers (Render / CDN verification)

The app sets cache headers so that HTML is never cached (avoiding stale deploys) and hashed assets are cached long-term. After deploying (e.g. to Render), you can verify with `curl -I`:

**1. HTML / app shell must return `Cache-Control: no-store`**

```bash
# Replace BASE_URL with your Render URL (e.g. https://vixi-lightshow-dev.onrender.com) or http://localhost:3000
curl -I "BASE_URL/"
curl -I "BASE_URL/producer/YOUR_TOKEN"
curl -I "BASE_URL/helper/gej2qhxkV6pdve2h"
```

Expected: `Cache-Control: no-store` in the response headers.

**2. Hashed JS/CSS assets must return `Cache-Control: public, max-age=31536000, immutable`**

After a production build, `dist/` contains hashed filenames (e.g. `js/user-ABC123.js`, `css/main-abc12def.css`). Load any HTML page, then check the asset URL from the response body and run:

```bash
curl -I "BASE_URL/js/user-XXXXXX.js"
curl -I "BASE_URL/css/main-XXXXXXXX.css"
```

Expected: `Cache-Control: public, max-age=31536000, immutable`.

**3. Config / bootstrap must not be cached**

```bash
curl -I "BASE_URL/config.js"
```

Expected: `Cache-Control: no-store`.

**4. CDN (e.g. Cloudflare) cache behavior**

If you use Cloudflare (or similar) in front of Render:

- HTML responses should show `CF-Cache-Status: BYPASS` or `DYNAMIC` (not cached).
- Hashed asset responses may show `CF-Cache-Status: HIT` or `MISS`; on first request after deploy you get `MISS`, then `HIT` for subsequent requests.