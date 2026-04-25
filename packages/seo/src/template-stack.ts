/**
 * Template-aware JSON-LD orchestrator (PRD §5D.4, §6.6).
 *
 * `buildPostJsonLdStack` in `./jsonld.ts` is generic — it always emits
 * `BlogPosting + WebSite + Organization + Breadcrumb + (FAQ?)`. That's
 * the right stack for the Article template, but a Recipe wants a
 * `Recipe` block as the primary schema, a Glossary entry wants a
 * `DefinedTerm`, a Listicle wants `ItemList`, and so on.
 *
 * `buildTemplateJsonLdStack` reads the active template id and produces
 * the discipline-correct stack:
 *
 *   article      → BlogPosting    + WebSite + Org + Breadcrumb (+ FAQ)
 *   listicle     → ItemList       + BlogPosting + WebSite + Org + Breadcrumb (+ FAQ)
 *   comparison   → BlogPosting    + Review[]    + WebSite + Org + Breadcrumb
 *   review       → Review         + Product?    + WebSite + Org + Breadcrumb
 *   glossary     → DefinedTerm    + WebSite + Org + Breadcrumb
 *   how-to       → HowTo          + WebSite + Org + Breadcrumb
 *   recipe       → Recipe         + WebSite + Org + Breadcrumb
 *   product      → Product        + Offer       + WebSite + Org + Breadcrumb
 *   faq-hub      → FAQPage        + WebSite + Org + Breadcrumb
 *   news         → NewsArticle    + WebSite + Org + Breadcrumb
 *   case-study   → Article + Org  + WebSite + Breadcrumb
 *   landing      → WebPage        + Offer? + WebSite + Org + Breadcrumb
 *
 * Custom templates fall through to the generic BlogPosting stack unless
 * they declare `schema_mapping.type` in the template row, in which case
 * we honor that.
 *
 * Template-specific structured data lives in `post.template_overflow`
 * — that's where the editor stashes ingredient lists, comparison rows,
 * step lists, ratings, etc. The orchestrator reads that JSON column and
 * passes the relevant fields into the per-schema helpers.
 */
import type {
  Author,
  Citation,
  OrganizationConfig,
  Post,
  SiteConfig,
  Template,
} from "@blogkit/core/types";
import {
  blogPostingJsonLd,
  breadcrumbListJsonLd,
  buildPostJsonLdStack,
  citationJsonLd,
  definedTermJsonLd,
  faqPageJsonLd,
  howToJsonLd,
  imageObjectJsonLd,
  itemListJsonLd,
  organizationJsonLd,
  recipeJsonLd,
  webSiteJsonLd,
  type BreadcrumbCrumb,
  type JsonLd,
} from "./jsonld.js";
import { absoluteUrl, isoDate } from "./util.js";

export interface BuildTemplateStackInput {
  post: Post;
  /** The resolved template row; `undefined` falls back to the generic stack. */
  template?: Template;
  author?: Author;
  citations?: readonly Citation[];
  site: SiteConfig;
  organization: OrganizationConfig;
  breadcrumbs?: readonly BreadcrumbCrumb[];
}

export function buildTemplateJsonLdStack(input: BuildTemplateStackInput): JsonLd[] {
  const tid = input.post.templateId;

  // Templates that completely replace the BlogPosting primary entity.
  if (tid === "recipe") return recipeStack(input);
  if (tid === "how-to") return howToStack(input);
  if (tid === "glossary") return glossaryStack(input);
  if (tid === "review") return reviewStack(input);
  if (tid === "comparison") return comparisonStack(input);
  if (tid === "product") return productStack(input);
  if (tid === "faq-hub") return faqHubStack(input);
  if (tid === "news") return newsStack(input);
  if (tid === "case-study") return caseStudyStack(input);
  if (tid === "landing") return landingStack(input);

  // Listicle augments the generic BlogPosting stack with an ItemList.
  if (tid === "listicle") return listicleStack(input);

  // Article and unknown custom templates: generic BlogPosting stack.
  // Custom templates with a declared schema_mapping.type get one extra
  // entity emitted with that type.
  const generic = buildPostJsonLdStack(input);
  const customType = readSchemaType(input.template);
  if (customType && customType !== "BlogPosting") {
    generic.unshift(customEntity(input, customType));
  }
  return generic;
}

// ---------- per-template stacks ----------
function listicleStack(input: BuildTemplateStackInput): JsonLd[] {
  const items = readListItems(input.post);
  const url = absoluteUrl(input.site.url, `/blog/${input.post.slug}`);
  const stack = buildPostJsonLdStack(input);
  if (items.length > 0) {
    stack.unshift(
      itemListJsonLd({
        name: input.post.title,
        url,
        items: items.map((item) => ({
          name: item.name,
          url: item.url,
          description: item.description,
        })),
      }),
    );
  }
  return stack;
}

