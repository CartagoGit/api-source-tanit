import { ChangeDetectionStrategy, Component, input } from "@angular/core";

@Component({
  selector: "tanit-button",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./button.component.html",
  styleUrls: ["./button.component.scss"],
})
export class ButtonComponent {
  readonly primary = input(false);
  readonly type = input<"button" | "submit">("button");
}
