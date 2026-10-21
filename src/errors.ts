/** Erreur destinée au client HTTP de l'API (message affiché tel quel dans l'interface). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
