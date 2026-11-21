import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { I18nService } from "../../core/i18n/i18n.service";

@Component({ selector: "tanit-help", standalone: true, changeDetection: ChangeDetectionStrategy.OnPush, templateUrl: "./help.component.html", styleUrls: ["./help.component.scss"] })
export class HelpComponent { readonly i18n = inject(I18nService); }
