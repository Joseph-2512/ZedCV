# ZedCV: setup guide

ZedCV makes a CV and application letter (PDF and Word) for K5. Payment is checked on your server.

## How the payment check works

1. A customer sends K5 to your Airtel number (0978 076 668) and types the transaction ID from their SMS.
2. Your phone forwards each "money received" SMS to the server (or you add the ID by hand on the admin page).
3. The server matches the ID, checks the amount is at least K5, and gives the customer a 24-hour access token.
4. The code that builds the PDF and Word files is only sent to the browser after that. Without a paid ID, the customer never receives it.

Each transaction ID works for 24 hours (change with `ACCESS_HOURS`) and up to 30 page loads. A made-up ID is refused because it is not in your records. After 12 wrong guesses in 10 minutes an IP address is blocked for a while.

## Run it

You need Node 18 or newer. There are no packages to install.

```
cd server
ADMIN_KEY=choose-a-long-secret node server.js
```

Open `http://localhost:3000` for the app and `http://localhost:3000/admin` for payments.

Settings (environment variables): `ADMIN_KEY` (required, 12+ characters), `PORT`, `PRICE_KWACHA` (default 5), `ACCESS_HOURS` (default 24), `DATA_FILE` (where payments are stored).

## Put it online

Any host that runs Node works (Render, Railway, Fly.io, or a VPS). Three things matter:

- Use HTTPS (the hosts above give it to you free).
- Keep `data/payments.json` on a persistent disk, or you lose the payment records on every restart.
- Set `ADMIN_KEY` as a secret, never in the code.

## Forward your Airtel SMS to the server

Install an SMS forwarding app on the phone that holds your Airtel SIM (for example "SMS Forwarder" or "HTTP SMS" from the Play Store). Set it to send a POST request to:

```
https://YOUR-SITE/api/ingest
Header:  x-admin-key: YOUR_ADMIN_KEY
Body:    {"message": "<the SMS text>"}
```

Filter it to messages from Airtel Money only. Then open `/admin`, paste one real "money received" SMS into **Test an SMS**, and check the amount and transaction ID are read correctly. The reader looks for words like "Trans ID" and an amount like "K5.00". If Airtel words it differently, the test will say so, and the pattern in `parseSms` (server.js) is a one-line change.

Until the forwarder is set up, add payments by hand on `/admin`.

## Changing details

Your number, name and price are in `build.py` (the `config` function). After a change run `python3 build.py`, which rebuilds `server/public/index.html` and `server/engine.js`. The page source is in `src/app.html` and the file builder is in `src/engine.js`.

## Limits to know about

- Airtel could change its SMS wording. Test after any change they announce.
- This checks payments against SMS records on your own phone. It does not use Airtel's business API. If you later want automatic collection (the customer approves a prompt on their phone), use a Zambian payment provider that offers mobile money collection and replace `/api/ingest` with its webhook.
- Customers' CV details stay in their own browser. The server stores only transaction IDs, amounts and phone numbers of senders.
- The ZRA/ZAQA layout follows the usual public-service CV structure (personal particulars, qualifications, experience, referees, signed declaration, and an enclosures list on the letter). Each advert can ask for something different, so customers should check the advert.
