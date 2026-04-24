/**
 * `@blogkit/editor` — block-based MDX editor with live preview.
 *
 * Implementation lands in weeks 5–6 of §12. The shape it will export:
 *
 *   - <BlogKitEditor>         the three-column resume-builder layout
 *   - <BlockSurface>          the writing surface
 *   - <LivePreview>           pixel-accurate preview of the rendered post
 *   - <ScoringPanel>          live six-discipline AI Visibility scoring
 *   - <TopToolbar>            theme picker, palette controls, publish gate
 *   - <RevisionSlider>        version history scrub (PRD §5A.5)
 *   - <ViewAsToggle>          Visitor | Googlebot | ChatGPT preview modes
 *
 * Block primitives: paragraph, heading, image, callout, code, citation,
 * faq, tldr, statistic, quote, listicle-item, comparison-row.
 */
export type EditorBlockKind =
  | "paragraph"
  | "heading"
  | "image"
  | "callout"
  | "code"
  | "citation"
  | "faq"
  | "tldr"
  | "statistic"
  | "quote"
  | "listicle-item"
  | "comparison-row";
