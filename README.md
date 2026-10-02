# Berkeley CRM

Kund-CRM för Berkeleys säljare: kundkarta, kundkort, besök, kommentarer,
att göra, omsättning, ruttplanering och rapporter. Installeras som app (PWA)
från webbläsaren.

**Live:** https://patric-wanner.github.io/berkeley-crm-app/

## Uppbyggnad

- Ren HTML/CSS/JavaScript (ES-moduler), inget byggsteg.
- **Supabase** för inloggning och databas. All behörighet styrs av
  Row Level Security i databasen (`sql/`).
- Leaflet (karta), OSRM (rutter), Nominatim (adress → koordinater),
  Chart.js (diagram). Allt laddas via CDN.
- Publiceras automatiskt till GitHub Pages vid push till `main`
  (`.github/workflows/deploy.yml`).

## Roller

| Roll | Ser | Får ändra |
|---|---|---|
| `salesperson` | sina egna kunder | sina egna kunder |
| `manager` | alla kunder | sina egna kunder, plus besök, kommentarer och att göra hos alla |
| `admin` | allt | allt, inklusive roller och kundfördelning |

Användare skapas i Supabase → Authentication → Users. En profil skapas
automatiskt som `salesperson`; roll ändras i appens adminvy.

## Databas

Kör filerna i Supabase SQL Editor i denna ordning:

1. `sql/schema.sql`
2. `sql/migrations_v2.sql` … `sql/migrations_v7_security.sql`

Kunddata (`import-customers.sql`, Excel-filer) ligger i `../kunddata` och
ska **inte** in i git, eftersom repot är publikt.

## Om appen slutar fungera

Supabase pausar gratisprojekt efter 7 dagar utan aktivitet. Då ser
inloggningen ut att fungera men säger "Kunde inte nå servern".

1. Logga in på https://supabase.com/dashboard.
2. Öppna projektet och klicka **Restore project**. All data finns kvar.
   Ett pausat projekt kan återställas i upp till 1 år.

`.github/workflows/keepalive.yml` pingar databasen två gånger i veckan
för att undvika pausen. GitHub stänger av schemalagda jobb i publika repon
efter 60 dagar utan commits; aktivera det då under Actions → Keep Supabase
awake.

## Köra lokalt

```bash
npx http-server . -p 8090 -c-1
```

Öppna http://localhost:8090/index.html.
