/**
 * Schema.org JSON-LD emitters (PRD §6.6).
 *
 * Every published post page emits a stack:
 *   - `BlogPosting` / `Article` / `NewsArticle` / `TechArticle` (template-
 *     driven; `Recipe`, `HowTo`, `Review`, etc. for non-article templates)
 *   - `BreadcrumbList`
 *   - `FAQPage` if FAQ items present
 *   - `Person` for the author
 *   - `Organization` for the publisher
 *   - `WebSite` with `SearchAction`
 *   - `ImageObject` for the hero image
 *
 * The functions here return plain JSON-LD objects. The renderer wraps them
 * in `<script type="application/ld+json">` tags. Keeping them as data lets
 * the MCP `validate_schema` tool (PRD §9.3) introspect and check them
 * without any DOM dependency.
 */
import type {
  Author,
  Citation,
  FAQItem,
  OrganizationConfig,
  Post,
  SchemaType,
  SiteConfig,
} from "@blogkit/core/types";
import { absoluteUrl, isoDate } from "./util.js";

export type JsonLd = Record<string, unknown>;

// ---------- BlogPosting / Article ----------
export interface BlogPostingInput {
  post: Post;
  author?: Author;
  site: SiteConfig;
  organization: OrganizationConfig;
  citations?: readonly Citation[];
  /** Optional explicit override of the schema type. */
  schemaType?: SchemaType | "Recipe" | "HowTo" | "Review" | "Product" | "WebPage";
}

export function blogPostingJsonLd(input: BlogPostingInput): JsonLd {
  const { post, author, site, organization, citations } = input;
  const url = absoluteUrl(site.url, postPath(post));
  const datePublished = isoDate(post.publishedAt ?? post.createdAt);
  const dateModified = isoDate(
    post.lastRefreshedAt ?? post.updatedAt ?? post.publishedAt ?? post.createdAt,
  );

  const schemaType = input.schemaType ?? post.schemaType;
  const data: JsonLd = {
    "@context": "https://schema.org",
    "@type": schemaType,
    "@id": `${url}#post`,
    headline: post.customMetaTitle ?? post.title,
    description:
      post.customMetaDescription ?? post.excerpt ?? post.tldr ?? undefined,
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    inLanguage: "en",
    isAccessibleForFree: true,
    datePublished,
    dateModified,
    wordCount: post.wordCount,
    image: post.coverImageUrl
      ? imageObjectJsonLd({ url: post.coverImageUrl })
      : undefined,
    publisher: organizationJsonLd({ site, organization, embedded: true }),
    author: author ? personJsonLd(author, { embedded: true }) : undefined,
  };

  if (citations && citations.length > 0) {
    data.citation = citations.map(citationJsonLd);
  }

  return prune(data);
}

// ---------- Recipe ----------
export interface RecipeInput {
  post: Post;
  site: SiteConfig;
  organization: OrganizationConfig;
  recipeYield?: string | number;
  prepTime?: string;
  cookTime?: string;
  totalTime?: string;
  ingredients?: readonly string[];
  instructions?: readonly string[];
  nutrition?: Record<string, string | number>;
}

export function recipeJsonLd(input: RecipeInput): JsonLd {
  const { post, site, organization } = input;
  const url = absoluteUrl(site.url, postPath(post));
  return prune({
    "@context": "https://schema.org",
    "@type": "Recipe",
    "@id": `${url}#recipe`,
    name: post.title,
    description: post.excerpt ?? post.tldr,
    image: post.coverImageUrl,
    url,
    datePublished: isoDate(post.publishedAt ?? post.createdAt),
    dateModified: isoDate(post.lastRefreshedAt ?? post.updatedAt),
    publisher: organizationJsonLd({ site, organization, embedded: true }),
    recipeYield: input.recipeYield,
    prepTime: input.prepTime,
    cookTime: input.cookTime,
    totalTime: input.totalTime,
    recipeIngredient: input.ingredients,
    recipeInstructions: input.instructions?.map((step, idx) => ({
      "@type": "HowToStep",
      position: idx + 1,
      text: step,
    })),
    nutrition: input.nutrition
      ? { "@type": "NutritionInformation", ...input.nutrition }
      : undefined,
  });
}

// ---------- HowTo ----------
export interface HowToStepInput {
  name: string;
  text: string;
  image?: string;
  /** ISO 8601 duration, e.g. `PT5M`. */
  timeRequired?: string;
}

export interface HowToInput {
  post: Post;
  site: SiteConfig;
  totalTime?: string;
  steps: readonly HowToStepInput[];
  supplies?: readonly string[];
  tools?: readonly string[];
}

export function howToJsonLd(input: HowToInput): JsonLd {
  const { post, site } = input;
  const url = absoluteUrl(site.url, postPath(post));
  return prune({
    "@context": "https://schema.org",
    "@type": "HowTo",
    "@id": `${url}#howto`,
    name: post.title,
    description: post.excerpt ?? post.tldr,
    image: post.coverImageUrl,
    totalTime: input.totalTime,
    supply: input.supplies?.map((s) => ({ "@type": "HowToSupply", name: s })),
    tool: input.tools?.map((t) => ({ "@type": "HowToTool", name: t })),
    step: input.steps.map((step, idx) => ({
      "@type": "HowToStep",
      position: idx + 1,
      name: step.name,
      text: step.text,
      image: step.image,
      timeRequired: step.timeRequired,
    })),
  });
}

// ---------- FAQPage ----------
export function faqPageJsonLd(items: readonly FAQItem[]): JsonLd | null {
  if (items.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

// ---------- BreadcrumbList ----------
export interface BreadcrumbCrumb {
  name: string;
  /** Path or absolute URL. */
  url: string;
}

export function breadcrumbListJsonLd(
  siteUrl: string,
  crumbs: readonly BreadcrumbCrumb[],
): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: c.name,
      item: absoluteUrl(siteUrl, c.url),
    })),
  };
}

