import type { BrainProvider, Claim, SearchResult, Source } from "./provider.ts";

/**
 * RemoteBrainProvider — routes all queries to the int3_ai backend over HTTPS.
 *
 * The auth token is the user's OIDC Bearer token (set in hermes_config.json
 * at runtime by Gate 4). The backend enforces tenant and scope isolation;
 * this class never second-guesses it.
 */
export class RemoteBrainProvider implements BrainProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly authToken: string
  ) {}

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.authToken}` },
    });
    if (!res.ok) {
      throw new Error(`Brain API GET ${path} returned ${res.status}: ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Brain API POST ${path} returned ${res.status}: ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  async search(query: string, scopes: string[]): Promise<SearchResult[]> {
    return this.post<SearchResult[]>("/v1/search", { query, scopes });
  }

  async getClaim(claimId: string): Promise<Claim> {
    return this.get<Claim>(`/v1/claims/${claimId}`);
  }

  async listSources(scopes: string[]): Promise<Source[]> {
    const params = new URLSearchParams(scopes.map((s) => ["scope", s] as [string, string]));
    return this.get<Source[]>(`/v1/sources?${params.toString()}`);
  }
}
