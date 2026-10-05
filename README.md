# DanaTerang

DanaTerang is an evidence-first accountability platform for funded programs. This repository is the application workspace. The first code slice implements the versioned canonical proof format described in `packages/proof/README.md`.

## Development

Requirements: Node.js 20.9+ and npm 10+.

Install browser-test prerequisites once before running the full workspace suite:

```sh
python -m pip install -r apps/web/requirements-test.txt
python -m playwright install chromium
```

```sh
npm install
npm test
npm run dev:api
npm run dev:web
```

The `packages/proof` workspace implements the canonical proof format and raw-file hashing. `packages/domain` validates independent workflow status machines. `apps/api` and `apps/web` are the Express and Next.js application shells; the public page currently uses clearly labeled demo data.
