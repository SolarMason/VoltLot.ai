#!/usr/bin/env node
// VOLTLOT Inventory Sync — updates RAW array inside index.html
const https = require('https');
const fs = require('fs');
const path = require('path');

const SOURCE = 'https://automarketstreet.com/newandusedcars?clearall=1&makename=tesla';
const HTML_FILE = path.join(__dirname, '..', 'index.html');

function get(url) {
  return new Promise(function(res, rej) {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, function(r) {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        var loc = r.headers.location;
        if (!loc.startsWith('http')) loc = 'https://automarketstreet.com' + loc;
        return get(loc).then(res).catch(rej);
      }
      var d = ''; r.on('data', function(c) { d += c; }); r.on('end', function() { res(d); }); r.on('error', rej);
    }).on('error', rej);
  });
}

function parse(html) {
  var cars = [];
  var re = /href=['"]\/vdp\/(\d+)\/Used-(\d{4})-Tesla-([\w-]+?)-for-sale[^'"]*['"]/gi;
  var allM = [], m;
  while ((m = re.exec(html)) !== null) allM.push({ id: m[1], yr: parseInt(m[2]), slug: m[3], pos: m.index });
  console.log('  VDP links: ' + allM.length);

  for (var i = 0; i < allM.length; i++) {
    var vdpId = allM[i].id, year = allM[i].yr, slug = allM[i].slug, pos = allM[i].pos;
    var parts = slug.replace(/-+/g, '-').split('-');
    if (parts[0] !== 'Model' || parts.length < 2) continue;
    var model = 'Model ' + parts[1];
    if (['Model 3', 'Model S', 'Model X', 'Model Y'].indexOf(model) < 0) continue;
    var trim = parts.slice(2).join(' ').trim();

    var endPos = (i + 1 < allM.length) ? allM[i + 1].pos : pos + 1500;
    var block = html.substring(pos, Math.min(endPos, html.length));
    var before = html.substring(Math.max(0, pos - 500), pos);

    var tm = block.match(/title=['"](\d{4}\s+Tesla\s+[^'"]+)['"]/i) || before.match(/title=['"](\d{4}\s+Tesla\s+[^'"]+)['"]/i);
    if (tm) {
      var tp = tm[1].trim().match(/^\d{4}\s+Tesla\s+Model\s+[3SYXZ]\s*(.*)/i);
      if (tp) trim = tp[1].trim();
    }

    var stock = (block.match(/Stock\s*#?:?\s*(\d{3,6})/i) || [])[1];
    var color = (block.match(/Color:?\s*(\w+)/i) || [])[1] || 'BLK';
    var miles = (block.match(/Mileage:?\s*([\d,]+)/i) || [])[1] || '0';
    var drive = (block.match(/Drive:?\s*(AWD|RWD|4WD)/i) || [])[1] || 'RWD';
    var vin = (block.match(/VIN:?\s*([A-HJ-NPR-Z0-9]{10,17})/i) || [])[1];
    var pr = (block.match(/Retail\s*\$?([\d,]+)/i) || [])[1];

    if (!stock || !vin) continue;

    var c = color.toUpperCase();
    var cn = { BLACK: 'BLK', WHITE: 'WHI', BLUE: 'BLU', GRAY: 'GRY', SILVER: 'SIL', BROWN: 'BRO' };
    c = cn[c] || c.substring(0, 4);

    cars.push({
      vdpId: vdpId, year: year, model: model, trim: trim, stock: stock, color: c,
      mileage: parseInt(miles.replace(/,/g, '')),
      drive: drive.toUpperCase() === 'AWD' ? 'AWD' : 'RWD',
      price: pr ? parseInt(pr.replace(/,/g, '')) : 0,
      vin: vin
    });
  }

  var seen = {};
  return cars.filter(function(c) { if (seen[c.vin]) return false; seen[c.vin] = 1; return true; });
}

async function main() {
  console.log('VOLTLOT Sync');
  try {
    var html = await get(SOURCE);
    console.log('Fetched: ' + html.length + ' bytes');
    if (html.length < 5000) { console.error('Page too small'); process.exit(1); }

    var cars = parse(html);
    console.log('Parsed: ' + cars.length + ' Teslas');
    if (cars.length === 0) { console.error('0 cars parsed'); process.exit(1); }

    // Read index.html
    var src = fs.readFileSync(HTML_FILE, 'utf8');

    // Find existing RAW array
    var startMarker = 'const RAW=[';
    var startIdx = src.indexOf(startMarker);
    if (startIdx < 0) { console.error('RAW array not found in index.html'); process.exit(1); }
    var endIdx = src.indexOf('];', startIdx) + 2;

    // Count existing cars
    var oldBlock = src.substring(startIdx, endIdx);
    var oldCount = (oldBlock.match(/\['/g) || []).length;
    console.log('Existing: ' + oldCount + ' cars');

    // Safety
    if (oldCount > 10 && cars.length < oldCount * 0.5) {
      console.error('SAFETY: ' + cars.length + ' vs ' + oldCount + ' (>50% drop). Skipping.');
      process.exit(1);
    }

    // Build new RAW block
    var lines = cars.map(function(c) {
      var t = c.trim.replace(/'/g, "\\'");
      return "['" + c.vdpId + "'," + c.year + ",'" + c.model + "','" + t + "'," + c.stock + ",'" + c.color + "'," + c.mileage + ",'" + c.drive + "'," + c.price + ",'" + c.vin + "']";
    });
    var newBlock = 'const RAW=[\n' + lines.join(',\n') + '\n]';

    // Replace in source
    var newSrc = src.substring(0, startIdx) + newBlock + src.substring(endIdx);
    fs.writeFileSync(HTML_FILE, newSrc);

    // Also update 404.html
    var fourOhFour = path.join(__dirname, '..', '404.html');
    if (fs.existsSync(fourOhFour)) fs.writeFileSync(fourOhFour, newSrc);

    // Summary
    var m = {};
    cars.forEach(function(c) { m[c.model] = (m[c.model] || 0) + 1; });
    Object.keys(m).sort().forEach(function(k) { console.log('  ' + k + ': ' + m[k]); });
    console.log('Call-for-price: ' + cars.filter(function(c) { return c.price === 0; }).length);
    console.log('Done.');
  } catch (e) { console.error('FAIL: ' + e.message); process.exit(1); }
}

main();
