import { HashLocationStrategy, LocationStrategy, PathLocationStrategy, PlatformLocation } from "@angular/common";
import { ApplicationConfig, inject } from "@angular/core";

export const appConfig: ApplicationConfig = {
  providers: [{
    provide: LocationStrategy,
    useFactory: () => {
      const platform = inject(PlatformLocation);
      return "__TAURI__" in globalThis
        ? new HashLocationStrategy(platform)
        : new PathLocationStrategy(platform);
    },
  }],
};