// ---------- Person ----------
export function personJsonLd(
  author: Author,
  opts: { embedded?: boolean } = {},
): JsonLd {
  const data: JsonLd = {
    ...(opts.embedded ? {} : { "@context": "https://schema.org" }),
    "@type": "Person",
    name: author.name,
    description: author.bio,
    image: author.avatarUrl,
    url: author.website,
    sameAs: dedupeStrings([
      ...(author.sameAs ?? []),
      author.twitter,
      author.linkedin,
      author.github,
    ]),
  };
  return prune(data);
}

// ---------- Organization ----------
export interface OrganizationJsonLdInput {
  site: SiteConfig;
  organization: OrganizationConfig;
  embedded?: boolean;
}

export function organizationJsonLd(input: OrganizationJsonLdInput): JsonLd {
  const { site, organization, embedded } = input;
  return prune({
    ...(embedded ? {} : { "@context": "https://schema.org" }),
    "@type": "Organization",
    "@id": `${site.url.replace(/\/+$/, "")}#org`,
    name: organization.name,
    url: site.url,
    logo: organization.logoUrl
      ? imageObjectJsonLd({ url: organization.logoUrl })
      : undefined,
    sameAs: dedupeStrings(organization.sameAs),
  });
}

// ---------- WebSite ----------
export function webSiteJsonLd(site: SiteConfig): JsonLd {
  const base = site.url.replace(/\/+$/, "");
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${base}#website`,
    name: site.name,
    url: site.url,
    description: site.tagline,
    potentialAction: {
      "@type": "SearchAction",
      target: `${base}/blog?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

// ---------- ImageObject ----------
export function imageObjectJsonLd(input: {
  url: string;
  width?: number;
  height?: number;
  caption?: string;
}): JsonLd {
  return prune({
    "@type": "ImageObject",
    url: input.url,
    width: input.width,
    height: input.height,
    caption: input.caption,
  });
}

// ---------- Citation ----------
export function citationJsonLd(c: Citation): JsonLd {
  return prune({
    "@type": "CreativeWork",
    url: c.sourceUrl,
    name: c.sourceTitle,
    author: c.sourceAuthor ? { "@type": "Person", name: c.sourceAuthor } : undefined,
    datePublished: isoDate(c.sourcePublishedAt),
    abstract: c.excerpt,
  });
}

// ---------- DefinedTerm (Glossary template) ----------
export function definedTermJsonLd(input: {
  term: string;
  shortDefinition: string;
  longDefinition?: string;
  url: string;
  termSetName?: string;
  termSetUrl?: string;
}): JsonLd {
  return prune({
    "@context": "https://schema.org",
    "@type": "DefinedTerm",
    name: input.term,
    description: input.shortDefinition,
    url: input.url,
    inDefinedTermSet:
      input.termSetName && input.termSetUrl
        ? { "@type": "DefinedTermSet", name: input.termSetName, url: input.termSetUrl }
        : undefined,
  });
}

// ---------- ItemList (Listicle template) ----------
export function itemListJsonLd(input: {
  name: string;
  url: string;
  items: readonly { name: string; url?: string; description?: string }[];
}): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: input.name,
    url: input.url,
    itemListElement: input.items.map((item, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: item.name,
      url: item.url,
      description: item.description,
    })),
  };
}

// ---------- the full per-post stack ----------
export interface BuildPostStackInput {
  post: Post;
  author?: Author;
  citations?: readonly Citation[];
  site: SiteConfig;
  organization: OrganizationConfig;
  /** Optional override for the breadcrumb chain. */
  breadcrumbs?: readonly BreadcrumbCrumb[];
}

/**
 * Compose every JSON-LD block a published post emits. Returns an array
 * suitable for serializing into one `<script type="application/ld+json">`
 * each (per Schema.org guidance — multiple top-level objects are valid in
 * a JSON array, but separate scripts are easier for Google's parser).
 */
export function buildPostJsonLdStack(input: BuildPostStackInput): JsonLd[] {
  const stack: JsonLd[] = [];

  stack.push(blogPostingJsonLd(input));
  stack.push(webSiteJsonLd(input.site));
  stack.push(organizationJsonLd(input));

  const breadcrumbs = input.breadcrumbs ?? defaultBreadcrumbs(input.post);
  stack.push(breadcrumbListJsonLd(input.site.url, breadcrumbs));

  if (input.post.faqJson && input.post.faqJson.length > 0) {
    const faq = faqPageJsonLd(input.post.faqJson);
    if (faq) stack.push(faq);
  }

  return stack;
}

// ---------- helpers ----------
function postPath(post: Post): string {
  return `/blog/${post.slug}`;
}

function defaultBreadcrumbs(post: Post): BreadcrumbCrumb[] {
  return [
    { name: "Home", url: "/" },
    { name: "Blog", url: "/blog" },
    { name: post.title, url: `/blog/${post.slug}` },
  ];
}

function dedupeStrings(values: ReadonlyArray<string | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/** Drop undefined / empty-array / empty-string fields. Recursive. */
function prune(value: JsonLd): JsonLd {
  const out: JsonLd = {};
  for (const [key, v] of Object.entries(value)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.length === 0) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      out[key] = v;
      continue;
    }
    if (typeof v === "object") {
      const pruned = prune(v as JsonLd);
      if (Object.keys(pruned).length === 0) continue;
      out[key] = pruned;
      continue;
    }
    out[key] = v;
  }
  return out;
}
