import { describe, expect, it } from "vitest";
import {
  definitionLeadPlaceholder,
  evaluateDefinitionLead,
  suggestDefinitionLead,
} from "../definition-lead.js";

describe("evaluateDefinitionLead", () => {
  it("passes a canonical Definition-Lead opener", () => {
    const result = evaluateDefinitionLead(
      "BlogKit is a CMS that auto-emits every SEO artifact by default.",
    );
    expect(result.passes).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.suggestion).toBeNull();
  });

  it("flags an empty body and offers the placeholder", () => {
    const result = evaluateDefinitionLead("");
    expect(result.passes).toBe(false);
    expect(result.reason).toBe("empty");
    expect(result.suggestion).toBe(definitionLeadPlaceholder());
  });

  it("flags openings without a copula", () => {
    const result = evaluateDefinitionLead("We launched BlogKit today.");
    expect(result.passes).toBe(false);
    expect(result.reason).toBe("no-copula");
  });

  it("flags openings that are too long", () => {
    const long = `${Array.from({ length: 35 }).fill("word").join(" ")}.`;
    const result = evaluateDefinitionLead(long);
    expect(result.passes).toBe(false);
    expect(result.reason).toBe("too-long");
  });

  it("strips frontmatter and code fences before evaluation", () => {
    const body = `---
title: Hello
---

\`\`\`bash
echo not the lead
\`\`\`

BlogKit is a content platform that ships SEO-by-default.`;
    const result = evaluateDefinitionLead(body);
    expect(result.passes).toBe(true);
  });
});

describe("suggestDefinitionLead", () => {
  it("returns null for empty input", () => {
    expect(suggestDefinitionLead("")).toBeNull();
  });

  it("rewrites a non-conforming opener into the canonical pattern", () => {
    const out = suggestDefinitionLead("BlogKit auto-emits SEO artifacts.");
    expect(out).toBe("BlogKit is a [category] that auto-emits SEO artifacts.");
  });

  it("uses an explicit topic when provided", () => {
    const out = suggestDefinitionLead("auto-emits SEO artifacts.", "BlogKit");
    expect(out).toBe("BlogKit is a [category] that auto-emits SEO artifacts.");
  });
});
