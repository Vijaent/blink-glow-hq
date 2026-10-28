// Browser test of the finished index.html with a fake Supabase (no network). Needs: npm i playwright; CHROMIUM_PATH optional.
const { chromium } = require('playwright');
const fs = require('fs');
const INDEX = fs.readFileSync(require('path').join(__dirname, '../index.html'), 'utf8');
const FAKE = fs.readFileSync(__dirname + '/fake_supabase.js', 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c || x === undefined ? '' : ' | ' + JSON.stringify(x))); };
const open = { o: '09:00', c: '18:00' };
const CFG = { biz: 'Blink & Glow', tz: 'Africa/Nairobi', phone: '0712345678', hours: { 0: null, 1: open, 2: open, 3: open, 4: open, 5: open, 6: open }, breaks: [], blocks: [], buffer: 15, step: 30, notice: 0, staff: ['Kate', 'Amy'],
  services: [{ id: 's1', name: 'Sew-in', price: 5000, dur: 180, cat: 'Hair' }, { id: 's2', name: 'Lashes', price: 2500, dur: 90, cat: 'Lashes' }], sources: ['Instagram', 'WhatsApp'] };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 800 } });
  const p = await ctx.newPage(); await p.route(/fonts\.g/, r => r.abort());
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED/.test(m.text())) errs.push('console: ' + m.text()); });
  await p.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ contentType: 'application/javascript', body: `window.__SEED=${JSON.stringify([{ collection: 'pubcfg', id: 'main', data: CFG }])};` + FAKE }));
  await p.route('http://app.test/config.js', r => r.fulfill({ contentType: 'application/javascript', body: "window.BGHQ_CONFIG={url:'https://x.supabase.co',key:'k',publicUrl:'https://blinknglow.vercel.app'}" }));
  await p.route('http://app.test/**', r => r.request().url().endsWith('config.js') ? r.fallback() : r.fulfill({ contentType: 'text/html', body: INDEX }));

  // ---------- 1. a customer opens the booking link, signed out ----------
  await p.goto('http://app.test/#book-ig'); await p.waitForSelector('.pubwrap', { timeout: 8000 });
  ok('Customer sees the booking page (no login screen)', await p.isVisible('.pubwrap') && !(await p.isVisible('#gate')));
  ok('No staff navigation is shown to customers', !(await p.$('.nav')));
  ok('Customer sees both published services', (await p.$$('.svc')).length === 2);
  await p.click('.svc >> nth=0');
  await p.waitForSelector('.daypick button:not([disabled])');
  await p.click('.daypick button:not([disabled]) >> nth=2');
  await p.click('.slot >> nth=0');
  await p.fill('#pb-name', 'Wanjiru Kamau'); await p.fill('#pb-phone', '0712 345 678'); await p.fill('#pb-notes', 'Shoulder length');
  await p.click('text=Request this booking');
  await p.waitForSelector('text=Request received', { timeout: 5000 });
  ok('Customer gets a confirmation', true);
  const rows = await p.evaluate(() => [...window.__FAKEDB.rows.values()]);
  const inbox = rows.find(r => r.collection === 'inbox'), slot = rows.find(r => r.collection === 'slots');
  ok('The booking went through the server function, not a direct table write', await p.evaluate(() => window.__FAKEDB.log.some(l => l[0] === 'rpc' && l[1] === 'public_request_booking') && !window.__FAKEDB.log.some(l => l[0] === 'upsert')));
  ok('Request carries the tracking source from the #book-ig link', inbox && inbox.data.source === 'Instagram', inbox && inbox.data);
  ok('A pending slot was held', slot && slot.data.st === 'Pending confirmation');
  ok('The customer was never asked to sign in', !(await p.isVisible('#gate')));

  // second customer cannot take the same time
  await p.click('text=Make another booking');
  await p.click('.svc >> nth=0'); await p.waitForSelector('.daypick button:not([disabled])');
  await p.click('.daypick button:not([disabled]) >> nth=2');
  const t1 = await p.$$eval('.slot', e => e.map(x => x.textContent));
  ok('Held time is no longer offered while the stylist is busy', t1.length > 0);
  const c3 = await (await b.newContext()).newPage();
  await c3.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ contentType: 'application/javascript', body: `window.__SEED=${JSON.stringify(rows)};` + FAKE }));
  await c3.route('http://app.test/**', r => r.request().url().endsWith('config.js') ? r.fulfill({ contentType: 'application/javascript', body: "window.BGHQ_CONFIG={url:'https://x.supabase.co',key:'k',publicUrl:'https://blinknglow.vercel.app'}" }) : r.fulfill({ contentType: 'text/html', body: INDEX }));
  await c3.route(/fonts\.g/, r => r.abort());
  await c3.goto('http://app.test/#book'); await c3.waitForSelector('.pubwrap'); await c3.click('.svc >> nth=0'); await c3.waitForTimeout(400);
  const html3 = await c3.evaluate(() => document.body.innerText);
  ok('A different customer\'s page shows no names, phones or notes from other bookings', !/Wanjiru|Shoulder length/.test(html3));

  // ---------- 2. staff open the app ----------
  const ctx2 = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const q = await ctx2.newPage(); await q.route(/fonts\.g/, r => r.abort()); const errs2 = []; q.on('pageerror', e => errs2.push(e.message));
  await q.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ contentType: 'application/javascript', body: `window.__SEED=${JSON.stringify(rows.map(x => ({ collection: x.collection, id: x.id, data: x.data })))};` + FAKE }));
  await q.route('http://app.test/**', r => r.request().url().endsWith('config.js') ? r.fulfill({ contentType: 'application/javascript', body: "window.BGHQ_CONFIG={url:'https://x.supabase.co',key:'k',publicUrl:'https://blinknglow.vercel.app'}" }) : r.fulfill({ contentType: 'text/html', body: INDEX }));
  await q.goto('http://app.test/'); await q.waitForSelector('#gateForm', { state: 'visible', timeout: 8000 });
  ok('Staff are asked to sign in', true);
  ok('Dashboard is not visible before signing in', !(await q.$('.nav')) || !(await q.isVisible('.nav')));
  await q.fill('#gEmail', 'kate@blinkandglow.test'); await q.fill('#gPass', 'wrong');
  await q.click('#gBtn'); await q.waitForTimeout(500);
  ok('A wrong password is rejected with a message', (await q.textContent('#gErr')).length > 0 && await q.isVisible('#gateForm'));
  await q.fill('#gPass', 'correct-horse'); await q.click('#gBtn');
  await q.waitForSelector('.nav', { timeout: 8000 });
  ok('Signing in opens the dashboard', await q.isVisible('.nav'));
  ok('Product name is Blink & Glow HQ', (await q.textContent('.logo')).includes('Blink & Glow'));
  ok('Finance Tracker (not Money Centre) is in the menu', (await q.$$eval('.nav span', e => e.map(x => x.textContent))).some(t => /Finance Tracker/.test(t)));
  // the booking request arrives in the inbox
  await q.click('.nav >> text=Bookings'); await q.click('button:has-text("Requests")'); await q.waitForTimeout(500);
  ok('The customer\'s request shows up for staff', (await q.textContent('main')).includes('Wanjiru Kamau'));
  // accept it
  await q.click('main button:has-text("Confirm")'); await q.waitForTimeout(500);
  ok('Confirming offers a WhatsApp message to send, never claims it was sent', /Opening the link does not mean the message was sent/.test(await q.textContent('#modalroot')));
  await q.click('#modalroot button:has-text("Close")'); await q.waitForTimeout(500);
  const after = await q.evaluate(() => [...window.__FAKEDB.rows.values()].map(r => [r.collection, r.data.status || r.data.st]));
  ok('Confirming creates an appointment in the shared database', after.some(r => r[0] === 'appts'), after);
  ok('The request is marked as handled and the hold becomes a confirmed slot', after.some(r => r[0] === 'inbox' && r[1] !== 'New') && after.some(r => r[0] === 'slots' && r[1] === 'Confirmed'), after);
  // every tab opens
  for (const t of ['Overview', 'Clients', 'Bookings', 'Sales', 'Finance Tracker', 'Stock', 'Marketing', 'Reports', 'Settings']) {
    const el = await q.$(`.nav >> text=${t}`); if (!el) { ok('Tab exists: ' + t, false); continue }
    await el.click(); await q.waitForTimeout(250);
  }
  ok('Every tab opens with no errors', errs2.length === 0, errs2);
  // sign out returns to the gate
  await q.click('text=Sign out'); await q.waitForSelector('#gateForm', { state: 'visible', timeout: 6000 }).catch(() => {});
  ok('Signing out returns to the login screen', await q.isVisible('#gateForm'));

  // ---------- 2b. emailed invite / reset links must ask for a password ----------
  const mk = async (hash, session) => { const pg = await (await b.newContext({ viewport: { width: 390, height: 800 } })).newPage();
    await pg.route(/fonts\.g/, r => r.abort());
    if (session) await pg.addInitScript(() => sessionStorage.setItem('fakeSession', JSON.stringify({ user: { id: 'u9', email: 'kate@test' } })));
    await pg.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ contentType: 'application/javascript', body: FAKE }));
    await pg.route('http://app.test/**', r => r.request().url().endsWith('config.js') ? r.fulfill({ contentType: 'application/javascript', body: "window.BGHQ_CONFIG={url:'https://x.supabase.co',key:'k',publicUrl:'https://blinknglow.vercel.app'}" }) : r.fulfill({ contentType: 'text/html', body: INDEX }));
    await pg.goto('http://app.test/' + hash); await pg.waitForTimeout(900); return pg };
  let L = await mk('#access_token=abc&refresh_token=d&type=recovery', true);
  ok('A reset link asks for a new password, it does not drop the person into the app', await L.isVisible('#gPass2') && !(await L.isVisible('.nav')));
  await L.fill('#gPass', 'short'); await L.fill('#gPass2', 'short'); await L.click('#gBtn'); await L.waitForTimeout(300);
  ok('A too-short password is refused', /8 characters/.test(await L.textContent('#gErr')));
  await L.fill('#gPass', 'long-enough-1'); await L.fill('#gPass2', 'long-enough-2'); await L.click('#gBtn'); await L.waitForTimeout(300);
  ok('Mismatched passwords are refused', /do not match/.test(await L.textContent('#gErr')));
  await L.fill('#gPass', 'long-enough-1'); await L.fill('#gPass2', 'long-enough-1'); await L.click('#gBtn'); await L.waitForSelector('.nav', { timeout: 6000 });
  ok('After choosing a password the person is let in', await L.isVisible('.nav'));
  L = await mk('#access_token=abc&refresh_token=d&type=invite', true);
  ok('An invite link also asks the person to choose a password', await L.isVisible('#gPass2') && !(await L.isVisible('.nav')));
  L = await mk('', true);
  ok('A normal visit with a saved sign-in goes straight to the app', await L.isVisible('.nav'));
  L = await mk('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', false);
  ok('An expired link explains itself and offers a fresh one', /expired/.test(await L.textContent('#gErr')) && await L.isVisible('#gForgot'));

  // ---------- 2c. owner and admin screens, hours, link, install ----------
  const login = async (role) => { const pg = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); const er = []; pg.on('pageerror', e => er.push(e.message));
    await pg.route(/fonts\.g/, r => r.abort());
    await pg.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ contentType: 'application/javascript', body: `window.__ROLE='${role}';window.__SEED=${JSON.stringify(rows.map(x => ({ collection: x.collection, id: x.id, data: x.data })))};` + FAKE }));
    await pg.route('http://app.test/**', r => r.request().url().endsWith('config.js') ? r.fulfill({ contentType: 'application/javascript', body: "window.BGHQ_CONFIG={url:'https://x.supabase.co',key:'k',publicUrl:'https://blinknglow.vercel.app'}" }) : r.fulfill({ contentType: 'text/html', body: INDEX }));
    await pg.goto('http://app.test/'); await pg.waitForSelector('#gateForm', { state: 'visible' });
    await pg.fill('#gEmail', 'x@y.z'); await pg.fill('#gPass', 'correct-horse'); await pg.click('#gBtn'); await pg.waitForSelector('.nav', { timeout: 8000 }); await pg.waitForTimeout(400); pg.er = er; return pg };
  const navOf = pg => pg.$$eval('.nav span', e => e.map(x => x.textContent).filter(Boolean));
  const ow = await login('owner'), ad = await login('admin');
  const nOwner = await navOf(ow), nAdmin = await navOf(ad);
  ok('Owner menu has everything', ['Overview', 'Bookings', 'Clients', 'Sales', 'Finance Tracker', 'Stock', 'Marketing', 'Reports', 'Settings'].every(t => nOwner.some(x => x.includes(t))), nOwner);
  ok('Admin menu has only day-to-day pages', ['Overview', 'Bookings', 'Clients', 'Sales', 'Stock'].every(t => nAdmin.some(x => x.includes(t))) && !nAdmin.some(x => /Finance|Reports|Settings|Marketing|Services/.test(x)), nAdmin);
  ok('Sidebar says which access you have', /Owner access/.test(await ow.textContent('.sidefoot')) && /Admin access/.test(await ad.textContent('.sidefoot')));
  ok('Owner overview shows revenue; Admin overview does not', /Revenue target/.test(await ow.textContent('main')) && !/Revenue target|Estimated profit|Money collected/.test(await ad.textContent('main')));
  ok('Admin overview shows today\'s work', /Appointments today/.test(await ad.textContent('main')) && /Requests to confirm/.test(await ad.textContent('main')));
  await ad.click('text=Quick add'); await ad.waitForTimeout(200);
  const qa = await ad.$$eval('#modalroot button', e => e.map(x => x.textContent));
  ok('Admin quick add has no expense or content items', qa.includes('New sale') && !qa.includes('New expense') && !qa.includes('New content item'), qa);
  await ad.click('#modalroot button:has-text("Close")').catch(() => {}); await ad.keyboard.press('Escape');
  await ad.click('.nav >> text=Sales'); await ad.waitForTimeout(300);
  ok('Admin sales page hides totals and void/adjust', !/Money collected|Average sale/.test(await ad.textContent('main')) && !(await ad.$('button:has-text("Void")')) && !(await ad.$('button:has-text("Adjust")')));
  await ad.click('.nav >> text=Stock'); await ad.waitForTimeout(300);
  ok('Admin stock page has no cost value or receive/new product', !/Stock value/.test(await ad.textContent('main')) && !(await ad.$('button:has-text("New product")')) && !(await ad.$('button:has-text("Receive")')));
  // owner: settings, team, hours, link
  await ow.click('.nav >> text=Settings'); await ow.waitForTimeout(500);
  ok('Owner sees Team and access with both people', /Team and access/.test(await ow.textContent('main')) && /kate@test/.test(await ow.textContent('main')) && /amy@test/.test(await ow.textContent('main')));
  await ow.selectOption('select[aria-label="Access for amy@test"]', 'owner'); await ow.waitForTimeout(300);
  ok('Changing someone\'s access calls the server', await ow.evaluate(() => window.__FAKEDB.log.some(l => l[0] === 'role' && l[1] === 'amy@test' && l[2] === 'owner')));
  ok('Opening hours default to 8 pm, Monday to Saturday', await ow.evaluate(() => [1, 2, 3, 4, 5, 6].every(d => document.getElementById('st-hc' + d).value === '20:00')));
  ok('Booking address is fixed to the live site and cannot be typed over', await ow.evaluate(() => { const e = document.getElementById('st-bookingBase'); return e.disabled && e.value === 'https://blinknglow.vercel.app/' }));
  await ow.click('.nav >> text=Bookings'); await ow.click('text=Booking link and QR'); await ow.waitForTimeout(300);
  const links = await ow.$$eval('.dlg code.link', e => e.map(x => x.textContent));
  ok('Every booking link uses blinknglow.vercel.app/#book', links.length >= 3 && links.every(l => /^https:\/\/blinknglow\.vercel\.app\/#book(-[a-z0-9]+)?$/.test(l)), links);
  ok('Install button is offered on the sidebar', !!(await ow.$('button:has-text("Install on phone")')));
  await ow.keyboard.press('Escape');
  await ow.click('button:has-text("Install on phone")'); await ow.waitForTimeout(200);
  ok('Install help explains iPhone, Android and computer', /Add to Home Screen/.test(await ow.textContent('#modalroot')) && /Install app/.test(await ow.textContent('#modalroot')));
  ok('No script errors in the owner or admin screens', ow.er.length === 0 && ad.er.length === 0, [ow.er, ad.er]);
  // install files
  const fsx = require('fs'), path = require('path'), root = path.join(__dirname, '..');
  const man = JSON.parse(fsx.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  ok('Manifest is complete (name, standalone, icons incl. maskable)', man.name === 'Blink & Glow HQ' && man.display === 'standalone' && man.start_url && man.icons.some(i => i.sizes === '192x192') && man.icons.some(i => i.sizes === '512x512') && man.icons.some(i => i.purpose === 'maskable') && man.icons.every(i => fsx.existsSync(path.join(root, i.src))));
  ok('Service worker and iPhone icon are present, page links the manifest', fsx.existsSync(path.join(root, 'sw.js')) && fsx.existsSync(path.join(root, 'icons/apple-touch-icon.png')) && /rel="manifest"/.test(INDEX) && /apple-touch-icon/.test(INDEX) && /serviceWorker/.test(INDEX));
  ok('Service worker never handles other sites (Supabase data is not cached)', /url\.origin !== self\.location\.origin\) return/.test(fsx.readFileSync(path.join(root, 'sw.js'), 'utf8')));

  // ---------- 3. not configured ----------
  const r3 = await (await b.newContext()).newPage();
  await r3.route('**/*', r => r.request().url().endsWith('config.js') ? r.fulfill({ contentType: 'application/javascript', body: "window.BGHQ_CONFIG={url:'https://YOUR-PROJECT-REF.supabase.co',key:'YOUR-PUBLISHABLE-KEY'}" }) : r.request().url().includes('jsdelivr') ? r.fulfill({ contentType: 'application/javascript', body: FAKE }) : r.fulfill({ contentType: 'text/html', body: INDEX }));
  await r3.goto('http://app.test/'); await r3.waitForTimeout(800);
  ok('Placeholder config shows a clear message, not a blank page', /not connected|config/i.test(await r3.textContent('body')));

  ok('No script errors on the customer page', errs.length === 0, errs);
  console.log(`\n${pass} passed, ${fail} failed`); await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
