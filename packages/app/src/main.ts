import { CSP_NONCE } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";

import { AppComponent } from "./app/shell/app-shell.component";
import { appConfig } from "./app/app.config";

const styleNonce = document.querySelector<HTMLStyleElement>("#tanit-style-nonce")?.nonce;
const config = styleNonce
  ? { providers: [...appConfig.providers, { provide: CSP_NONCE, useValue: styleNonce }] }
  : appConfig;

bootstrapApplication(AppComponent, config).catch((error: unknown) => {
  console.error("Tanit failed to start", error);
});
