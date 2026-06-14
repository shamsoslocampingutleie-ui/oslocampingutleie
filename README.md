# Oslo Camping Utleie

Vite + React + TypeScript-prosjekt. Hele appen ligger i `src/app.html` og lastes av `src/App.tsx`.

## Kjøre lokalt
```bash
npm install
npm run dev
```

## Bygge for produksjon
```bash
npm run build      # lager mappen dist/
npm run preview    # forhåndsvis bygget
```

## Deploy (Vercel — som Awaz)
1. Push dette til et GitHub-repo.
2. Vercel → New Project → velg repoet.
3. Framework: **Vite**. Build: `npm run build`. Output: `dist`.

## Slik er det satt opp
- `src/App.tsx` – React-komponenten. Importerer appen som råtekst (`./app.html?raw`) og viser den.
- `src/app.html` – hele den ferdige appen (HTML + CSS + JS i én fil).
- Vil du senere bytte demo-betaling med ekte Stripe via Supabase (`create-payment-intent`),
  flyttes betalingssteget til React og kaller edge-funksjonen med Stripe.js.
