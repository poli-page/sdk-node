# SDK spec updates (v1.0 prep)

Edits to apply to the platform repo's
`docs/onboarding/micka/sdk-specification.md` to bring the multi-language SDK
contract in line with the Node SDK's v1.0 retry-policy and error-code
behavior. Captured here so the changes don't drift between repos — apply
them by hand to the platform repo when convenient.

---

## §6.4 — replace the non-API errors table

**Find:**

```md
| Code            | Cause                                                |
| --------------- | ---------------------------------------------------- |
| `network_error` | DNS, connection refused, TLS failure, etc.           |
| `timeout`       | Per-request timeout exceeded (see §3.2 `timeout`).   |
```

**Replace with:**

```md
| Code              | Cause                                                |
| ----------------- | ---------------------------------------------------- |
| `network_error`   | DNS, connection refused, TLS failure, etc.           |
| `timeout`         | Per-request timeout exceeded (see §3.2 `timeout`).   |
| `aborted`         | Caller cancelled the request via `AbortSignal`.      |
| `invalid_options` | Constructor option missing or malformed (e.g. empty `apiKey`). |
```

---

## §7.1 — replace the retry-policy bullet list

**Find:**

```md
- Only **5xx responses** are retried.
- **4xx responses are never retried** — they indicate a client error and retrying will not help.
- Network errors and timeouts **are retried** (treated as transient).
- A maximum of `maxRetries` additional attempts after the initial one (so default 2 retries = up to 3 total attempts).
- Backoff is **exponential**: the delay before retry N is `retryDelay * 2^(N-1)`.
```

**Replace with:**

```md
- **5xx responses** and **429 Too Many Requests** are retried.
- **Other 4xx responses are never retried** — they indicate a client error and retrying will not help.
- Network errors and timeouts **are retried** (treated as transient).
- A maximum of `maxRetries` additional attempts after the initial one (so default 2 retries = up to 3 total attempts).
- Backoff is **exponential**: the delay before retry N is `retryDelay * 2^(N-1)`, with jitter (see §7.2).
- When the response carries a **`Retry-After`** header (seconds or HTTP-date), the SDK honors it as the next delay, capped at 30 seconds. Past-dated HTTP-date values are treated as immediate retry. **No jitter is applied when `Retry-After` is present** — the server is being explicit.
```

---

## §7.2 — replace the entire "Default schedule" subsection

**Replace §7.2 with:**

```md
### 7.2 Default schedule

When `Retry-After` is **absent**, the delay before retry N is computed as:

`delay = retryDelay * 2^(N-1) * jitter`, where `jitter` is a random factor in `[0.5, 1.5]`.

| Attempt | Base delay (default `retryDelay = 500`) | With jitter (range)         |
| ------- | --------------------------------------- | --------------------------- |
| 1st     | Immediate                               | —                           |
| 2nd     | `500 ms`                                | `[250 ms, 750 ms]`          |
| 3rd     | `1000 ms`                               | `[500 ms, 1500 ms]`         |

When `Retry-After` is **present**, its value (capped at 30 s) is used as-is — no jitter, no exponential backoff.
```

---

## Suggested commit message (for the platform repo, when applied)

```
docs(spec): retry policy honors Retry-After, includes 429 and jitter
```
