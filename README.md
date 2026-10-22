# Blink & Glow HQ

Business hub for Blink & Glow (Empire Square, Kiambu Road, Nairobi): clients, bookings, sales, payments, stock, expenses, marketing, repeat-customer reminders, reports and the public booking page.

- **App:** one page, `index.html`, hosted on Vercel. `config.js` holds the Supabase address and public key.
- **Data and logins:** Supabase. Every private record lives in one table, `public.records`.
- **Access:** only signed-in team members can see or change anything (row-level security). There is no public sign-up; logins are created by the admin.
- **Customers** never sign in. The public booking page (`/#book`, plus tracking links such as `/#book-ig`) can only call three database functions, which return the services, the busy times (no names) and let a customer request a time. Opening hours, notice, breaks, blocked dates, service length and double-booking are all enforced in the database, not in the customer's browser.

## First-time setup

1. **Database.** In Supabase, open SQL Editor → New query, paste all of `supabase/schema.sql`, and Run.
2. **Turn off public sign-ups.** Authentication → Sign In / Providers → Email: keep Email enabled, switch **Allow new users to sign up** off.
3. **Connect the app.** Supabase → Project Settings → API Keys: copy the Project URL and the **publishable** key into `config.js`, commit and push.
4. **Hosting.** In Vercel: Add New → Project → import this repo from GitHub → Deploy. No build settings or environment variables are needed.
5. **Site address.** In Supabase, Authentication → URL Configuration: set **Site URL** to the Vercel address (or custom domain) and add the same address under Redirect URLs. Invite and reset emails link here.
6. **Team logins.** Authentication → Users → Add user. Either **Send invitation** or **Create new user** with "Auto confirm" ticked and share the password privately. Create one for the owner, one per stylist, and one for the admin.
7. **First sign-in.** Open the site, sign in, go to Settings and check opening hours, stylists, services and prices. Settings are published to the booking page automatically.

## Making changes

Edit `index.html` and push to `main`. Vercel redeploys automatically in about a minute. Run the database tests first when `supabase/schema.sql` changes:

```
cd tests && npm install && npm test
```

## Backups

Supabase Pro takes daily backups. For an extra copy, run in the SQL Editor:
`select collection, id, data, updated_at from public.records order by collection, id;` and download the result as CSV. The app also has CSV exports on most screens.

## Notes

- The publishable key in `config.js` is designed to be public. Never put the secret / service_role key or the database password anywhere in this repo.
- The app sends WhatsApp messages by opening a pre-filled chat (`wa.me`); staff press send. It does not send automatically, and it never records a message as "sent", only as "link opened".
- There is no email or SMS provider connected.
