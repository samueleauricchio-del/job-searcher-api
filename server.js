import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;
const SHOPIFY_PRODUCTS_URL =
  process.env.SHOPIFY_PRODUCTS_URL ||
  "https://maymoma.com/products.json?limit=250";

const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 5 * 60 * 1000);

let cache = {
  fetchedAt: 0,
  products: []
};

const CATEGORY_ALIASES = {
  ring: "rings",
  rings: "rings",
  anello: "rings",
  anelli: "rings",

  earring: "earrings",
  earrings: "earrings",
  orecchino: "earrings",
  orecchini: "earrings",
  earcuff: "earrings",
  earcuffs: "earrings",
  "ear cuff": "earrings",
  "ear cuffs": "earrings",
  cuff: "earrings",
  cuffs: "earrings",
  hoop: "earrings",
  hoops: "earrings",

  necklace: "necklaces",
  necklaces: "necklaces",
  collana: "necklaces",
  collane: "necklaces",
  choker: "necklaces",
  chocker: "necklaces",

  bracelet: "bracelets",
  bracelets: "bracelets",
  bracciale: "bracelets",
  bracciali: "bracelets"
};

function stripHtml(html = "") {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeCategory(value = "") {
  const text = normalizeText(value);
  if (!text) return null;

  for (const [key, canonical] of Object.entries(CATEGORY_ALIASES)) {
    if (text === key || text.includes(key)) return canonical;
  }

  return null;
}



  function inferCategory(product) {
  const titleHandle = normalizeText(`
    ${product.title || ""}
    ${product.handle || ""}
  `);

  const metadata = normalizeText(`
    ${product.product_type || ""}
    ${(product.tags || []).join(" ")}
  `);

  const description = normalizeText(stripHtml(product.body_html || ""));

  const primary = `${titleHandle} ${metadata}`;

  if (
    primary.includes("earring") ||
    primary.includes("earrings") ||
    primary.includes("orecchin") ||
    primary.includes("ear cuff") ||
    primary.includes("earcuff") ||
    primary.includes("hoop")
  ) return "earrings";

  if (
    primary.includes("ring") ||
    primary.includes("rings") ||
    primary.includes("anello") ||
    primary.includes("anelli") ||
    primary.includes("anell")
  ) return "rings";

  if (
    primary.includes("necklace") ||
    primary.includes("necklaces") ||
    primary.includes("collana") ||
    primary.includes("collane") ||
    primary.includes("collan") ||
    primary.includes("choker")
  ) return "necklaces";

  if (
    primary.includes("bracelet") ||
    primary.includes("bracelets") ||
    primary.includes("bracciale") ||
    primary.includes("bracciali") ||
    primary.includes("braccial") ||
    primary.includes("cavigliera")
  ) return "bracelets";

  if (
    description.includes("earring") ||
    description.includes("orecchin") ||
    description.includes("earcuff") ||
    description.includes("hoop")
  ) return "earrings";

  if (
    description.includes("ring") ||
    description.includes("rings") ||
    description.includes("anello") ||
    description.includes("anelli")
  ) return "rings";

  if (
    description.includes("necklace") ||
    description.includes("collana") ||
    description.includes("collane") ||
    description.includes("choker")
  ) return "necklaces";

  if (
    description.includes("bracelet") ||
    description.includes("bracciale") ||
    description.includes("bracciali") ||
    description.includes("cavigliera")
  ) return "bracelets";

  return "other";
}
function normalizeProduct(product) {
  const variants = (product.variants || []).map(v => ({
    id: v.id,
    title: v.title,
    option1: v.option1,
    option2: v.option2,
    option3: v.option3,
    price:
      v.price !== undefined && v.price !== null
        ? Number(v.price)
        : null,
    available: Boolean(v.available)
  }));

  const prices = variants
    .map(v => v.price)
    .filter(v => Number.isFinite(v));

  const available = variants.some(v => v.available);
  const description = stripHtml(product.body_html || "");
  const category = inferCategory(product);

  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    category,
    product_type: product.product_type || "",
    vendor: product.vendor || "",
    tags: product.tags || [],
    price_min: prices.length ? Math.min(...prices) : null,
    price_max: prices.length ? Math.max(...prices) : null,
    available,
    url: `https://maymoma.com/products/${product.handle}`,
    variants,
    description,
    images: (product.images || []).map(img => img.src).filter(Boolean),
    published_at: product.published_at,
        updated_at: product.updated_at
  };
}

