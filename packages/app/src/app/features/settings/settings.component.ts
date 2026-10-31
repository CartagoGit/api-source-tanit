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
  templateUrl: "./settings.component.html",
  styleUrls: ["./settings.component.scss"],
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