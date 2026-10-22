// Blink & Glow HQ database tests, run against real Postgres (PGlite, PG 16).
// Emulates Supabase: roles anon/authenticated, auth.uid() from the JWT claim.
const { PGlite } = require('@electric-sql/pglite');
const fs = require('fs'), path = require('path');
const SQL = fs.readFileSync(path.join(__dirname, '../supabase/schema.sql'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || extra === undefined ? '' : ' | ' + JSON.stringify(extra))); };

// Nairobi calendar helpers (the function works in the studio's own time zone)
const nairobi = (add = 0) => { const d = new Date(Date.now() + add * 864e5); return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(d); };
const dowOf = s => new Date(s + 'T12:00:00Z').getUTCDay();
const nextDow = (dow, min = 3) => { for (let i = min; i < 40; i++) { const s = nairobi(i); if (dowOf(s) === dow) return s; } };

(async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant usage on schema public to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    create publication supabase_realtime;
  `);
  await db.exec(SQL); await db.exec(SQL);
  ok('Schema installs, and re-running it is safe', true);

  const UID = '22222222-0000-0000-0000-000000000001';
  const asTeam = async (sql, p) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub','${UID}',false); set role authenticated;`);
    try { return await db.query(sql, p); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`); } };
  const asAnon = async (sql, p) => { await db.exec(`reset role; set role anon;`); try { return await db.query(sql, p); } finally { await db.exec('reset role'); } };
  const errOf = async f => { try { await f(); return null; } catch (e) { return e.message; } };
  const n = async (col) => (await db.query('select count(*)::int n from records where collection=$1', [col])).rows[0].n;

  // ── lock-down ──
  ok('Signed-out visitors cannot read records', !!(await errOf(() => asAnon('select * from records'))));
  ok('Signed-out visitors cannot write records', !!(await errOf(() => asAnon("insert into records(collection,id,data) values('contacts','a','{}')"))));
  await asTeam("insert into records(collection,id,data) values('contacts','c1','{\"name\":\"Amina\"}')");
  ok('Team can add and read', (await asTeam("select data->>'name' x from records where id='c1'")).rows[0].x === 'Amina');
  await asTeam("update records set data='{\"name\":\"Amina W\"}' where id='c1'");
  const r = (await db.query("select updated_by::text u, updated_at is not null t from records where id='c1'")).rows[0];
  ok('Team can edit, and the editor is stamped', r.u === UID && r.t);
  await asTeam("delete from records where id='c1'");
  ok('Team can delete', (await n('contacts')) === 0);

  // ── studio settings published for the booking page ──
  const open = { o: '09:00', c: '18:00' };
  const cfg = { biz: 'Blink & Glow', tz: 'Africa/Nairobi', hours: { 0: null, 1: open, 2: open, 3: open, 4: open, 5: open, 6: { o: '09:00', c: '19:00' } },
    breaks: [], blocks: [], buffer: 15, step: 30, notice: 12, staff: ['Kate', 'Amy'],
    services: [{ id: 's1', name: 'Sew-in', price: 5000, dur: 180 }, { id: 's2', name: 'Lashes', price: 2500, dur: 90 }],
    sources: ['Instagram', 'WhatsApp'] };
  ok('Nothing is bookable before the studio publishes its settings',
    (await asAnon("select public_request_booking('s1',$1,600,'Test Name','0712345678')", [nextDow(3)])).rows[0].public_request_booking.error === 'not_configured');
  const setCfg = c => db.query("insert into records(collection,id,data) values('pubcfg','main',$1::jsonb) on conflict (collection,id) do update set data=excluded.data", [JSON.stringify(c)]);
  await setCfg(cfg);

  ok('Anyone can read the published settings', (await asAnon('select public_booking_config() c')).rows[0].c.services.length === 2);
  ok('Anyone can NOT read raw settings table', !!(await errOf(() => asAnon("select * from records where collection='pubcfg'"))));

  const book = async (svc, date, start, name = 'Wanjiru K', phone = '0712 345 678', notes = '', src = '') =>
    (await asAnon('select public_request_booking($1,$2,$3,$4,$5,$6,$7) r', [svc, date, start, name, phone, notes, src])).rows[0].r;

  const wed = nextDow(3), sun = nextDow(0), sat = nextDow(6), thu = nextDow(4, 4);

  // ── happy path ──
  let x = await book('s1', wed, 600, 'Wanjiru K', '0712 345 678', 'Medium length', 'Instagram');
  ok('A valid request is accepted', x.ok === true && x.staff === 'Kate' && x.dur === 180, x);
  const slot = (await db.query("select data from records where collection='slots' and data->>'date'=$1", [wed])).rows[0]?.data;
  ok('The time is held (service length + 15 min buffer) as pending', slot && slot.s === 600 && slot.e === 600 + 180 + 15 && slot.st === 'Pending confirmation', slot);
  const inbox = (await db.query("select data from records where collection='inbox'")).rows[0]?.data;
  ok('The request lands in the studio inbox with price from the studio list', inbox && inbox.status === 'New' && inbox.price === 5000 && inbox.source === 'Instagram' && inbox.apptId === slot.id, inbox);

  // ── double-booking ──
  x = await book('s1', wed, 660, 'Second Person', '0722 000 111');
  ok('Overlapping time goes to the next free stylist', x.ok && x.staff === 'Amy', x);
  x = await book('s1', wed, 630, 'Third Person', '0733 000 111');
  ok('When every stylist is busy the time is refused', x.ok === false && x.error === 'taken', x);
  x = await book('s2', wed, 600 + 195, 'Fourth Person', '0744 000 111');   // exactly when Kate frees up (after buffer)
  ok('A time that starts exactly after the buffer is allowed', x.ok && x.staff === 'Kate', x);
  ok('Only the accepted requests created slots', (await n('slots')) === 3 && (await n('inbox')) === 3);

  // ── the team cannot double-book either ──
  const e1 = await errOf(() => asTeam("insert into records(collection,id,data) values('slots','manual1',$1::jsonb)", [JSON.stringify({ id: 'manual1', date: wed, s: 650, e: 700, staff: 'Kate' })]));
  ok('Team write that overlaps a stylist is refused by the database', /slot_overlap/.test(e1 || ''), e1);
  const e2 = await errOf(() => asTeam("insert into records(collection,id,data) values('slots','manual2',$1::jsonb)", [JSON.stringify({ id: 'manual2', date: wed, s: 650, e: 700, staff: 'Third' })]));
  ok('A different stylist at the same time is fine', e2 === null, e2);
  // re-saving the same slot (no change) must not clash with itself
  const e3 = await errOf(() => asTeam("update records set data=data||'{\"st\":\"Confirmed\"}' where id=$1", [slot.id]));
  ok('A slot never clashes with itself on update', e3 === null, e3);
  const e4 = await errOf(() => asTeam("update records set data=data||'{\"s\":660,\"e\":900}' where id=$1", [slot.id]));
  ok('Moving a slot onto another booking is refused', /slot_overlap/.test(e4 || ''), e4);

  // ── studio rules, enforced on the server ──
  x = await book('s1', sun, 600); ok('Closed day is refused', x.error === 'closed', x);
  x = await book('s1', wed, 480); ok('Before opening is refused', x.error === 'outside_hours', x);
  x = await book('s1', wed, 17 * 60); ok('Running past closing is refused', x.error === 'outside_hours', x);
  x = await book('s2', sat, 17 * 60 + 30); ok('Saturday runs later (19:00 close): 17:30 + 90 min fits', x.ok === true, x);
  await setCfg({ ...cfg, breaks: [{ from: '13:00', to: '14:00' }] });
  x = await book('s2', thu, 12 * 60 + 30); ok('A booking that runs into the lunch break is refused', x.error === 'break', x);
  x = await book('s2', thu, 14 * 60); ok('A booking right after the break is allowed', x.ok === true, x);
  await setCfg(cfg);
  const today = nairobi(0);
  x = await book('s2', today, 9 * 60 + 0); ok('Inside the notice window (or closed today) is refused', ['too_soon', 'closed', 'outside_hours'].includes(x.error), x);
  x = await book('s1', nairobi(-1), 600); ok('A past date is refused', x.error === 'bad_date', x);
  x = await book('s1', nairobi(90), 600); ok('A date more than 60 days away is refused', x.error === 'bad_date', x);
  x = await book('s1', 'not-a-date', 600); ok('Garbage date is refused', x.error === 'bad_date', x);
  x = await book('nope', wed, 600); ok('Unknown service is refused', x.error === 'unknown_service', x);
  x = await book('s1', nextDow(5), 600, 'A', '0712345678'); ok('One-letter name is refused', x.error === 'invalid_name', x);
  x = await book('s1', nextDow(5), 600, 'Good Name', '12345'); ok('Short phone number is refused', x.error === 'invalid_phone', x);

  // blocked dates
  const fri = nextDow(5, 5);
  await setCfg({ ...cfg, blocks: [{ from: fri, to: fri }] });
  x = await book('s1', fri, 600); ok('A blocked date is refused', x.error === 'blocked', x);
  await setCfg(cfg);

  // spam guard: 3 open requests per phone number
  const sat2 = nextDow(6, 10);
  const same = '0799 111 222';
  let last;
  for (let i = 0; i < 4; i++) last = await book('s2', sat2, 9 * 60 + i * 120 > 0 ? 9 * 60 + i * 100 : 0, 'Repeat Person', same);
  ok('A fourth open request from one phone number is refused', last.error === 'too_many' || last.error === 'taken', last);

  // service duration comes from the studio, not the browser (no way to pass a length)
  const fn = (await db.query("select pg_get_function_arguments('public.public_request_booking(text,text,int,text,text,text,text)'::regprocedure) a")).rows[0].a;
  ok('A customer cannot choose their own length or price', !/dur|price|staff/i.test(fn), fn);

  // ── what customers can see of the diary ──
  const busy = (await asAnon('select * from public_busy($1,$2)', [wed, wed])).rows;
  ok('Busy times show only date, times and stylist', busy.length >= 3 && Object.keys(busy[0]).sort().join() === 'date,e,s,staff', busy[0]);
  ok('Customers cannot call anything else', !!(await errOf(() => asAnon("select slots_guard()"))));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
