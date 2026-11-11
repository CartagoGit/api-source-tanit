# Optional remote AI enrichment — provider research

**Checked:** 2026-11-11. **Result:** no eligible provider has been verified for
product integration. S1 is research only; no provider is configured, and S2
must remain pending until a provider passes the checks below.

## Requirements

The deterministic scan must be shown first. Remote requests are optional,
explicitly enabled, limited to unresolved endpoint descriptions or fields, and
must not delay or replace the static result. Never send whole repositories,
secrets, personal or regulated data. A provider must permit use in an
application distributed to end users, with a documented destination, privacy
policy, current model and limits. A successful free-tier request alone does
not establish production permission or acceptable data handling.

## Checks on 2026-11-11

| Provider / route | Evidence | Decision |
| --- | --- | --- |
| llmfaucet | [Official repository](https://github.com/llmfaucet/llmfaucet) advertises anonymous access, 20 requests/day/IP and warns that capacity may disappear. It says `/v1/chat/completions` is in progress and public model/status endpoints are planned. `llmfaucet.dev` and `api.llmfaucet.dev` did not resolve in this environment; official docs and status pages returned 502. No inference request was sent. | Not verified: endpoint, terms/privacy and current capacity unavailable. The DNS observation is local, not evidence of a global outage. |
| LLM7 API | [Current terms](https://github.com/chigwell/llm7.io/blob/main/TERMS.md) and [privacy policy](https://llm7.io/privacy) say API access requires a token issued through its dashboard. | Excluded: account/token requirement. |
| Pollinations generation API | [Current API docs](https://github.com/pollinations/pollinations/blob/main/gen.pollinations.ai/src/docs/apidocs-recipes.md) require a bearer key for generation; only model catalogs and media reads are public without authentication. | Excluded: generation requires authentication. |
| Kilo Gateway — old documented ID | Kilo docs listed `z-ai/glm-5:free`; an unauthenticated, synthetic request to `/api/v1/chat/completions` on 2026-11-11 returned HTTP 404: `The requested model 'z-ai/glm-5:free' does not exist`. | The documented ID was stale; this result does not establish that the gateway or all models are unavailable. |
| Kilo Gateway — current catalog ID | The unauthenticated [public model catalog](https://ai-gateway.kilo.ai/api/v1/models) returned `nvidia/nemotron-3.5-lightning:free` with prompt and completion prices `0`; Kilo documents free models as unauthenticated and rate-limited to 200 requests/hour/IP ([authentication](https://kilo.ai/docs/gateway/authentication), [usage limits](https://kilo.ai/docs/gateway/usage-and-billing)). One synthetic request on 2026-11-11 00:36:34 UTC, with no Authorization header and prompt `Reply with exactly OK.`, returned HTTP 200, `cost: 0`, `is_byok: false`, but `message.content` was null and the 16-token completion ended with `finish_reason: length`. | Endpoint and this model responded at zero cost, but the model is not eligible for product use. |

### Kilo/NVIDIA conditions and investigation sequence

The [Kilo terms](https://kilo.ai/terms) permit using its API in an app for end
users only subject to their terms and require the app operator to ensure users
understand and comply. Kilo's terms grant it a broad, perpetual, sublicensable
license to submitted customer data to provide and improve Kilo products; the
applicable model provider's terms also apply. Kilo says some free models require
data collection to be allowed. Its provider catalog marks NVIDIA as retaining
prompts and training on them, and links NVIDIA's [API Trial Terms](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf).

Those NVIDIA terms state that use affirms agreement, limit the service to trial
and evaluation rather than production, prohibit distributing or making the API
service or generated content available to others, and allow logging and use of
content to improve products/models. They prohibit confidential, personal,
regulated or sensitive input. Thus the tested NVIDIA model cannot serve as the
provider for this product, despite its public zero-cost route. The policy
catalog describes the upstream provider; it is not by itself a complete
retention guarantee for Kilo and every intermediary.

The synthetic POST happened before the linked NVIDIA trial terms were read.
This record does not conclude that the user accepted those terms; it records
that the terms say using the API affirms agreement and that the check order was
wrong. The request contained no project data, credentials, account identifier
or payment information. No further inference requests were made.

## Decision and next check

No route checked here satisfies all requirements for a distributed product:
llmfaucet could not be verified, LLM7 requires a token, Pollinations requires
authentication, and the tested Kilo/NVIDIA free model is trial-only and bars
production distribution. A free browser chat page is not evidence of an
anonymous supported API; do not infer an API for ChatGPT or Gemini from their
consumer web chat.

Before S2, independently verify a current anonymous endpoint and model, zero
cost, rate limits, application/distribution permission, provider chain,
retention/training policy and failure behavior. Review the exact provider terms
before any synthetic POST. If no candidate passes, keep enrichment unavailable
and leave static analysis usable. Do not add a user-managed relay or require an
account, key, payment, local model or user infrastructure.