function recipeStack(input: BuildTemplateStackInput): JsonLd[] {
  const overflow = (input.post.templateOverflow ?? {}) as Record<string, unknown>;
  return base(input, [
    recipeJsonLd({
      post: input.post,
      site: input.site,
      organization: input.organization,
      recipeYield: overflow.recipeYield as string | number | undefined,
      prepTime: overflow.prepTime as string | undefined,
      cookTime: overflow.cookTime as string | undefined,
      totalTime: overflow.totalTime as string | undefined,
      ingredients: overflow.ingredients as string[] | undefined,
      instructions: overflow.instructions as string[] | undefined,
      nutrition: overflow.nutrition as Record<string, string | number> | undefined,
    }),
  ]);
}

function howToStack(input: BuildTemplateStackInput): JsonLd[] {
  const overflow = (input.post.templateOverflow ?? {}) as Record<string, unknown>;
  const steps = (overflow.steps as Array<{
    name: string;
    text: string;
    image?: string;
    timeRequired?: string;
  }>) ?? [];
  return base(input, [
    howToJsonLd({
      post: input.post,
      site: input.site,
      totalTime: overflow.totalTime as string | undefined,
      steps,
      supplies: overflow.supplies as string[] | undefined,
      tools: overflow.tools as string[] | undefined,
    }),
  ]);
}

function glossaryStack(input: BuildTemplateStackInput): JsonLd[] {
  const url = absoluteUrl(input.site.url, `/blog/${input.post.slug}`);
  const overflow = (input.post.templateOverflow ?? {}) as Record<string, unknown>;
  const shortDefinition =
    (overflow.shortDefinition as string | undefined) ??
    input.post.tldr ??
    input.post.excerpt ??
    "";
  return base(input, [
    definedTermJsonLd({
      term: input.post.title,
      shortDefinition,
      longDefinition: overflow.longDefinition as string | undefined,
      url,
      termSetName: overflow.termSetName as string | undefined,
      termSetUrl: overflow.termSetUrl as string | undefined,
    }),
  ]);
}

function reviewStack(input: BuildTemplateStackInput): JsonLd[] {
  const overflow = (input.post.templateOverflow ?? {}) as Record<string, unknown>;
  const subjectName = (overflow.subjectName as string | undefined) ?? input.post.title;
  const rating = overflow.rating as number | undefined;
  const ratingMax = (overflow.ratingMax as number | undefined) ?? 5;
  const review: JsonLd = pruneObj({
    "@context": "https://schema.org",
    "@type": "Review",
    itemReviewed: {
      "@type": (overflow.subjectType as string | undefined) ?? "Product",
      name: subjectName,
    },
    author: input.author ? { "@type": "Person", name: input.author.name } : undefined,
    reviewRating:
      rating !== undefined
        ? {
            "@type": "Rating",
            ratingValue: rating,
            bestRating: ratingMax,
          }
        : undefined,
    reviewBody: input.post.tldr ?? input.post.excerpt,
    datePublished: isoDate(input.post.publishedAt),
    publisher: organizationJsonLd({
      site: input.site,
      organization: input.organization,
      embedded: true,
    }),
  });
  return base(input, [review, ...(input.citations ? [] : [])]);
}

function comparisonStack(input: BuildTemplateStackInput): JsonLd[] {
  const overflow = (input.post.templateOverflow ?? {}) as Record<string, unknown>;
  const items = (overflow.items as Array<{
    name: string;
    rating?: number;
    pros?: string[];
    cons?: string[];
  }>) ?? [];
  const reviews: JsonLd[] = items.map((item) =>
    pruneObj({
      "@type": "Review",
      itemReviewed: { "@type": "Product", name: item.name },
      reviewRating:
        item.rating !== undefined
          ? { "@type": "Rating", ratingValue: item.rating, bestRating: 5 }
          : undefined,
      positiveNotes:
        item.pros && item.pros.length > 0
          ? { "@type": "ItemList", itemListElement: item.pros }
          : undefined,
      negativeNotes:
        item.cons && item.cons.length > 0
          ? { "@type": "ItemList", itemListElement: item.cons }
          : undefined,
    }),
  );
  const article = blogPostingJsonLd(input);
  const stack: JsonLd[] = [article];
  if (reviews.length > 0) stack.push(...reviews);
  return appendBaseTail(input, stack);
}

function productStack(input: BuildTemplateStackInput): JsonLd[] {
  const overflow = (input.post.templateOverflow ?? {}) as Record<string, unknown>;
  const product: JsonLd = pruneObj({
    "@context": "https://schema.org",
    "@type": "Product",
    name: (overflow.productName as string | undefined) ?? input.post.title,
    description: input.post.excerpt ?? input.post.tldr,
    image: input.post.coverImageUrl,
    brand: overflow.brand
      ? { "@type": "Brand", name: overflow.brand as string }
      : undefined,
    offers:
      overflow.price !== undefined
        ? {
            "@type": "Offer",
            price: overflow.price,
            priceCurrency: (overflow.currency as string | undefined) ?? "USD",
            availability:
              `https://schema.org/${(overflow.availability as string | undefined) ?? "InStock"}`,
            url: absoluteUrl(input.site.url, `/blog/${input.post.slug}`),
          }
        : undefined,
    aggregateRating:
      overflow.aggregateRating
        ? { "@type": "AggregateRating", ...(overflow.aggregateRating as object) }
        : undefined,
  });
  return base(input, [product]);
}

