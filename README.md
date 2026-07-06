# May mOma Shopify Middleware Pro

Middleware Node.js/Express per interrogare il catalogo pubblico Shopify di May mOma senza usare il RAG come database.

## Deploy Railway

1. Carica questi file su GitHub:
   - `server.js`
   - `package.json`
   - `README.md`
2. Railway -> New Project -> Deploy from GitHub repo.
3. Genera il dominio.

Railway usa automaticamente `process.env.PORT`.

## Endpoint

### Health

```http
GET /health
```

### Summary categorie

```http
GET /summary
```

### Tutti i prodotti

```http
GET /products
```

### Filtri

```http
GET /products?category=earrings
GET /products?category=rings
GET /products?category=necklaces
GET /products?category=bracelets
GET /products?category=earrings&sort=price_asc
GET /products?category=earrings&price_max=150
GET /products?available=true
GET /products?material=swarovski
```

### Prodotto meno costoso

```http
GET /cheapest?category=necklaces
```

### Prodotto piu costoso

```http
GET /most-expensive?category=rings
```

### Search

```http
GET /search?q=fay
```

### Singolo prodotto

```http
GET /product/fay-carre-two-fingersring
```

## Endpoint unico per Kiedo

```http
POST /catalog
Content-Type: application/json
```

### Esempi body

Lista completa:

```json
{
  "intent": "list"
}
```

Tutti gli orecchini:

```json
{
  "intent": "list",
  "category": "earrings",
  "sort": "price_asc"
}
```

Collana meno costosa:

```json
{
  "intent": "cheapest",
  "category": "necklaces"
}
```

Ricerca per nome:

```json
{
  "intent": "list",
  "query": "fay"
}
```

Filtro prezzo:

```json
{
  "intent": "list",
  "category": "earrings",
  "price_max": 150
}
```

Prodotto singolo:

```json
{
  "intent": "product",
  "handle": "fay-carre-two-fingersring"
}
```

Confronto:

```json
{
  "intent": "compare",
  "handles": ["fay-carre-earrings", "golden-earrings"]
}
```

## Variabili ambiente opzionali

```txt
SHOPIFY_PRODUCTS_URL=https://maymoma.com/products.json?limit=250
CACHE_TTL_MS=300000
```

