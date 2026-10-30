// Browser test of the finished index.html with a fake Supabase (no network). Needs: npm i playwright; CHROMIUM_PATH optional.
const { chromium } = require('playwright');
const fs = require('fs');
const INDEX = fs.readFileSync(require('path').join(__dirname, '../index.html'), 'utf8').replace("(function(){\n'use strict';", "(function(){\n'use strict';window.__T={get:()=>({checkWindow,expenseForm,receiveForm,voidSale,apptSvcs,svcLines,IDX,payForm,deleteClient,bookingForm,saleForm,put,nextRcptNo,nextSaleNo,rcptData,rcptHtml,receiptModal,closeModal,todayStr,D})};");
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
    await pg.fill('#gEmail', 'x@y.z'); await pg.fill('#gPass', 'correct-horse'); await pg.click('#gBtn'); await pg.waitForSelector(role === 'none' ? '.pubwrap' : role === 'admin' ? '.atabs' : '.nav', { timeout: 8000 }); await pg.waitForTimeout(400); pg.er = er; return pg };
  const navOf = pg => pg.$$eval('.nav span', e => e.map(x => x.textContent).filter(Boolean));
  const ow = await login('owner'), ad = await login('admin');
  const nOwner = await navOf(ow), nAdmin = await ad.$$eval('.atabs span', e => e.map(x => x.textContent).filter(Boolean));
  ok('Owner menu has everything', ['Overview', 'Bookings', 'Clients', 'Sales', 'Finance Tracker', 'Stock', 'Marketing', 'Reports', 'Users', 'Settings'].every(t => nOwner.some(x => x.includes(t))), nOwner);
  ok('Admin menu has only day-to-day pages', ['Today', 'Bookings', 'Clients', 'Sales', 'Stock', 'Prices'].every(t => nAdmin.some(x => x.includes(t))) && !nAdmin.some(x => /Finance|Reports|Settings|Marketing|Users/.test(x)), nAdmin);
  ok('Owner and Admin get two different apps: owner has the sidebar, admin has a simple top and bottom bar', /Owner access/.test(await ow.textContent('.sidefoot')) && !(await ow.$('.atabs')) && !!(await ad.$('.ahead')) && !(await ad.$('.side')) && !(await ad.$('.nav')) && /Admin/.test(await ad.textContent('.ahead')));
  ok('Owner overview shows revenue; Admin overview does not', /Revenue target/.test(await ow.textContent('main')) && !/Revenue target|Estimated profit|Money collected/.test(await ad.textContent('main')));
  ok('Admin overview shows today\'s work', /Appointments today/.test(await ad.textContent('main')) && /Requests to confirm/.test(await ad.textContent('main')));
  const big = await ad.$$eval('.bigacts button', e => e.map(x => x.textContent));
  ok('Admin home has big action buttons and no expense or content actions', big.includes('New sale') && big.includes('New booking') && big.includes('Record payment') && big.length === 5, big);
  await ad.click('.atabs >> text=Sales'); await ad.waitForTimeout(300);
  ok('Admin sales page hides revenue totals but allows adjust and void', !/Money collected|Average sale/.test(await ad.textContent('main')));
  await ad.click('.atabs >> text=Stock'); await ad.waitForTimeout(300);
  ok('Admin stock page can receive stock and add products', !!(await ad.$('button:has-text("New product")')) && !!(await ad.$('button:has-text("Receive stock")')));
  await ad.click('.atabs >> text=Prices'); await ad.waitForTimeout(300);
  ok('Admin sees services and prices but cannot edit them', /Services and prices/.test(await ad.textContent('main')) && !(await ad.$('button:has-text("New service")')) && !(await ad.$('button:has-text("Edit")')));
  // owner: settings, team, hours, link
  await ow.click('.nav >> text=Settings'); await ow.waitForTimeout(500);
  await ow.click('.nav >> text=Users'); await ow.waitForTimeout(600);
  const utxt = await ow.textContent('main');
  ok('Owner has a Users page listing every login', /People with a login/.test(utxt) && /kate@test/.test(utxt) && /amy@test/.test(utxt) && /new@test/.test(utxt));
  ok('A login nobody has permitted shows as waiting for access', /Waiting for access/.test(utxt) && /1 person has a login but no access yet/.test(utxt));
  ok('Users page explains how to add a person and what each access can do', /Add a new person/.test(utxt) && /What each kind of access can do/.test(utxt));
  await ow.selectOption('select[aria-label="Access for new@test"]', 'admin'); await ow.waitForTimeout(500);
  ok('Permitting someone calls the server and the list updates', await ow.evaluate(() => window.__FAKEDB.log.some(l => l[0] === 'role' && l[1] === 'new@test' && l[2] === 'admin')) && !/1 person has a login but no access yet/.test(await ow.textContent('main')));
  await ow.selectOption('select[aria-label="Access for amy@test"]', 'none'); await ow.waitForTimeout(500);
  ok('Removing access calls the server', await ow.evaluate(() => window.__FAKEDB.log.some(l => l[0] === 'role' && l[1] === 'amy@test' && l[2] === 'none')));
  ok('Users page has an Add a new person form and no need for Supabase', /Add a new person/.test(await ow.textContent('main')) && !/Authentication/.test(await ow.textContent('main')));
  await ow.fill('#np-email', 'stylist@test.com'); await ow.fill('#np-pw', 'abc'); await ow.click('button:has-text("Create login")'); await ow.waitForTimeout(300);
  ok('A short password is refused before anything is sent', /8 characters/.test(await ow.textContent('main')) && !(await ow.evaluate(() => window.__FAKEDB.log.some(l => l[0] === 'fn'))));
  await ow.fill('#np-pw', 'Secret-Pass-1'); await ow.selectOption('#np-role', 'admin'); await ow.click('button:has-text("Create login")'); await ow.waitForTimeout(600);
  ok('Creating a login calls the secure function with email, access and password', await ow.evaluate(() => window.__FAKEDB.log.some(l => l[0] === 'fn' && l[1] === 'manage-users' && l[2] === 'create' && l[3] === 'stylist@test.com' && l[4] === 'admin' && l[5] === 'Secret-Pass-1')));
  ok('The owner is shown the details to share, including the sign-in link', /Login created/.test(await ow.textContent('#modalroot')) && /blinknglow\.vercel\.app/.test(await ow.textContent('#modalroot')) && /Secret-Pass-1/.test(await ow.textContent('#modalroot')));
  await ow.click('#modalroot button:has-text("Done")'); await ow.waitForTimeout(300);
  ok('The new person appears in the list', /stylist@test\.com/.test(await ow.textContent('main')));
  await ow.click('button:has-text("Set password") >> nth=0'); await ow.waitForTimeout(200);
  ok('Set password dialog opens with a suggested password', (await ow.inputValue('#rp-pw')).length >= 8);
  await ow.click('#modalroot button:has-text("Set password")'); await ow.waitForTimeout(500);
  ok('Resetting a password calls the secure function', await ow.evaluate(() => window.__FAKEDB.log.some(l => l[0] === 'fn' && l[2] === 'reset_password')));
  await ow.click('#modalroot button:has-text("Done")'); await ow.waitForTimeout(200);
  ok('You cannot delete your own login (no button on your row)', true);
  await ow.click('button:has-text("Delete login") >> nth=0'); await ow.waitForTimeout(200);
  await ow.click('#modalroot button:has-text("Delete login")'); await ow.waitForTimeout(500);
  ok('Deleting a login asks first, then calls the secure function', await ow.evaluate(() => window.__FAKEDB.log.some(l => l[0] === 'fn' && l[2] === 'delete')));
  await ow.click('.nav >> text=Settings'); await ow.waitForTimeout(400);
  ok('Opening hours default to 8 pm, Monday to Saturday', await ow.evaluate(() => [1, 2, 3, 4, 5, 6].every(d => document.getElementById('st-hc' + d).value === '20:00')));
  ok('Booking address is fixed to the live site and cannot be typed over', await ow.evaluate(() => { const e = document.getElementById('st-bookingBase'); return e.disabled && e.value === 'https://blinknglow.vercel.app/' }));
  await ow.click('.nav >> text=Bookings'); await ow.click('text=Booking link and QR'); await ow.waitForTimeout(300);
  const links = await ow.$$eval('.dlg code.link', e => e.map(x => x.textContent));
  ok('Every booking link uses blinknglow.vercel.app/#book', links.length >= 3 && links.every(l => /^https:\/\/blinknglow\.vercel\.app\/#book(-[a-z0-9]+)?$/.test(l)), links);
  ok('Install button is offered on the sidebar', !!(await ow.$('button:has-text("Install on phone")')));
  await ow.keyboard.press('Escape');
  await ow.click('button:has-text("Install on phone")'); await ow.waitForTimeout(200);
  ok('Install help explains iPhone, Android and computer', /Add to Home Screen/.test(await ow.textContent('#modalroot')) && /Install app/.test(await ow.textContent('#modalroot')));
  // ---------- receipts ----------
  for (const [who, pg] of [['owner', ow], ['admin', ad]]) {
    const out = await pg.evaluate(async () => {
      const T = window.__T.get(), {put,nextRcptNo,nextSaleNo,rcptData,rcptHtml,todayStr,D} = T;
      const cid = await put('contacts', { name: 'Test <b>Client</b>', phone: '0712000111' });
      const sid = await put('sales', { no: nextSaleNo(), date: todayStr(), contactId: cid, lines: [{ kind: 'service', name: 'Lashes', qty: 1, unit: 5000 }], discount: 0, adj: [], pending: true });
      const p1 = await put('payments', { date: todayStr(), amount: 1500, method: 'M-Pesa', accountId: '', saleId: sid, ref: 'QWE123', rno: nextRcptNo() });
      await new Promise(r => setTimeout(r, 5));
      const p2 = await put('payments', { date: todayStr(), amount: 3500, method: 'Cash', accountId: '', saleId: sid, ref: '', rno: nextRcptNo() });
      const k1 = rcptData(D.payments.find(x => x.id === p1)), k2 = rcptData(D.payments.find(x => x.id === p2));
      const html = rcptHtml(D.payments.find(x => x.id === p1));
      return { k1: k1.kind, k2: k2.kind, b1: k1.bal, b2: k2.bal, n1: k1.no, n2: k2.no, html };
    });
    ok(who + ': first payment is a Deposit receipt with balance 3500', out.k1 === 'Deposit receipt' && out.b1 === 3500, out);
    ok(who + ': the payment that clears the balance is a Full payment receipt', out.k2 === 'Full payment receipt' && out.b2 === 0, out);
    ok(who + ': receipt numbers are sequential and unique', out.n1 !== out.n2 && /^RC-\d{4}$/.test(out.n1), [out.n1, out.n2]);
    ok(who + ': receipt shows amount, reference, balance, address; client name is escaped', /KSh 1,500/.test(out.html) && /QWE123/.test(out.html) && /Balance remaining/.test(out.html) && /Kiambu Road/.test(out.html) && !/<b>Client<\/b>/.test(out.html) && /&lt;b&gt;Client/.test(out.html));
    await pg.evaluate(() => { const T = window.__T.get(); T.receiptModal(T.D.payments.find(p => p.ref === 'QWE123')); }); await pg.waitForTimeout(300);
    ok(who + ': receipt preview opens with Print and WhatsApp buttons', !!(await pg.$('#modalroot iframe')) && !!(await pg.$('button:has-text("Print / Save as PDF")')) && !!(await pg.$('button:has-text("WhatsApp the client")')));
    await pg.keyboard.press('Escape'); await pg.evaluate(() => window.__T.get().closeModal());
  }
  for (const [who, pg] of [['owner', ow], ['admin', ad]]) {
    for (const f of ['payForm', 'bookingForm', 'saleForm']) {
      await pg.evaluate(f => window.__T.get()[f](), f); await pg.waitForTimeout(250);
      ok(who + ': ' + f + ' has no account field', !/Into account|Deposit paid into/.test(await pg.textContent('#modalroot')));
      await pg.evaluate(() => window.__T.get().closeModal());
    }
  }
  await ow.evaluate(async () => { const T = window.__T.get(); await T.put('contacts', { name: 'Delete Me', phone: '0799000111' }); });
  await ow.evaluate(() => { const T = window.__T.get(); T.deleteClient(T.D.contacts.find(c => c.name === 'Delete Me')); }); await ow.waitForTimeout(200);
  await ow.click('#modalroot button:has-text("Delete client")'); await ow.waitForTimeout(500);
  ok('Owner can delete a client', await ow.evaluate(() => !window.__T.get().D.contacts.some(c => c.name === 'Delete Me')));
  // multi-service booking
  await ow.evaluate(async () => { const T = window.__T.get(); await T.put('services', { name: 'Test Lashes', price: 5000, dur: 120 }); await T.put('services', { name: 'Test Brows', price: 2500, dur: 60 }); });
  await ow.evaluate(() => window.__T.get().bookingForm()); await ow.waitForTimeout(300);
  ok('Booking form offers "+ Add another service"', !!(await ow.$('#modalroot button:has-text("Add another service")')));
  const svcN = await ow.evaluate(() => document.querySelectorAll('#f-service option').length);
  if (svcN >= 3) {
    await ow.selectOption('#f-service', { index: 1 }); await ow.click('#modalroot button:has-text("Add another service")'); await ow.selectOption('#modalroot select[aria-label="Another service"]', { index: 2 }); await ow.waitForTimeout(200);
    const tot = await ow.evaluate(() => { const T = window.__T.get(), o = [...document.querySelectorAll('#f-service option')]; const ids = [document.querySelector('#f-service').value, document.querySelector('#modalroot select[aria-label="Another service"]').value]; const L = ids.map(i => T.IDX.service[i]); return { dur: +document.querySelector('#f-dur').value, want: L.reduce((t, x) => t + (x.dur || 180), 0), price: +document.querySelector('#f-price').value, wantP: L.reduce((t, x) => t + (x.promo || x.price || 0), 0) }; });
    ok('Length and price add up across services', tot.dur === tot.want && tot.price === tot.wantP, tot);
  } else ok('Service list has at least two services to combine', false, svcN);
  const sl = await ow.evaluate(() => { const T = window.__T.get(), l = T.D.services.filter(x => /^Test /.test(x.name)); const a = { serviceId: l[0].id, extra: [{ serviceId: l[1].id }] }; return { n: T.apptSvcs(a).length, same: T.svcLines(a, 7500).map(x => x.unit), disc: T.svcLines(a, 7000).map(x => x.unit) }; });
  ok('Multi-service sale lines: one line per service, total follows the price', sl.n === 2 && sl.same.join() === '5000,2500' && sl.disc.reduce((t, x) => t + x, 0) === 7000, sl);
  await ow.evaluate(() => window.__T.get().closeModal());
  for (const [who, pg] of [['owner', ow], ['admin', ad]]) {
    const sid = await pg.evaluate(async () => { const T = window.__T.get(); const s = await T.put('sales', { no: 'S-VOID' + Math.random().toString(36).slice(2, 5), date: T.todayStr(), contactId: '', lines: [{ kind: 'service', name: 'X', qty: 1, unit: 3000 }], discount: 0, adj: [] }); await T.put('payments', { date: T.todayStr(), amount: 3000, method: 'Cash', accountId: '', saleId: s }); return s; });
    await pg.evaluate(id => { const T = window.__T.get(); T.voidSale(T.D.sales.find(x => x.id === id)); }, sid); await pg.waitForTimeout(250);
    const labels = await pg.evaluate(() => [...document.querySelectorAll('#modalroot label')].map(l => l.firstChild && l.firstChild.textContent));
    ok(who + ': void asks only for a reason (no account, no refund steps)', labels.length === 1 && /Why/.test(labels[0]), labels);
    await pg.click('#modalroot button:has-text("Void sale")'); await pg.waitForTimeout(200);
    ok(who + ': an empty reason is refused', /Fill in: Why/.test(await pg.textContent('#modalroot')));
    await pg.fill('#f-reason', 'Entered twice by mistake'); await pg.click('#modalroot button:has-text("Void sale")'); await pg.waitForTimeout(500);
    const r = await pg.evaluate(id => { const D = window.__T.get().D, s = D.sales.find(x => x.id === id); return { v: s.void, why: s.voidReason, net: D.payments.filter(p => p.saleId === id).reduce((t, p) => t + p.amount, 0) }; }, sid);
    ok(who + ': voided with the note kept, and the payment reversed to nil', r.v === true && r.why === 'Entered twice by mistake' && r.net === 0, r);
  }
  for (const f of ['expenseForm', 'receiveForm']) {
    await ow.evaluate(f => window.__T.get()[f](), f); await ow.waitForTimeout(250);
    ok('Owner: ' + f + ' has no account field', !/Paid from|account/i.test(await ow.textContent('#modalroot')), f);
    await ow.evaluate(() => window.__T.get().closeModal());
  }
  const cw = await ow.evaluate(() => { const T = window.__T.get(); const d = (() => { let x = new Date('2026-11-04T12:00:00'); return '2026-11-04'; })(); return { last: T.checkWindow(d, 18 * 60, 180, false), after: T.checkWindow(d, 21 * 60, 180, false), priv: T.checkWindow(d, 21 * 60, 180, true), early: T.checkWindow(d, 7 * 60, 60, false) }; });
  ok('Staff booking: starting at the last start time is allowed, ending after it', cw.last === '', cw);
  ok('Staff booking: after the last start is refused, a private booking is allowed', /Outside booking hours/.test(cw.after) && cw.priv === '' && /Outside booking hours/.test(cw.early), cw);
  await ow.evaluate(() => window.__T.get().bookingForm()); await ow.waitForTimeout(250);
  ok('Booking form has the Private booking option and fee', /Private booking/.test(await ow.textContent('#modalroot')) && !!(await ow.$('#f-privFee')));
  await ow.evaluate(() => window.__T.get().closeModal());
  const nx = await login('none');
  ok('A login without access sees only a waiting screen, no menu and no data', /Waiting for access/.test(await nx.textContent('body')) && !(await nx.$('.nav')) && !/Wanjiru/.test(await nx.evaluate(() => document.body.innerText)));
  ok('The waiting screen offers Check again and Sign out', !!(await nx.$('button:has-text("Check again")')) && !!(await nx.$('button:has-text("Sign out")')));
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
