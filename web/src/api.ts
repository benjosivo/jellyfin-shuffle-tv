// Appels à l'API du backend (jamais directement à Jellyfin).

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Serveur injoignable.");
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(response.status, data.error ?? `Erreur ${response.status}`);
  }
  // 202/204 : réponse sans corps (ex. POST /update), rien à décoder.
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(path: string) => call<T>("GET", path),
  post: <T = void>(path: string, body?: unknown) => call<T>("POST", path, body ?? {}),
  put: <T = void>(path: string, body: unknown) => call<T>("PUT", path, body),
  patch: <T = void>(path: string, body: unknown) => call<T>("PATCH", path, body),
  del: <T = void>(path: string) => call<T>("DELETE", path),
};

export const imageUrl = (itemId: string, maxHeight = 300) => `/api/image/${encodeURIComponent(itemId)}?maxHeight=${maxHeight}`;
