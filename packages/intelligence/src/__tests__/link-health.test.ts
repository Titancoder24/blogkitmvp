import { describe, expect, it } from "vitest";
import {
  checkLink,
  checkLinksBatch,
  extractExternalLinks,
  type LinkFetcher,
} from "../link-health.js";

function fetcher(plan: Record<string, { status: number; location?: string }>): LinkFetcher {
  return async (url) => {
    const entry = plan[url];
    if (!entry) throw new Error("network error");
    const headers = new Map<string, string | null>([
      ["location", entry.location ?? null],
    ]);
    return {
      status: entry.status,
      headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
    };
  };
}

describe("checkLink", () => {
  it("classifies 2xx as healthy", async () => {
    const probe = await checkLink("https://ok.example", {
      fetch: fetcher({ "https://ok.example": { status: 200 } }),
    });
    expect(probe.status).toBe("healthy");
    expect(probe.httpStatus).toBe(200);
  });

  it("classifies 3xx as redirect with target", async () => {
    const probe = await checkLink("https://r.example", {
      fetch: fetcher({
        "https://r.example": { status: 301, location: "https://r.example/new" },
      }),
    });
    expect(probe.status).toBe("redirect");
    expect(probe.redirectTarget).toBe("https://r.example/new");
  });

  it("classifies 4xx/5xx as broken", async () => {
    const broken = await checkLink("https://gone.example", {
      fetch: fetcher({ "https://gone.example": { status: 404 } }),
    });
    expect(broken.status).toBe("broken");
    expect(broken.httpStatus).toBe(404);
  });

  it("falls back to GET on 405 / 501", async () => {
    let calls = 0;
    const fallback: LinkFetcher = async (_url, init) => {
      calls += 1;
      if (init.method === "HEAD") {
        return { status: 405, headers: { get: () => null } };
      }
      return { status: 200, headers: { get: () => null } };
    };
    const probe = await checkLink("https://h.example", { fetch: fallback });
    expect(calls).toBe(2);
    expect(probe.status).toBe("healthy");
  });

  it("classifies network errors as broken", async () => {
    const probe = await checkLink("https://x.example", {
      fetch: fetcher({}),
    });
    expect(probe.status).toBe("broken");
    expect(probe.httpStatus).toBeNull();
  });
});

describe("checkLinksBatch", () => {
  it("probes every URL with bounded concurrency", async () => {
    const urls = ["https://a", "https://b", "https://c"];
    const seen: string[] = [];
    const probes = await checkLinksBatch(urls, {
      concurrency: 2,
      fetch: async (url) => {
        seen.push(url);
        return { status: 200, headers: { get: () => null } };
      },
    });
    expect(probes).toHaveLength(3);
    expect(seen.sort()).toEqual(urls);
  });
});

describe("extractExternalLinks", () => {
  const own = ["acme.example"];

  it("pulls markdown links and skips own-domain", () => {
    const body = `See [docs](https://acme.example/docs) and [research](https://other.com/r).`;
    const links = extractExternalLinks(body, own);
    expect(links.map((l) => l.url)).toEqual(["https://other.com/r"]);
  });

  it("pulls HTML anchor tags", () => {
    const body = `<a href="https://x.com/post">post</a>`;
    const links = extractExternalLinks(body, own);
    expect(links[0]?.url).toBe("https://x.com/post");
    expect(links[0]?.anchor).toBe("post");
  });

  it("dedupes the same URL across forms", () => {
    const body = `[ref](https://other.com/x) and https://other.com/x and <a href="https://other.com/x">x</a>`;
    const links = extractExternalLinks(body, own);
    expect(links).toHaveLength(1);
  });
});
