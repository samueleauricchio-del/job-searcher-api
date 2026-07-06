import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const SHOPIFY_PRODUCTS_URL = "https://maymoma.com/products.json";
const SHOPIFY_BASE_URL = "https://maymoma.com/products/";
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 5 * 60 * 1000);

let cache = {
  products: [],
  fetchedAt: 0,
};

function cleanHtml(html = "") {
  return String(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value = "") {
  return String(value).toLowerCase().trim();
}

function detectCategory(product) {
  const text = normalizeText([
    product.title,
    product.handle,
    product.product_type,
    ...(product.tags || []),
  ].join(" "));

  if (text.includes("earring") || text.includes("earrings") || text.includes("orecchin") || text.includes("earcuff") || text.includes("hoop")) return "earrings";
  if (text.includes("ring") || text.includes("anello") || text.includes("anelli")) return "rings";
  if (text.includes("necklace") || text.includes("collana") || text.includes("choker") || text.includes("chocker")) return "necklaces";
  if (text.includes("bracelet") || text.includes("bracciale") || text.includes("bracciali")) return "bracelets";
  return "other";
}

function parseProduct(product) {
  const variants = (product.variants || []).map(v => ({
    id: v.id,
    title: v.title,
    option1: v.option1,
    option2: v.option2,
    option3: v.option3,
    price: v.price ? Number(v.price) : null,
    available: Boolean(v.available),
  }));

  const prices = variants.map(v => v.price).filter(v => typeof v === "number" && !Number.isNaN(v));

  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    url: `${SHOPIFY_BASE_URL}${product.handle}`,
    vendor: product.vendor,
    product_type: product.product_type || "",
    category: detectCategory(product),
    tags: product.tags || [],
    description: cleanHtml(product.body_html || ""),
    price_min: prices.length ? Math.min(...prices) : null,
    price_max: prices.length ? Math.max(...prices) : null,
    available: variants.some(v => v.available),
    variants,
    images: (product.images || []).map(img => img.src).filter(Boolean),
    updated_at: product.updated_at,
  };
}

async function fetchPage(page) {
  const url = `${SHOPIFY_PRODUCTS_URL}?limit=250&page=${page}`;
  const res = await fetch(url, { headers: { "accept": "application/json" } });
  if (!res.ok) throw new Error(`Shopify error ${res.status}`);
  const data = await res.json();
  return data.products || [];
}

async function getCatalog(force = false) {
  const fresh = Date.now() - cache.fetchedAt < CACHE_TTL_MS;
  if (!force && fresh && cache.products.length) return cache.products;

  const all = [];
  let page = 1;

  while (true) {
    const products = await fetchPage(page);
    if (!products.length) break;
    all.push(...products);
    if (products.length < 250) break;
    page += 1;
  }

  cache = {
    products: all.map(parseProduct),
    fetchedAt: Date.now(),
  };

  return cache.products;
}

function matchesCategory(product, category) {
  if (!category || category === "all") return true;
  const c = normalizeText(category);
  const aliases = {
    earrings: ["earrings", "earring", "orecchini", "orecchino"],
    rings: ["rings", "ring", "anelli", "anello"],
    necklaces: ["necklaces", "necklace", "collane", "collana", "choker", "chocker"],
    bracelets: ["bracelets", "bracelet", "bracciali", "bracciale"],
    other: ["other", "altro", "altri"],
  };
  const canonical = Object.entries(aliases).find(([, vals]) => vals.includes(c))?.[0] || c;
  return product.category === canonical;
}

function productSummary(product) {
  return {
    title: product.title,
    category: product.category,
    price_min: product.price_min,
    price_max: product.price_max,
    available: product.available,
    url: product.url,
    variants: product.variants,
    description: product.description,
    images: product.images,
  };
}

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/products", async (req, res) => {
  try {
    const { category, q, available, sort = "price_asc" } = req.query;
    let products = await getCatalog(req.query.refresh === "true");

    products = products.filter(p => matchesCategory(p, category));

    if (q) {
      const query = normalizeText(q);
      products = products.filter(p => normalizeText(`${p.title} ${p.handle} ${p.description} ${p.tags.join(" ")}`).includes(query));
    }

    if (available === "true") products = products.filter(p => p.available);
    if (available === "false") products = products.filter(p => !p.available);

    products.sort((a, b) => {
      if (sort === "price_desc") return (b.price_min ?? Infinity) - (a.price_min ?? Infinity);
      if (sort === "title") return a.title.localeCompare(b.title);
      return (a.price_min ?? Infinity) - (b.price_min ?? Infinity);
    });

    res.json({ count: products.length, products: products.map(productSummary) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/cheapest", async (req, res) => {
  try {
    const { category } = req.query;
    const products = (await getCatalog()).filter(p => matchesCategory(p, category) && p.price_min !== null);
    products.sort((a, b) => a.price_min - b.price_min);
    res.json({ category: category || "all", product: products[0] ? productSummary(products[0]) : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/product/:handle", async (req, res) => {
  try {
    const products = await getCatalog();
    const product = products.find(p => p.handle === req.params.handle);
    if (!product) return res.status(404).json({ error: "Product not found" });
    res.json(productSummary(product));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/catalog", async (req, res) => {
  try {
    const { intent, category, q, available, sort } = req.body || {};

    if (intent === "cheapest") {
      const products = (await getCatalog()).filter(p => matchesCategory(p, category) && p.price_min !== null);
      products.sort((a, b) => a.price_min - b.price_min);
      return res.json({ intent, category, product: products[0] ? productSummary(products[0]) : null });
    }

    let products = await getCatalog();
    products = products.filter(p => matchesCategory(p, category));

    if (q) {
      const query = normalizeText(q);
      products = products.filter(p => normalizeText(`${p.title} ${p.handle} ${p.description} ${p.tags.join(" ")}`).includes(query));
    }

    if (available === true) products = products.filter(p => p.available);
    if (available === false) products = products.filter(p => !p.available);

    products.sort((a, b) => {
      if (sort === "price_desc") return (b.price_min ?? Infinity) - (a.price_min ?? Infinity);
      if (sort === "title") return a.title.localeCompare(b.title);
      return (a.price_min ?? Infinity) - (b.price_min ?? Infinity);
    });

    return res.json({ intent: intent || "list", category: category || "all", count: products.length, products: products.map(productSummary) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Maymoma middleware running on port ${port}`));
