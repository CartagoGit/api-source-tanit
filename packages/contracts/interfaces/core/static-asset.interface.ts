/**
 * The shapes of the static assets the local servers serve.
 *
 * They are contracts because **two** servers speak them —the web
 * interface the CLI serves and the desktop app in the browser— and
 * because the app reads the token off the served page. The server that
 * reads the file and the one that builds the response are different
 * files; what they agree on is what they say.
 */

/** Where in the served HTML the token is planted. */
export type TokenTarget = "html" | "script";

/** A file that was found and read. */
export interface IAsset {
  /** Its contents, as text. */
  readonly contents: string;
  /** The content type to serve it with. */
  readonly type: string;
  /** Whether it is the page (and so where the token goes). */
  readonly isPage: boolean;
}
