import type { Identity } from "../config.js";
import type { JfItem, JfItemsResult, JfSession, PlaystateCommand } from "./types.js";

export type JellyfinErrorKind = "unreachable" | "unauthorized" | "http" | "unconfigured";

export class JellyfinError extends Error {
  constructor(
    readonly kind: JellyfinErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "JellyfinError";
  }
}

/** Ce dont le client a besoin, fourni par ConfigManager (ou un faux dans les tests). */
export interface ClientContext {
  readonly serverUrl: string | undefined;
  readonly identity: Identity;
  readCredentials(force?: boolean): Promise<{ token: string; userId: string } | undefined>;
}

type Query = Record<string, string | number | boolean | undefined>;

interface RequestOptions {
  query?: Query;
  body?: unknown;
  auth?: boolean;
  timeoutMs?: number;
}

/** Interface utilisée par la boucle (permet de la tester avec un faux client). */
export interface JellyfinApi {
  getSessions(): Promise<JfSession[]>;
  play(sessionId: string, itemId: string, startPositionTicks?: number): Promise<void>;
  playstate(sessionId: string, command: PlaystateCommand, query?: Query): Promise<void>;
  command(sessionId: string, name: string, args?: Record<string, string>): Promise<void>;
  getItem(itemId: string): Promise<JfItem>;
  listSeries(): Promise<JfItem[]>;
  listEpisodes(seriesId: string): Promise<JfItem[]>;
}

export interface PublicSystemInfo {
  ServerName?: string;
  Version?: string;
  Id?: string;
  LocalAddress?: string;
}

export interface AuthResult {
  AccessToken: string;
  User: { Id: string; Name: string };
}

const DEFAULT_TIMEOUT_MS = 8000;

