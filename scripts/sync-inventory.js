#!/usr/bin/env node
/**
 * VOLTLOT Inventory Sync
 * Scrapes Tesla inventory from automarketstreet.com and generates inventory.js
 * Run via GitHub Actions on a schedule, or manually: node scripts/sync-inventory.js
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const SOURCE_URL = 'https://automarketstreet.com/newandusedcars?clearall=1&makename=tesla';
const OUTPUT_FILE = path.join(__dirname, '..', 'inventory.js');

function fetch(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'VOLTLOT-Sync/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function parseInventory(html) {
  const cars = [];

  // Strategy: Find each VDP link, then extract data from surrounding text
  // DealerCarSearch HTML format: each car is in a vehicle card block
  const vdpLinks = [...html.matchAll(/href="\/vdp\/(\d+)\/Used-(\d{4})-Tesla-([^"]+)-for-sale[^"]*"/gi)];

  for (const link of vdpLinks) {
    const [fullMatch, vdpId, year, slugRest] = link;
    const pos = link.index;

    // Get surrounding ~2000 chars for this car's data block
    const block = html.substring(pos, Math.min(pos + 2000, html.length));

    // Parse model from slug: "Model-3-LONG-RANGE-AWD" → model="Model 3", trim="LONG RANGE AWD"
    const slugParts = slugRest.split('-');
    let model = '', trim = '';
    if (slugParts[0] === 'Model' && slugParts.length >= 2) {
      model = 'Model ' + slugParts[1];
      trim = slugParts.slice(2).join(' ').trim();
    } else {
      continue; // Not a valid Tesla model
    }

    // Extract fields from surrounding block
    const stockMatch = block.match(/Stock\s*#:\s*(\d+)/i);
    const colorMatch = block.match(/Color:\s*(\w+)/i);
    const mileageMatch = block.match(/Mileage:\s*([\d,]+)/i);
    const driveMatch = block.match(/Drive:\s*(\w+)/i);
    const vinMatch = block.match(/VIN:\s*([\w]+)/i);
    const priceMatch = block.match(/Retail\s*\$?([\d,]+)/i);
    const transMatch = block.match(/Trans:\s*(\w+)/i);

    if (!stockMatch || !vinMatch) continue; // Must have at least stock and VIN

    const stock = stockMatch[1];
    const vin = vinMatch[1];
    const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : 0;
    const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : 0;
    const drive = driveMatch ? (driveMatch[1].toUpperCase() === 'AWD' ? 'AWD' : 'RWD') : 'RWD';

    // Normalize color
    let color = colorMatch ? colorMatch[1].toUpperCase() : 'BLK';
    const colorMap = { BLACK: 'BLK', WHITE: 'WHI', BLUE: 'BLU', GREY: 'GREY', GRAY: 'GRY', SILVER: 'SIL', BROWN: 'BRO' };
    color = colorMap[color] || color.substring(0, 3);

    if (vin.length >= 10 && parseInt(year) >= 2010) {
      cars.push({ vdpId, year: parseInt(year), model, trim, stock, color, mileage, drive, price, vin });
    }
  }

  // Deduplicate by VIN
  const seen = new Set();
  return cars.filter(c => {
    if (seen.has(c.vin)) return false;
    seen.add(c.vin);
    return true;
  });
}

function generateInventoryJS(cars) {
  const timestamp = new Date().toISOString();
  const tuples = cars.map(c => {
    const p = c.price || 0;
    return `['${c.vdpId}',${c.year},'${c.model}','${c.trim}',${c.stock},'${c.color}',${c.mileage},'${c.drive}',${p},'${c.vin}']`;
  });

  return `// VOLTLOT Inventory — Auto-synced from automarketstreet.com
// Last updated: ${timestamp}
// Total: ${cars.length} Teslas
const RAW=[
${tuples.join(',\n')}
];
`;
}

async function main() {
  console.log('Fetching inventory from automarketstreet.com...');

  try {
    const html = await fetch(SOURCE_URL);
    console.log(`Fetched ${html.length.toLocaleString()} bytes`);

    const cars = parseInventory(html);
    console.log(`Parsed ${cars.length} Tesla vehicles`);

    if (cars.length === 0) {
      console.error('ERROR: No cars parsed — page structure may have changed');
      console.error('Keeping existing inventory.js unchanged');
      process.exit(1);
    }

    // Safety check: don't overwrite if count drops dramatically
    if (fs.existsSync(OUTPUT_FILE)) {
      const existing = fs.readFileSync(OUTPUT_FILE, 'utf8');
      const existingCount = (existing.match(/\['/g) || []).length;
      if (cars.length < existingCount * 0.5) {
        console.error(`WARNING: Parsed ${cars.length} cars vs ${existingCount} existing — possible scrape error`);
        console.error('Keeping existing inventory.js unchanged');
        process.exit(1);
      }
    }

    // Generate and write
    const js = generateInventoryJS(cars);
    fs.writeFileSync(OUTPUT_FILE, js);
    console.log(`Written to ${OUTPUT_FILE}`);

    // Summary
    const models = {};
    cars.forEach(c => { models[c.model] = (models[c.model] || 0) + 1; });
    console.log('\nInventory Summary:');
    Object.entries(models).sort((a, b) => b[1] - a[1]).forEach(([m, n]) => {
      console.log(`  ${m}: ${n}`);
    });

    const priced = cars.filter(c => c.price > 0);
    if (priced.length) {
      const prices = priced.map(c => c.price).sort((a, b) => a - b);
      console.log(`\nPrice range: $${prices[0].toLocaleString()} – $${prices[prices.length - 1].toLocaleString()}`);
    }
    console.log(`Call-for-price: ${cars.filter(c => c.price === 0).length}`);

  } catch (err) {
    console.error('Sync failed:', err.message);
    process.exit(1);
  }
}

main();
