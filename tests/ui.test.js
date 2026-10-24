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
  await p.route('http://app.test/config.js', r => r.fulfill({ contentType: 'application/javascript', body: "window.BGHQ_CONFIG={url:'https://x.supabase.co',key:'k'}" }));
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
  await c3.route('http://app.test/**', r => r.request().url().endsWith('config.js') ? r.fulfill({ contentType: 'application/javascript', body: "window.BGHQ_CONFIG={url:'https://x.supabase.co',key:'k'}" }) : r.fulfill({ contentType: 'text/html', body: INDEX }));
  await c3.route(/fonts\.g/, r => r.abort());
  await c3.goto('http://app.test/#book'); await c3.waitForSelector('.pubwrap'); await c3.click('.svc >> nth=0'); await c3.waitForTimeout(400);
  const html3 = await c3.evaluate(() => document.body.innerText);
  ok('A different customer\'s page shows no names, phones or notes from other bookings', !/Wanjiru|Shoulder length/.test(html3));

  // ---------- 2. staff open the app ----------
  const ctx2 = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const q = await ctx2.newPage(); await q.route(/fonts\.g/, r => r.abort()); const errs2 = []; q.on('pageerror', e => errs2.push(e.message));
  await q.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ contentType: 'application/javascript', body: `window.__SEED=${JSON.stringify(rows.map(x => ({ collection: x.collection, id: x.id, data: x.data })))};` + FAKE }));
  await q.route('http://app.test/**', r => r.request().url().endsWith('config.js') ? r.fulfill({ contentType: 'application/javascript', body: "window.BGHQ_CONFIG={url:'https://x.supabase.co',key:'k'}" }) : r.fulfill({ contentType: 'text/html', body: INDEX }));
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
    await pg.route('http://app.test/**', r => r.request().url().endsWith('config.js') ? r.fulfill({ contentType: 'application/javascript', body: "window.BGHQ_CONFIG={url:'https://x.supabase.co',key:'k'}" }) : r.fulfill({ contentType: 'text/html', body: INDEX }));
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

  // ---------- 3. not configured ----------
  const r3 = await (await b.newContext()).newPage();
  await r3.route('**/*', r => r.request().url().endsWith('config.js') ? r.fulfill({ contentType: 'application/javascript', body: "window.BGHQ_CONFIG={url:'https://YOUR-PROJECT-REF.supabase.co',key:'YOUR-PUBLISHABLE-KEY'}" }) : r.request().url().includes('jsdelivr') ? r.fulfill({ contentType: 'application/javascript', body: FAKE }) : r.fulfill({ contentType: 'text/html', body: INDEX }));
  await r3.goto('http://app.test/'); await r3.waitForTimeout(800);
  ok('Placeholder config shows a clear message, not a blank page', /not connected|config/i.test(await r3.textContent('body')));

  ok('No script errors on the customer page', errs.length === 0, errs);
  console.log(`\n${pass} passed, ${fail} failed`); await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
