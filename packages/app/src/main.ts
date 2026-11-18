import { bootstrapApplication } from "@angular/platform-browser";

import { AppComponent } from "./app/shell/app-shell.component";
import { appConfig } from "./app/app.config";

bootstrapApplication(AppComponent, appConfig).catch((error: unknown) => {
  console.error("Tanit failed to start", error);
});
