/**
 * C2PA-compatible content provenance manifests.
 *
 * The C2PA spec (Content Authenticity Initiative — Adobe, OpenAI,
 * Microsoft, BBC, Sony, Apple-aligned) lets publishers attach a
 * cryptographically signed manifest to content asserting:
 *   - who created it
 *   - when, with what tools, and through what edits
 *   - who signed it
 *
 * AI engines and content authenticators (Adobe Verify, Truepic, OpenAI's
 * DALL-E watermark verifier) read these to gauge authenticity, which
 * affects citation likelihood for textual content the same way it
 * affects display likelihood for images.
 *
 * v1 ships:
 *   - `buildProvenanceManifest(post, ctx)` — builds the structured
 *     manifest (no signing).
 *   - `Signer` interface — implementations (Ed25519 via WebCrypto,
 *     KMS-backed, hardware-token) plug in here.
 *   - `Ed25519Signer` — built-in signer using WebCrypto's Ed25519 key.
 *   - `signManifest(manifest, signer)` — produces the detached
 *     signature persisted in `blogkit_provenance_manifests`.
 *
 * The renderer embeds the signed manifest in:
 *   - JSON-LD `creditText` and `digitalSignature` fields,
 *   - a `<meta name="c2pa-manifest" content="…">` tag,
 *   - an HTTP Link header pointing at `/posts/<slug>/provenance.json`.
 */
import type { Author, Post } from "@blogkit/core/types";

export interface ProvenanceContext {
  /** The author who published the post (signed claim about authorship). */
  author?: Pick<Author, "name" | "website" | "sameAs"> | null;
  /** Tool string the editor reports — e.g. "BlogKit/0.1.0 + ChatGPT-5 (assisted)". */
  productionTool: string;
  /** Site domain, used as the issuer field. */
  siteDomain: string;
  /** Public URL of the post, included in the manifest as the canonical URI. */
  postUrl: string;
}

/**
 * The structured manifest. Mirrors the shape of a C2PA `claim` record
 * minus the binary CBOR encoding — we ship it as JSON for simplicity
 * and because text content doesn't have the C2PA binary container that
 * images and videos use. AI engines that consume our `creditText`
 * field don't require CBOR.
 */
export interface ProvenanceManifest {
  /** C2PA `claim_generator` field — semver-ish identifier of the tool. */
  claim_generator: string;
  /** ISO 8601 timestamp this manifest was generated. */
  signed_at: string;
  /** Algorithm identifier. v1 uses Ed25519. */
  algorithm: "ed25519";
  /** Stable id of the signing key (for rotation). */
  key_id: string;
  /** SHA-256 of the canonical post body at signing time. */
  body_hash: string;
  /** Canonical URL of the asset. */
  asset_url: string;
  /** The publisher / domain. */
  issuer: string;
  /** Set of structured assertions. */
  assertions: ProvenanceAssertion[];
}

export type ProvenanceAssertion =
  | {
      label: "stds.schema-org.CreativeWork";
      data: { author?: { name: string; url?: string }; datePublished?: string };
    }
  | {
      label: "c2pa.actions";
      data: { actions: ProvenanceAction[] };
    }
  | {
      label: "c2pa.training-mining";
      data: { entries: TrainingEntry[] };
    };

export interface ProvenanceAction {
  /** "c2pa.created" | "c2pa.edited" | "c2pa.published" */
  action: string;
  when: string;
  softwareAgent?: string;
  /** Optional human actor. */
  actor?: { name: string; url?: string };
}

export interface TrainingEntry {
  /** Whether AI training is permitted on this content. */
  use:
    | "allowed"
    | "constrained"
    | "data_mining"
    | "ai_inference"
    | "ai_training"
    | "ai_generative_training"
    | "notTrainable";
  constraint_info?: string;
}

export interface BuildProvenanceManifestInput {
  post: Pick<
    Post,
    "publishedAt" | "lastRefreshedAt" | "createdAt" | "updatedAt" | "bodyMdx"
  >;
  ctx: ProvenanceContext;
  /** Whose hash is used. Defaults to a SHA-256 of `post.bodyMdx`. */
  bodyHash?: string;
  /** Key id placeholder; the signer fills the real id. */
  keyId?: string;
  /**
   * Training-data permissions to assert. Default declares allowed for
   * non-generative AI search but disallowed for generative training,
   * matching the most common publisher stance in 2026.
   */
  training?: readonly TrainingEntry[];
}