async function fetchShopifyPage(page = 1) {
  const separator = SHOPIFY_PRODUCTS_URL.includes("?") ? "&" : "?";
  const url = `${SHOPIFY_PRODUCTS_URL}${separator}page=${page}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Shopify error ${response.status}`);
  }

  return response.json();
}

async function loadProducts(force = false) {
  const now = Date.now();

  if (
    !force &&
    cache.products.length &&
    now - cache.fetchedAt < CACHE_TTL_MS
  ) {
    return cache.products;
  }

  const all = [];

  for (let page = 1; page <= 20; page++) {
    const data = await fetchShopifyPage(page);
    const products = data.products || [];

    if (!products.length) break;

    all.push(...products);

    if (products.length < 250) break;
  }

  cache = {
    fetchedAt: Date.now(),
    products: all.map(normalizeProduct)
  };

  return cache.products;
}

function sortProducts(products, sort = "price_asc") {
  const items = [...products];

  const getPrice = p =>
    Number.isFinite(p.price_min) ? p.price_min : Infinity;

  if (sort === "price_desc") {
    return items.sort((a, b) => getPrice(b) - getPrice(a));
  }

  if (sort === "title_asc") {
    return items.sort((a, b) => a.title.localeCompare(b.title));
  }

  if (sort === "title_desc") {
    return items.sort((a, b) => b.title.localeCompare(a.title));
  }

  if (sort === "newest") {
    return items.sort(
      (a, b) =>
        new Date(b.published_at || 0) -
        new Date(a.published_at || 0)
    );
  }

  return items.sort((a, b) => getPrice(a) - getPrice(b));
}

function applyFilters(products, filters = {}) {
  let result = [...products];

  const category = normalizeCategory(filters.category);

  if (category) {
    result = result.filter(p => p.category === category);
  }

  if (filters.available !== undefined) {
    const available =
      filters.available === true || filters.available === "true";

    result = result.filter(p => p.available === available);
  }

  if (filters.price_min !== undefined) {
    const min = Number(filters.price_min);

    if (Number.isFinite(min)) {
      result = result.filter(
        p => Number.isFinite(p.price_min) && p.price_min >= min
      );
    }
  }

  if (filters.price_max !== undefined) {
    const max = Number(filters.price_max);

    if (Number.isFinite(max)) {
      result = result.filter(
        p => Number.isFinite(p.price_min) && p.price_min <= max
      );
    }
  }

  if (filters.material) {
    const needle = normalizeText(filters.material);

    result = result.filter(p =>
      normalizeText(
        `${p.title} ${p.description} ${p.tags.join(" ")}`
      ).includes(needle)
    );
  }

  if (filters.query) {
    const needle = normalizeText(filters.query);

    result = result.filter(p =>
      normalizeText(
        `${p.title} ${p.handle} ${p.description} ${p.tags.join(" ")}`
      ).includes(needle)
    );
  }

  return result;
}

function limitProducts(products, limit) {
  const n = Number(limit);

  if (!Number.isFinite(n) || n <= 0) {
    return products;
  }

  return products.slice(0, n);
}

function summary(products) {
  const categories = products.reduce((acc, p) => {
    acc[p.category] = (acc[p.category] || 0) + 1;
    return acc;
  }, {});

  return {
    count: products.length,
    categories,
    cache: {
      fetched_at: new Date(cache.fetchedAt).toISOString(),
      ttl_ms: CACHE_TTL_MS
    }
  };
}

