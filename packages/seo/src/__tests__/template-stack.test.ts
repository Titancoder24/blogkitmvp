import type { OrganizationConfig, Post, SiteConfig, Template } from "@blogkit/core/types";
import { describe, expect, it } from "vitest";
import { buildTemplateJsonLdStack } from "../template-stack.js";

const SITE: SiteConfig = { name: "Acme", url: "https://acme.example" };
const ORG: OrganizationConfig = { name: "Acme Inc.", sameAs: [] };

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: "p",
    slug: "hello",
    title: "Hello",
    bodyMdx: "Hello.",
    status: "published",
    schemaType: "BlogPosting",
    templateId: "article",
    templateOverflow: {},
    noindex: false,
    citationCount: 0,
    isCornerstone: false,
    createdAt: "2026-04-20T00:00:00Z",
    updatedAt: "2026-04-20T00:00:00Z",
    ...overrides,
  } as Post;
}

function types(stack: Array<Record<string, unknown>>): string[] {
  return stack.map((s) => String(s["@type"]));
}

describe("buildTemplateJsonLdStack — per-template primary entity", () => {
  it("article emits BlogPosting first", () => {
    const stack = buildTemplateJsonLdStack({
      post: makePost({ templateId: "article" }),
      site: SITE,
      organization: ORG,
    });
    expect(types(stack)[0]).toBe("BlogPosting");
  });

  it("recipe emits Recipe primary with overflow fields", () => {
    const stack = buildTemplateJsonLdStack({
      post: makePost({
        templateId: "recipe",
        templateOverflow: {
          recipeYield: "4 servings",
          ingredients: ["1 cup flour", "2 eggs"],
          instructions: ["Mix.", "Bake."],
          totalTime: "PT45M",
        },
      }),
      site: SITE,
      organization: ORG,
    });
    expect(stack[0]?.["@type"]).toBe("Recipe");
    const recipe = stack[0] as Record<string, unknown>;
    expect(recipe.recipeIngredient).toEqual(["1 cup flour", "2 eggs"]);
    expect(Array.isArray(recipe.recipeInstructions)).toBe(true);
  });

  it("how-to emits HowTo with HowToStep array", () => {
    const stack = buildTemplateJsonLdStack({
      post: makePost({
        templateId: "how-to",
        templateOverflow: {
          totalTime: "PT15M",
          steps: [
            { name: "Step 1", text: "Do thing." },
            { name: "Step 2", text: "Do other thing." },
          ],
        },
      }),
      site: SITE,
      organization: ORG,
    });
    const howto = stack[0] as Record<string, unknown>;
    expect(howto["@type"]).toBe("HowTo");
    expect(Array.isArray(howto.step)).toBe(true);
    expect((howto.step as unknown[]).length).toBe(2);
  });

  it("glossary emits DefinedTerm primary", () => {
    const stack = buildTemplateJsonLdStack({
      post: makePost({
        templateId: "glossary",
        title: "AEO",
        tldr: "Answer Engine Optimization.",
      }),
      site: SITE,
      organization: ORG,
    });
    expect(stack[0]?.["@type"]).toBe("DefinedTerm");
    expect((stack[0] as Record<string, unknown>).description).toBe(
      "Answer Engine Optimization.",
    );
  });

  it("listicle emits ItemList plus the BlogPosting stack", () => {
    const stack = buildTemplateJsonLdStack({
      post: makePost({
        templateId: "listicle",
        templateOverflow: {
          items: [
            { name: "Vercel", url: "https://vercel.com" },
            { name: "Netlify", url: "https://netlify.com" },
          ],
        },
      }),
      site: SITE,
      organization: ORG,
    });
    const t = types(stack);
    expect(t[0]).toBe("ItemList");
    expect(t).toContain("BlogPosting");
  });

  it("product emits Product with Offer when price is set", () => {
    const stack = buildTemplateJsonLdStack({
      post: makePost({
        templateId: "product",
        templateOverflow: {
          productName: "Widget",
          price: 49,
          currency: "USD",
          availability: "InStock",
        },
      }),
      site: SITE,
      organization: ORG,
    });
    const product = stack[0] as Record<string, unknown>;
    expect(product["@type"]).toBe("Product");
    const offers = product.offers as Record<string, unknown>;
    expect(offers["@type"]).toBe("Offer");
    expect(offers.price).toBe(49);
  });

  it("review emits Review with rating", () => {
    const stack = buildTemplateJsonLdStack({
      post: makePost({
        templateId: "review",
        templateOverflow: {
          subjectName: "Acme Widget",
          rating: 4.5,
          ratingMax: 5,
        },
      }),
      site: SITE,
      organization: ORG,
    });
    const review = stack[0] as Record<string, unknown>;
    expect(review["@type"]).toBe("Review");
    const rating = review.reviewRating as Record<string, unknown>;
    expect(rating.ratingValue).toBe(4.5);
  });

  it("faq-hub emits FAQPage as primary", () => {
    const stack = buildTemplateJsonLdStack({
      post: makePost({
        templateId: "faq-hub",
        faqJson: [{ question: "Q?", answer: "A." }],
      }),
      site: SITE,
      organization: ORG,
    });
    expect(stack[0]?.["@type"]).toBe("FAQPage");
  });

  it("news emits NewsArticle and copies dateline from overflow", () => {
    const stack = buildTemplateJsonLdStack({
      post: makePost({
        templateId: "news",
        templateOverflow: { dateline: "April 25 — San Francisco" },
      }),
      site: SITE,
      organization: ORG,
    });
    const article = stack[0] as Record<string, unknown>;
    expect(article["@type"]).toBe("NewsArticle");
    expect(article.dateline).toBe("April 25 — San Francisco");
  });

  it("landing emits WebPage primary", () => {
    const stack = buildTemplateJsonLdStack({
      post: makePost({ templateId: "landing" }),
      site: SITE,
      organization: ORG,
    });
    expect(stack[0]?.["@type"]).toBe("WebPage");
  });
});

describe("buildTemplateJsonLdStack — custom templates", () => {
  it("uses the template's schema_mapping.type when set", () => {
    const template = {
      id: "podcast-episode",
      name: "Podcast Episode",
      isBuiltIn: false,
      fields: [],
      blocks: [],
      schemaMapping: { type: "PodcastEpisode" },
      scoringRules: {},
      createdAt: "x",
      updatedAt: "x",
    } as Template;
    const stack = buildTemplateJsonLdStack({
      post: makePost({ templateId: "podcast-episode" }),
      template,
      site: SITE,
      organization: ORG,
    });
    expect(types(stack)).toContain("PodcastEpisode");
  });
});