export async function buildProvenanceManifest(
  input: BuildProvenanceManifestInput,
): Promise<ProvenanceManifest> {
  const bodyHash = input.bodyHash ?? (await sha256Hex(input.post.bodyMdx));
  const training =
    input.training ??
    ([
      { use: "ai_inference" },
      { use: "ai_generative_training", constraint_info: "Disallowed by publisher." },
    ] as const);

  const actions: ProvenanceAction[] = [
    {
      action: "c2pa.created",
      when: input.post.createdAt,
      softwareAgent: input.ctx.productionTool,
      actor: input.ctx.author
        ? { name: input.ctx.author.name, url: input.ctx.author.website }
        : undefined,
    },
  ];
  if (
    input.post.publishedAt &&
    input.post.publishedAt !== input.post.createdAt
  ) {
    actions.push({
      action: "c2pa.published",
      when: input.post.publishedAt,
      softwareAgent: input.ctx.productionTool,
    });
  }
  if (input.post.lastRefreshedAt) {
    actions.push({
      action: "c2pa.edited",
      when: input.post.lastRefreshedAt,
      softwareAgent: input.ctx.productionTool,
    });
  }

  return {
    claim_generator: input.ctx.productionTool,
    signed_at: new Date().toISOString(),
    algorithm: "ed25519",
    key_id: input.keyId ?? "default",
    body_hash: bodyHash,
    asset_url: input.ctx.postUrl,
    issuer: input.ctx.siteDomain,
    assertions: [
      {
        label: "stds.schema-org.CreativeWork",
        data: {
          author: input.ctx.author
            ? { name: input.ctx.author.name, url: input.ctx.author.website }
            : undefined,
          datePublished: input.post.publishedAt,
        },
      },
      { label: "c2pa.actions", data: { actions } },
      { label: "c2pa.training-mining", data: { entries: [...training] } },
    ],
  };
}

// ---------- signer interface ----------
export interface SignedManifest {
  manifest: ProvenanceManifest;
  /** Detached signature over the manifest's canonical JSON. */
  signature: string;
  algorithm: "ed25519";
  key_id: string;
}

export interface Signer {
  algorithm: "ed25519";
  keyId: string;
  sign(payload: Uint8Array): Promise<Uint8Array>;
}

export async function signManifest(
  manifest: ProvenanceManifest,
  signer: Signer,
): Promise<SignedManifest> {
  const canonical = canonicalJson({ ...manifest, key_id: signer.keyId });
  const bytes = new TextEncoder().encode(canonical);
  const signature = await signer.sign(bytes);
  return {
    manifest: { ...manifest, key_id: signer.keyId },
    signature: bufferToBase64(signature.buffer.slice(signature.byteOffset, signature.byteOffset + signature.byteLength)),
    algorithm: signer.algorithm,
    key_id: signer.keyId,
  };
}

export async function verifyManifest(input: {
  signed: SignedManifest;
  /** Caller-supplied verifier — typically backed by the public key. */
  verify(payload: Uint8Array, signature: Uint8Array, keyId: string): Promise<boolean>;
}): Promise<boolean> {
  const canonical = canonicalJson(input.signed.manifest);
  const payload = new TextEncoder().encode(canonical);
  const sig = base64ToBuffer(input.signed.signature);
  return input.verify(payload, sig, input.signed.key_id);
}

// ---------- built-in Ed25519 signer ----------
/**
 * Ed25519 signer backed by WebCrypto. Works in Node 18+ and edge
 * runtimes (Cloudflare Workers, Vercel edge, Deno).
 *
 * For production keys, callers should use a KMS-backed signer instead;
 * this convenience implementation is for sites that store the private
 * key in an env var (acceptable for indie deployments but not for
 * regulated content).
 */
export async function createEd25519Signer(opts: {
  /** PKCS#8 PEM or raw 32-byte Ed25519 private key. */
  privateKey: string | Uint8Array;
  keyId: string;
}): Promise<Signer> {
  const key = await importPrivateKey(opts.privateKey);
  return {
    algorithm: "ed25519",
    keyId: opts.keyId,
    async sign(payload) {
      const sig = await crypto.subtle.sign({ name: "Ed25519" } as AlgorithmIdentifier, key, payload);
      return new Uint8Array(sig);
    },
  };
}

async function importPrivateKey(key: string | Uint8Array): Promise<CryptoKey> {
  if (key instanceof Uint8Array) {
    return crypto.subtle.importKey("raw", key, { name: "Ed25519" } as AlgorithmIdentifier, false, ["sign"]);
  }
  // PKCS#8 PEM
  const pem = key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bytes = base64ToBuffer(pem);
  return crypto.subtle.importKey("pkcs8", bytes, { name: "Ed25519" } as AlgorithmIdentifier, false, ["sign"]);
}

// ---------- helpers ----------
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Stable JSON serialization — keys sorted alphabetically at every level
 * so the signed payload is reproducible across runtimes.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
    .join(",")}}`;
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  if (typeof btoa !== "undefined") return btoa(binary);
  // Node fallback.
  return Buffer.from(bytes).toString("base64");
}

function base64ToBuffer(b64: string): Uint8Array {
  if (typeof atob !== "undefined") {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}