export function authorizationHeader(identity: Identity, token?: string): string {
  const quote = (value: string) => value.replace(/"/g, "'");
  const base =
    `MediaBrowser Client="${quote(identity.client)}", Device="${quote(identity.device)}", ` +
    `DeviceId="${quote(identity.deviceId)}", Version="${quote(identity.version)}"`;
  return token ? `${base}, Token="${token}"` : base;
}

async function request(
  serverUrl: string,
  method: string,
  path: string,
  authorization: string,
  options: RequestOptions,
): Promise<Response> {
  const url = new URL(serverUrl + path);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const headers: Record<string, string> = { Authorization: authorization, Accept: "application/json" };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  try {
    return await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === "TimeoutError" ? "délai dépassé" : describe(err);
    throw new JellyfinError("unreachable", `Jellyfin injoignable (${method} ${path} : ${reason})`);
  }
}

async function failure(method: string, path: string, response: Response): Promise<JellyfinError> {
  const text = await response.text().catch(() => "");
  return new JellyfinError(
    "http",
    `${method} ${path} → HTTP ${response.status}${text ? ` : ${text.slice(0, 200)}` : ""}`,
    response.status,
  );
}

/** Infos publiques d'un serveur (sans authentification) : sert à valider une URL. */
export async function fetchPublicInfo(serverUrl: string, identity: Identity): Promise<PublicSystemInfo> {
  const response = await request(serverUrl, "GET", "/System/Info/Public", authorizationHeader(identity), {
    timeoutMs: 4000,
  });
  if (!response.ok) throw await failure("GET", "/System/Info/Public", response);
  return (await response.json()) as PublicSystemInfo;
}

/** Connexion par nom d'utilisateur / mot de passe (remplace auth.py). */
export async function authenticateByName(
  serverUrl: string,
  identity: Identity,
  username: string,
  password: string,
): Promise<AuthResult> {
  const response = await request(serverUrl, "POST", "/Users/AuthenticateByName", authorizationHeader(identity), {
    body: { Username: username, Pw: password },
    timeoutMs: 15000,
  });
  if (response.status === 401) {
    throw new JellyfinError("unauthorized", "Nom d'utilisateur ou mot de passe incorrect.", 401);
  }
  if (!response.ok) throw await failure("POST", "/Users/AuthenticateByName", response);
  const result = (await response.json()) as Partial<AuthResult>;
  if (!result.AccessToken || !result.User?.Id) {
    throw new JellyfinError("http", "Réponse de connexion inattendue : aucun token reçu.");
  }
  return result as AuthResult;
}

export class JellyfinClient implements JellyfinApi {
  constructor(private readonly ctx: ClientContext) {}

  private serverUrl(): string {
    const url = this.ctx.serverUrl;
    if (!url) throw new JellyfinError("unconfigured", "Aucun serveur Jellyfin configuré.");
    return url;
  }

  private async credentials(force = false): Promise<{ token: string; userId: string }> {
    const credentials = await this.ctx.readCredentials(force);
    if (!credentials) throw new JellyfinError("unconfigured", "Pas encore connecté à Jellyfin.");
    return credentials;
  }

  async getUserId(): Promise<string> {
    return (await this.credentials()).userId;
  }

  /** Requête authentifiée : renvoie la réponse HTTP (statut 2xx garanti). */
  async raw(method: string, path: string, options: RequestOptions = {}, retried = false): Promise<Response> {
    const serverUrl = this.serverUrl();
    const { token } = await this.credentials();
    const response = await request(serverUrl, method, path, authorizationHeader(this.ctx.identity, token), options);

    if (response.status === 401) {
      await response.body?.cancel();
      // Le token a peut-être été régénéré : on relit les fichiers une fois.
      if (!retried) {
        await this.credentials(true);
        return this.raw(method, path, options, true);
      }
      throw new JellyfinError("unauthorized", "Token refusé par Jellyfin (401) : se reconnecter dans les réglages.", 401);
    }
    if (!response.ok) throw await failure(method, path, response);
    return response;
  }

  async json<T>(method: string, path: string, options?: RequestOptions): Promise<T> {
    const response = await this.raw(method, path, options);
    return (await response.json()) as T;
  }

  async send(method: string, path: string, options?: RequestOptions): Promise<void> {
    const response = await this.raw(method, path, options);
    await response.body?.cancel();
  }

  // --- Sessions -------------------------------------------------------------

  getSessions(): Promise<JfSession[]> {
    return this.json<JfSession[]>("GET", "/Sessions");
  }

  play(sessionId: string, itemId: string, startPositionTicks = 0): Promise<void> {
    return this.send("POST", `/Sessions/${encodeURIComponent(sessionId)}/Playing`, {
      query: { playCommand: "PlayNow", itemIds: itemId, startPositionTicks },
    });
  }

  playstate(sessionId: string, command: PlaystateCommand, query?: Query): Promise<void> {
    return this.send("POST", `/Sessions/${encodeURIComponent(sessionId)}/Playing/${command}`, { query });
  }

  /** Commande générale. Les valeurs de `Arguments` doivent être des chaînes. */
  command(sessionId: string, name: string, args?: Record<string, string>): Promise<void> {
    return this.send("POST", `/Sessions/${encodeURIComponent(sessionId)}/Command`, {
      body: args ? { Name: name, Arguments: args } : { Name: name },
    });
  }

  // --- Bibliothèque -----------------------------------------------------------

  async getItem(itemId: string): Promise<JfItem> {
    const userId = await this.getUserId();
    return this.json<JfItem>("GET", `/Users/${userId}/Items/${encodeURIComponent(itemId)}`);
  }

  async listSeries(): Promise<JfItem[]> {
    const userId = await this.getUserId();
    const result = await this.json<JfItemsResult>("GET", `/Users/${userId}/Items`, {
      query: { Recursive: true, IncludeItemTypes: "Series", SortBy: "SortName" },
      timeoutMs: 15000,
    });
    return result.Items;
  }

  async listEpisodes(seriesId: string): Promise<JfItem[]> {
    const userId = await this.getUserId();
    const result = await this.json<JfItemsResult>("GET", `/Users/${userId}/Items`, {
      query: {
        ParentId: seriesId,
        Recursive: true,
        IncludeItemTypes: "Episode",
        IsMissing: false,
        Limit: 10000,
      },
      timeoutMs: 20000,
    });
    return result.Items;
  }

  /** Image d'un élément, récupérée côté serveur pour ne jamais exposer le token. */
  image(itemId: string, maxHeight: number): Promise<Response> {
    return this.raw("GET", `/Items/${encodeURIComponent(itemId)}/Images/Primary`, {
      query: { maxHeight, quality: 85 },
      timeoutMs: 15000,
    });
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    return cause?.code ?? cause?.message ?? err.message;
  }
  return String(err);
}
