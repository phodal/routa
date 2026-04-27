import http from "node:http";

export interface RoutaWorkspace {
  id: string;
  title: string;
  status?: string;
  metadata?: Record<string, string>;
}

export interface RoutaCodebase {
  id: string;
  workspaceId?: string;
  repoPath: string;
  label?: string;
  branch?: string;
  isDefault?: boolean;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
}

export class HttpStatusError extends Error {
  constructor(
    readonly statusCode: number,
    readonly responseBody: string,
  ) {
    super(`HTTP ${statusCode}: ${responseBody || "empty response"}`);
    this.name = "HttpStatusError";
  }
}

export class RoutaClient {
  constructor(readonly baseUrl: string) {}

  async health(): Promise<unknown> {
    return this.requestJson("/api/health");
  }

  async listWorkspaces(): Promise<RoutaWorkspace[]> {
    const data = await this.requestJson<{ workspaces?: RoutaWorkspace[] }>("/api/workspaces?status=active");
    return data.workspaces ?? [];
  }

  async getWorkspace(id: string): Promise<RoutaWorkspace | null> {
    try {
      const data = await this.requestJson<{ workspace?: RoutaWorkspace }>(
        `/api/workspaces/${encodeURIComponent(id)}`,
      );
      return data.workspace ?? null;
    } catch (error) {
      if (error instanceof HttpStatusError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async createWorkspace(title: string, metadata: Record<string, string>): Promise<RoutaWorkspace> {
    const data = await this.requestJson<{ workspace: RoutaWorkspace }>("/api/workspaces", {
      method: "POST",
      body: { title, metadata },
    });
    return data.workspace;
  }

  async listCodebases(workspaceId: string): Promise<RoutaCodebase[]> {
    const data = await this.requestJson<{ codebases?: RoutaCodebase[] }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/codebases`,
    );
    return data.codebases ?? [];
  }

  async addCodebase(
    workspaceId: string,
    input: {
      repoPath: string;
      label?: string;
      branch?: string;
      isDefault?: boolean;
    },
  ): Promise<RoutaCodebase | null> {
    try {
      const data = await this.requestJson<{ codebase?: RoutaCodebase }>(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/codebases`,
        {
          method: "POST",
          body: {
            repoPath: input.repoPath,
            label: input.label,
            branch: input.branch,
            isDefault: input.isDefault ?? true,
            sourceType: "local",
          },
        },
      );
      return data.codebase ?? null;
    } catch (error) {
      if (error instanceof HttpStatusError && error.statusCode === 409) {
        return null;
      }
      throw error;
    }
  }

  private requestJson<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(path, this.baseUrl);
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);

    return new Promise<T>((resolve, reject) => {
      const req = http.request(
        url,
        {
          method: options.method ?? "GET",
          headers: {
            Accept: "application/json",
            ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const responseBody = Buffer.concat(chunks).toString("utf8");
            const statusCode = res.statusCode ?? 0;
            if (statusCode < 200 || statusCode >= 300) {
              reject(new HttpStatusError(statusCode, responseBody));
              return;
            }

            if (!responseBody.trim()) {
              resolve({} as T);
              return;
            }

            try {
              resolve(JSON.parse(responseBody) as T);
            } catch (error) {
              reject(error);
            }
          });
        },
      );

      req.on("error", reject);
      req.setTimeout(1500, () => {
        req.destroy(new Error(`Request timed out: ${url.toString()}`));
      });

      if (body) {
        req.write(body);
      }
      req.end();
    });
  }
}
