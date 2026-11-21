import { ChangeDetectionStrategy, Component } from "@angular/core";

@Component({
  selector: "tanit-github-mark",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./github-mark.component.html",
  styleUrls: ["./github-mark.component.scss"],
})
export class GitHubMarkComponent {}
