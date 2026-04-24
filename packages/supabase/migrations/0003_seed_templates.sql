-- BlogKit — seed the 12 built-in templates (PRD §5D.2).
--
-- This migration only inserts the template rows so existing posts can
-- reference them via `posts.template_id`. The matching React rendering
-- components live under `@blogkit/templates/<id>` and the editor block
-- palettes / scoring rubrics are wired in later weeks of §12.

INSERT INTO blogkit_templates
  (id, name, description, is_built_in, fields, blocks, schema_mapping, scoring_rules)
VALUES
  ('article',     'Article',
   'Standard long-form blog post.',
   true, '[]'::jsonb, '[]'::jsonb,
   '{"type":"BlogPosting"}'::jsonb,
   '{"weights":{"seo":1,"aeo":1,"geo":1,"aio":1,"llmo":1,"agentSeo":1}}'::jsonb),

  ('listicle',    'Listicle',
   'Numbered, ranked, or unranked list of items.',
   true, '[]'::jsonb, '[]'::jsonb,
   '{"type":"ItemList","wrapper":"BlogPosting"}'::jsonb,
   '{"weights":{"seo":1,"aeo":1,"geo":1.5,"aio":1,"llmo":1,"agentSeo":1},"requires":{"minItems":5,"introHook":true}}'::jsonb),

  ('comparison',  'Comparison',
   'Side-by-side comparison of two or more things.',
   true, '[]'::jsonb, '[]'::jsonb,
   '{"type":"Review","wrapper":"Article","perItem":["AggregateRating","Product"]}'::jsonb,
   '{"weights":{"seo":1,"aeo":1.2,"geo":1.3,"aio":1,"llmo":1,"agentSeo":1},"requires":{"verdict":true,"symmetricCriteria":true}}'::jsonb),

  ('review',      'Review',
   'Single-subject deep review with explicit rating, pros, cons, verdict.',
   true, '[]'::jsonb, '[]'::jsonb,
   '{"type":"Review","extras":["AggregateRating","Product"]}'::jsonb,
   '{"weights":{"seo":1,"aeo":1.1,"geo":1.3,"aio":1,"llmo":1,"agentSeo":1},"requires":{"rating":true,"verdict":true,"methodology":true}}'::jsonb),

  ('glossary',    'Glossary',
   'Term-definition entry. Dominates "what is X" AI Overview queries.',
   true, '[]'::jsonb, '[]'::jsonb,
   '{"type":"DefinedTerm","collection":"DefinedTermSet"}'::jsonb,
   '{"weights":{"seo":1,"aeo":1.5,"geo":1,"aio":2,"llmo":1.2,"agentSeo":1.2},"requires":{"definitionLead":true,"shortAnswerMaxWords":50}}'::jsonb),

  ('how-to',      'How-To',
   'Step-by-step instructions. Dominates voice search and ChatGPT how-do-I queries.',
   true, '[]'::jsonb, '[]'::jsonb,
   '{"type":"HowTo","steps":"HowToStep","supplies":"HowToSupply"}'::jsonb,
   '{"weights":{"seo":1,"aeo":1.4,"geo":1.2,"aio":1.2,"llmo":1.2,"agentSeo":1.5},"requires":{"materials":true,"totalTime":true,"stepGranularity":true}}'::jsonb),

  ('recipe',      'Recipe',
   'Cooking recipe with ingredients, instructions, and nutrition.',
   true, '[]'::jsonb, '[]'::jsonb,
   '{"type":"Recipe","required":["recipeYield","recipeIngredient","recipeInstructions"]}'::jsonb,
   '{"weights":{"seo":1.2,"aeo":1.2,"geo":1,"aio":1.2,"llmo":1,"agentSeo":1},"requires":{"heroImage":true,"servingSize":true,"allRecipeFields":true}}'::jsonb),

  ('product',     'Product',
   'Single product showcase or commerce-style page.',
   true, '[]'::jsonb, '[]'::jsonb,
   '{"type":"Product","extras":["Offer","AggregateRating","Brand"]}'::jsonb,
   '{"weights":{"seo":1.2,"aeo":1,"geo":0.8,"aio":1.3,"llmo":1,"agentSeo":1.2},"requires":{"price":true,"availability":true,"gallery":true}}'::jsonb),

  ('faq-hub',     'FAQ Hub',
   'A page that is primarily a curated collection of FAQs around a topic.',
   true, '[]'::jsonb, '[]'::jsonb,
   '{"type":"FAQPage"}'::jsonb,
   '{"weights":{"seo":1,"aeo":1.6,"geo":1.1,"aio":1.2,"llmo":1.1,"agentSeo":1},"requires":{"minPairs":5,"maxAnswerWords":300}}'::jsonb),

  ('news',        'News',
   'Time-sensitive news article with dateline, byline, lede.',
   true, '[]'::jsonb, '[]'::jsonb,
   '{"type":"NewsArticle"}'::jsonb,
   '{"weights":{"seo":1.2,"aeo":1.1,"geo":1.3,"aio":1,"llmo":1.1,"agentSeo":1},"requires":{"dateline":true,"sourceAttribution":true},"freshness":{"downgradeAfterDays":7}}'::jsonb),

  ('case-study',  'Case Study',
   'Long-form B2B case study with concrete metrics and timeline.',
   true, '[]'::jsonb, '[]'::jsonb,
   '{"type":"Article","embedded":"Organization"}'::jsonb,
   '{"weights":{"seo":1,"aeo":1,"geo":1.4,"aio":1.1,"llmo":1,"agentSeo":1},"requires":{"metrics":true,"clientQuote":true,"timeline":true}}'::jsonb),

  ('landing',     'Landing Page',
   'Marketing page with a single conversion goal.',
   true, '[]'::jsonb, '[]'::jsonb,
   '{"type":"WebPage","extras":["Offer"]}'::jsonb,
   '{"weights":{"seo":1.2,"aeo":1,"geo":0.4,"aio":1,"llmo":1,"agentSeo":1},"requires":{"primaryCta":true}}'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  name           = EXCLUDED.name,
  description    = EXCLUDED.description,
  is_built_in    = true,
  schema_mapping = EXCLUDED.schema_mapping,
  scoring_rules  = EXCLUDED.scoring_rules,
  updated_at     = now();