function faqHubStack(input: BuildTemplateStackInput): JsonLd[] {
  const faqs = input.post.faqJson ?? [];
  const faq = faqPageJsonLd(faqs);
  const stack: JsonLd[] = [];
  if (faq) stack.push({ "@context": "https://schema.org", ...faq });
  return appendBaseTail(input, stack);
}

function newsStack(input: BuildTemplateStackInput): JsonLd[] {
  const overflow = (input.post.templateOverflow ?? {}) as Record<string, unknown>;
  // NewsArticle is just BlogPosting with a different @type plus dateline.
  const news = blogPostingJsonLd({ ...input, schemaType: "NewsArticle" });
  if (overflow.dateline) {
    (news as Record<string, unknown>).dateline = overflow.dateline;
  }
  if (overflow.printSection) {
    (news as Record<string, unknown>).printSection = overflow.printSection;
  }
  const stack: JsonLd[] = [news];
  return appendBaseTail(input, stack);
}

function caseStudyStack(input: BuildTemplateStackInput): JsonLd[] {
  const overflow = (input.post.templateOverflow ?? {}) as Record<string, unknown>;
  const article = blogPostingJsonLd({ ...input, schemaType: "Article" });
  const stack: JsonLd[] = [article];
  if (overflow.client) {
    stack.push({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: overflow.client as string,
      url: overflow.clientUrl as string | undefined,
    });
  }
  return appendBaseTail(input, stack);
}

function landingStack(input: BuildTemplateStackInput): JsonLd[] {
  const overflow = (input.post.templateOverflow ?? {}) as Record<string, unknown>;
  const url = absoluteUrl(input.site.url, `/blog/${input.post.slug}`);
  const page: JsonLd = pruneObj({
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: input.post.title,
    description: input.post.excerpt ?? input.post.tldr,
    url,
    primaryImageOfPage: input.post.coverImageUrl
      ? imageObjectJsonLd({ url: input.post.coverImageUrl })
      : undefined,
    offers:
      overflow.offer !== undefined
        ? { "@type": "Offer", ...(overflow.offer as object) }
        : undefined,
  });
  return base(input, [page]);
}

// ---------- shared helpers ----------
function base(input: BuildTemplateStackInput, head: JsonLd[]): JsonLd[] {
  const tail: JsonLd[] = [
    webSiteJsonLd(input.site),
    organizationJsonLd(input),
    breadcrumbListJsonLd(input.site.url, input.breadcrumbs ?? defaultCrumbs(input.post)),
  ];
  return [...head, ...tail];
}

function appendBaseTail(
  input: BuildTemplateStackInput,
  stack: JsonLd[],
): JsonLd[] {
  return [
    ...stack,
    webSiteJsonLd(input.site),
    organizationJsonLd(input),
    breadcrumbListJsonLd(input.site.url, input.breadcrumbs ?? defaultCrumbs(input.post)),
  ];
}

function defaultCrumbs(post: Post): BreadcrumbCrumb[] {
  return [
    { name: "Home", url: "/" },
    { name: "Blog", url: "/blog" },
    { name: post.title, url: `/blog/${post.slug}` },
  ];
}

function readSchemaType(template?: Template): string | undefined {
  if (!template) return undefined;
  const mapping = template.schemaMapping as Record<string, unknown> | undefined;
  return typeof mapping?.type === "string" ? mapping.type : undefined;
}

function customEntity(
  input: BuildTemplateStackInput,
  type: string,
): JsonLd {
  return pruneObj({
    "@context": "https://schema.org",
    "@type": type,
    name: input.post.title,
    description: input.post.excerpt ?? input.post.tldr,
    url: absoluteUrl(input.site.url, `/blog/${input.post.slug}`),
    image: input.post.coverImageUrl,
  });
}

interface ListItem {
  name: string;
  url?: string;
  description?: string;
}

function readListItems(post: Post): ListItem[] {
  const items = (post.templateOverflow as Record<string, unknown> | undefined)?.items;
  if (!Array.isArray(items)) return [];
  return items
    .filter((it): it is Record<string, unknown> => typeof it === "object" && it !== null)
    .map((it) => ({
      name: String(it.name ?? it.title ?? ""),
      url: typeof it.url === "string" ? it.url : undefined,
      description: typeof it.description === "string" ? it.description : undefined,
    }))
    .filter((it) => it.name.length > 0);
}

function pruneObj(value: JsonLd): JsonLd {
  const out: JsonLd = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.length === 0) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

// `citationJsonLd` is re-exported here so consumers building custom
// stacks can compose without reaching into `./jsonld`.
export { citationJsonLd };