function formatPrice(product) {
  if (!Number.isFinite(product.price_min)) {
    return "Prezzo non disponibile";
  }

  if (
    Number.isFinite(product.price_max) &&
    product.price_max !== product.price_min
  ) {
    return `€${product.price_min} - €${product.price_max}`;
  }

  return `€${product.price_min}`;
}
function productMarkdown(product) {
  const variants = product.variants
    .map(v => {
      const variantPrice = Number.isFinite(v.price)
        ? `€${v.price}`
        : "prezzo non disponibile";

      const availability = v.available
        ? "disponibile"
        : "non disponibile";

      return `  - Variante: ${v.title || "Default"} | ${variantPrice} | ${availability}`;
    })
    .join("\n");

  return `## ${product.title}

Categoria: ${product.category}
Prezzo: ${formatPrice(product)}
Disponibilità: ${product.available ? "disponibile" : "non disponibile"}
URL: ${product.url}
Tipo prodotto: ${product.product_type || "non specificato"}
Vendor: ${product.vendor || "non specificato"}
Tag: ${product.tags.length ? product.tags.join(", ") : "nessun tag"}
Descrizione: ${product.description || "descrizione non disponibile"}

Varianti:
${variants || "  - Nessuna variante disponibile"}

`;
}

function buildRagDocument(products) {
  const sortedAll = sortProducts(products, "price_asc");

  const categories = {
    earrings: "Orecchini",
    rings: "Anelli",
    necklaces: "Collane",
    bracelets: "Bracciali",
    other: "Altro"
  };

  let md = `# Knowledge Base Catalogo May mOma

Questa knowledge base contiene il catalogo prodotti May mOma estratto da Shopify.

Totale prodotti: ${products.length}
Ultimo aggiornamento cache: ${new Date(cache.fetchedAt).toISOString()}

Usa solo i dati presenti in questo documento per rispondere a domande su prodotti, prezzi, categorie, disponibilità, varianti, descrizioni e URL.

`;

  md += `# Riepilogo categorie

`;

  for (const [key, label] of Object.entries(categories)) {
    const items = products.filter(p => p.category === key);
    md += `- ${label}: ${items.length} prodotti\n`;
  }

  md += `

# Prodotti meno costosi per categoria

`;

  for (const [key, label] of Object.entries(categories)) {
    const items = sortProducts(
      products.filter(
        p => p.category === key && Number.isFinite(p.price_min)
      ),
      "price_asc"
    );

    if (items.length) {
      const cheapest = items[0];
      md += `- ${label}: ${cheapest.title} | ${formatPrice(cheapest)} | ${cheapest.url}\n`;
    } else {
      md += `- ${label}: nessun prodotto con prezzo disponibile\n`;
    }
  }

  md += `

# Tutti i prodotti ordinati per prezzo

`;

  sortedAll.forEach((p, index) => {
    md += `${index + 1}. ${p.title} | ${formatPrice(p)} | Categoria: ${p.category} | Disponibilità: ${p.available ? "disponibile" : "non disponibile"} | ${p.url}\n`;
  });

  for (const [key, label] of Object.entries(categories)) {
    const items = sortProducts(
      products.filter(p => p.category === key),
      "price_asc"
    );

    md += `

# Lista completa ${label}

`;

    if (!items.length) {
      md += `Nessun prodotto trovato per questa categoria.

`;
      continue;
    }

    items.forEach(p => {
      md += `- ${p.title} | ${formatPrice(p)} | ${p.available ? "disponibile" : "non disponibile"} | ${p.url}\n`;
    });
  }

  md += `

# Schede complete prodotti

`;

  sortedAll.forEach(p => {
    md += productMarkdown(p);
  });

  return md;
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "May mOma Shopify Middleware",
    endpoints: [
      "GET /health",
      "GET /summary",
      "GET /products",
      "GET /products?category=earrings&sort=price_asc",
      "GET /cheapest?category=necklaces",
      "GET /most-expensive?category=rings",
      "GET /search?q=fay",
      "GET /product/:handle",
      "GET /rag",
      "POST /catalog"
    ]
  });
});
app.get("/health", async (req, res) => {
  try {
    const products = await loadProducts();

    res.json({
      ok: true,
      count: products.length,
      fetched_at: new Date(cache.fetchedAt).toISOString()
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.get("/summary", async (req, res) => {
  try {
    const products = await loadProducts(true);
    res.json(summary(products));
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.get("/products", async (req, res) => {
  try {
    const products = await loadProducts(req.query.refresh === "true");
    const filtered = applyFilters(products, req.query);
    const sorted = sortProducts(filtered, req.query.sort || "price_asc");

    res.json({
      count: sorted.length,
      products: limitProducts(sorted, req.query.limit)
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.get("/cheapest", async (req, res) => {
  try {
    const products = await loadProducts();

    const filtered = applyFilters(products, req.query).filter(p =>
      Number.isFinite(p.price_min)
    );

    const sorted = sortProducts(filtered, "price_asc");

    res.json({
      count: sorted.length,
      product: sorted[0] || null
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.get("/most-expensive", async (req, res) => {
  try {
    const products = await loadProducts();

    const filtered = applyFilters(products, req.query).filter(p =>
      Number.isFinite(p.price_min)
    );

    const sorted = sortProducts(filtered, "price_desc");

    res.json({
      count: sorted.length,
      product: sorted[0] || null
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.get("/search", async (req, res) => {
  try {
    const products = await loadProducts();

    const filtered = applyFilters(products, {
      query: req.query.q || req.query.query
    });

    const sorted = sortProducts(filtered, req.query.sort || "price_asc");

    res.json({
      count: sorted.length,
      products: limitProducts(sorted, req.query.limit)
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.get("/product/:handle", async (req, res) => {
  try {
    const products = await loadProducts();
    const product = products.find(p => p.handle === req.params.handle);

    if (!product) {
      return res.status(404).json({
        error: "Product not found"
      });
    }

    res.json(product);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.get("/rag/:category", async (req, res) => {
  try {
    const products = await loadProducts(req.query.refresh === "true");

    const categoryMap = {
      earrings: "Orecchini",
      rings: "Anelli",
      necklaces: "Collane",
      bracelets: "Bracciali"
    };

    const requested = req.params.category;
    const label = categoryMap[requested];

    if (!label) {
      return res.status(404).send("Categoria non trovata");
    }

    const list = sortProducts(
      products.filter(p => p.category === requested),
      "price_asc"
    );

    res.setHeader("Content-Type", "text/plain; charset=utf-8");

    let md = `CATALOGO MAY MOMA - ${label.toUpperCase()}\n`;
    md += `TOTALE PRODOTTI ${label.toUpperCase()}: ${list.length}\n\n`;
    md += `LISTA COMPLETA ${label.toUpperCase()} CON PREZZI:\n\n`;

    list.forEach((p, index) => {
      md += `${index + 1}. ${p.title} | ${formatPrice(p)} | ${p.available ? "disponibile" : "non disponibile"} | ${p.url}\n`;
    });

    md += `\nFINE LISTA COMPLETA ${label.toUpperCase()}. TOTALE: ${list.length} PRODOTTI.\n`;

    res.send(md);
  } catch (error) {
    res.status(500).send(`Errore generazione RAG categoria: ${error.message}`);
  }
});
app.post("/catalog", async (req, res) => {
  try {
    const products = await loadProducts(Boolean(req.body.refresh));
    const intent = req.body.intent || req.body.operation || "list";
    const filters = req.body || {};

    if (intent === "summary" || intent === "categories") {
      return res.json(summary(products));
    }

    if (intent === "product") {
      const product = products.find(
        p =>
          p.handle === req.body.handle ||
          normalizeText(p.title) === normalizeText(req.body.title)
      );

      return res.json({
        product: product || null
      });
    }

    const filtered = applyFilters(products, filters);

    if (intent === "cheapest") {
      const sorted = sortProducts(
        filtered.filter(p => Number.isFinite(p.price_min)),
        "price_asc"
      );

      return res.json({
        count: sorted.length,
        product: sorted[0] || null
      });
    }

    if (intent === "most_expensive" || intent === "most-expensive") {
      const sorted = sortProducts(
        filtered.filter(p => Number.isFinite(p.price_min)),
        "price_desc"
      );

      return res.json({
        count: sorted.length,
        product: sorted[0] || null
      });
    }

    if (intent === "compare") {
      const handles = Array.isArray(req.body.handles)
        ? req.body.handles
        : [];

      const selected = products.filter(p =>
        handles.includes(p.handle)
      );

      return res.json({
        count: selected.length,
        products: selected
      });
    }

    const sorted = sortProducts(filtered, req.body.sort || "price_asc");

    return res.json({
      count: sorted.length,
      products: limitProducts(sorted, req.body.limit)
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`May mOma middleware running on port ${PORT}`);
});
