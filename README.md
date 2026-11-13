# StoreStake (storestake.com)

Bobby and Kristi Samai's site for investing $2k–$25k in small Shopify stores. Static pages in `public/`, serverless API in `api/`, Neon Postgres, hosted on Vercel (team kbcompanyllc, project storestake).

- Edit pages directly in `public/*.html`. The report parser lives in `api/_report.js`; after changing it or any inline `<script>`, run `python3 tools/sync.py` (copies the parser into the apply/account pages and refreshes the CSP script hashes in `vercel.json`).
- Deploy: `npx vercel deploy --prod --yes`
- `tools/` is excluded from deploys by `.vercelignore`.
