# Maymoma Shopify Middleware

Middleware Node.js/Express per interrogare il catalogo pubblico Shopify di Maymoma e restituire dati puliti al chatbot.

## Endpoint

- `GET /health`
- `GET /products`
- `GET /products?category=earrings`
- `GET /products?category=rings`
- `GET /products?category=necklaces`
- `GET /products?category=bracelets`
- `GET /products?category=earrings&sort=price_asc`
- `GET /cheapest?category=necklaces`
- `GET /product/:handle`
- `POST /catalog`

## Body POST /catalog

```json
{
  "intent": "list",
  "category": "earrings",
  "sort": "price_asc"
}
```

```json
{
  "intent": "cheapest",
  "category": "necklaces"
}
```

## Deploy Railway

1. Crea repo GitHub.
2. Carica questi file.
3. Railway -> New Project -> Deploy from GitHub repo.
4. Railway userà `npm start`.
5. Usa l'URL pubblico Railway come base URL per l'action HTTP di Kiedo.

