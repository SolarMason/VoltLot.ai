# VOLTLOT — voltlot.ai

Tri-state area's largest used Tesla dealer. 100% static site hosted on **GitHub Pages** with custom domain via Dreamhost DNS.

## Architecture

```
GitHub Pages (hosting) ← GitHub repo (source) ← GitHub Actions (auto-sync inventory)
Dreamhost DNS → voltlot.ai → GitHub Pages
```

- `index.html` — Single-file PWA (HTML/CSS/JS)
- `inventory.js` — Vehicle inventory data (auto-updated by GitHub Actions)
- `scripts/sync-inventory.js` — Scraper that pulls Tesla inventory from automarketstreet.com
- `.github/workflows/sync-inventory.yml` — Runs scraper every 6 hours

## Auto-Sync Inventory

Every 6 hours, a GitHub Action:
1. Scrapes automarketstreet.com Tesla listings
2. Parses year, model, trim, stock#, VIN, color, mileage, price, drivetrain
3. Updates `inventory.js` if anything changed
4. Commits + pushes → GitHub Pages auto-redeploys

### Manual sync
Go to Actions tab → "Sync Inventory" → "Run workflow"

### Change sync frequency
Edit `.github/workflows/sync-inventory.yml` cron schedule:
- `'0 */6 * * *'` = every 6 hours (default)
- `'0 */1 * * *'` = every hour
- `'0 */12 * * *'` = every 12 hours

## DNS Setup (Dreamhost)

Point `voltlot.ai` to GitHub Pages:
- A records: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
- CNAME: `www.voltlot.ai` → `YOUR_USERNAME.github.io`

Then in GitHub repo Settings → Pages → Custom domain: `voltlot.ai`

## Contact

- **Phone:** 855-VOLT-LOT (855-865-8568)
- **Email:** sales@voltlot.ai
- **Address:** 1021 Market St, Paterson, NJ 07513
