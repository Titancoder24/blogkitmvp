/**
 * The MCP tool surface BlogKit exposes (PRD §9.3).
 *
 * Listed here as a const tuple so the rest of the package can derive the
 * `ToolName` union type, and so docs generation can introspect the surface
 * without parsing schemas.
 */
export const TOOL_NAMES = [
  // content
  "list_posts",
  "get_post",
  "create_post",
  "update_post",
  "publish_post",
  "schedule_post",
  "archive_post",
  "search_posts",
  "list_revisions",
  "restore_revision",

  // taxonomy
  "list_tags",
  "create_tag",
  "list_categories",
  "create_category",
  "list_authors",
  "create_author",

  // media
  "upload_media",
  "list_media",
  "set_alt_text",
  "delete_media",

  // SEO / artifacts
  "get_seo_report",
  "regenerate_artifacts",
  "validate_schema",
  "audit_site",

  // template introspection (v1)
  "list_templates",
  "get_template",
  "apply_template_to_post",

  // theme (v1)
  "list_themes",
  "get_active_theme",
  "set_theme",
  "customize_theme_palette",

  // tool authoring (v1.5 — PRD §19.2)
  "create_template",
  "update_template",
  "define_field",
  "define_block",
  "define_schema_mapping",
  "define_scoring_rule",
] as const;
