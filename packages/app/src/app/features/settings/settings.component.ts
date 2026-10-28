import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { SecureStorageService } from "../../core/host/secure-storage.service";

@Component({
  selector: "tanit-settings",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section aria-labelledby="settings-title"><h2 id="settings-title">Settings</h2><label>Postman API key <input type="password" [value]="key()" (input)="key.set(inputValue($event))" autocomplete="off" /></label><label><input type="checkbox" [checked]="sessionOnly()" (change)="sessionOnly.set(checked($event))" /> Use for this session only</label><button type="button" (click)="save()">Save key</button><button type="button" (click)="forget()">Forget key</button>@if (message(); as value) { <p role="status">{{ value }}</p> }</section>`,
})
export class SettingsComponent {
  readonly key = signal("");
  readonly sessionOnly = signal(false);
  readonly message = signal<string | null>(null);
  private readonly storage = inject(SecureStorageService);
  private readonly service = "postman-api-key";

  async save(): Promise<void> {
    if (this.sessionOnly()) this.storage.saveSession(this.service, this.key());
    else await this.storage.save(this.service, this.key());
    this.key.set("");
    this.message.set(this.sessionOnly() ? "API key kept for this session only." : "API key saved securely.");
  }
  async forget(): Promise<void> { await this.storage.delete(this.service); this.key.set(""); this.message.set("API key removed."); }
  inputValue(event: Event): string { return (event.target as HTMLInputElement).value; }
  checked(event: Event): boolean { return (event.target as HTMLInputElement).checked; }
}