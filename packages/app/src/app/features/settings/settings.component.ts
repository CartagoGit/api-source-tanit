import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { SecureStorageService } from "../../core/host/secure-storage.service";

/**
 * The settings.
 *
 * The API key is the only secret the app holds. Where it goes is
 * said out loud: the operating system's keychain on the desktop,
 * this window's memory in the browser. The screen used to say
 * "saved securely" in both cases, which is a lie in one of them.
 *
 * The buttons also **say when they failed**: `save()` had no
 * `try`, so a storage that rejected left the promise unhandled and
 * the screen with no message at all.
 */
@Component({
  selector: "tanit-settings",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section aria-labelledby="settings-title"><h2 id="settings-title">Settings</h2><label>Postman API key <input type="password" [value]="key()" (input)="key.set(inputValue($event))" autocomplete="off" /></label><label><input type="checkbox" [checked]="sessionOnly()" (change)="sessionOnly.set(checked($event))" /> Use for this session only</label><p class="where">{{ storage.describeWhere() }}</p><button type="button" [disabled]="running()" (click)="save()">{{ running() ? "Saving…" : "Save key" }}</button><button type="button" [disabled]="running()" (click)="forget()">Forget key</button>@if (message(); as value) { <p role="status">{{ value }}</p> }@if (failure(); as value) { <p role="alert">{{ value }}</p> }</section>`,
  styles: `.where { color: var(--color-muted); font-size: 12px; }`,
})
export class SettingsComponent {
  readonly key = signal("");
  readonly sessionOnly = signal(false);
  readonly message = signal<string | null>(null);
  readonly failure = signal<string | null>(null);
  readonly running = signal(false);
  readonly storage = inject(SecureStorageService);
  private readonly service = "postman-api-key";

  async save(): Promise<void> {
    if (this.key().trim() === "") {
      this.failure.set("Type the key before saving it.");
      return;
    }
    this.running.set(true);
    this.message.set(null);
    this.failure.set(null);
    try {
      if (this.sessionOnly()) this.storage.saveSession(this.service, this.key());
      else await this.storage.save(this.service, this.key());
      this.key.set("");
      this.message.set(
        this.sessionOnly()
          ? "API key kept for this session only."
          : this.storage.describeWhere(),
      );
    } catch (error) {
      this.failure.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.running.set(false);
    }
  }

  async forget(): Promise<void> {
    this.running.set(true);
    this.message.set(null);
    this.failure.set(null);
    try {
      await this.storage.delete(this.service);
      this.key.set("");
      this.message.set("API key removed.");
    } catch (error) {
      this.failure.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.running.set(false);
    }
  }

  inputValue(event: Event): string { return (event.target as HTMLInputElement).value; }
  checked(event: Event): boolean { return (event.target as HTMLInputElement).checked; }
}