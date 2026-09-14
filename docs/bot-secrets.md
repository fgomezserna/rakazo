# Reusable API credentials

Ask a bot to connect an API using a key or password. It calls `request_secret` with a reference name and an HTTPS service origin. The protected card shows that origin before you save. Web, Electron and mobile use the same backend; the value is cleared from the input when submission starts and is omitted from messages, events and model input.

For example, the bot can request:

```json
{
  "label": "API key",
  "purpose": "api_key",
  "credential": {
    "name": "example_api",
    "origin": "https://api.example.test",
    "auth": { "type": "bearer" }
  }
}
```

The value is encrypted in Postgres `bot_secrets` using the deployment's `ENCRYPTION_KEY` (AES-256-GCM with record-bound authentication). Only the run's user can submit a reusable credential. It belongs to that user, space and bot, survives later runs, and is deleted when its owner, space or bot is deleted. Names, destinations and authentication configuration are metadata; `list_secrets` returns those fields without values. No hosted credential service or prebuilt connector is required.

The bot uses `secret_request` to ask the backend to decrypt and inject the credential:

```json
{
  "name": "example_api",
  "url": "https://api.example.test/v1/items",
  "method": "GET"
}
```

Authentication supports Bearer tokens, a named header (`{"type":"header","name":"X-Api-Key"}`), and Basic authentication (`{"type":"basic","username":"api-user"}`). Basic uses the protected value as the password. Requests can send JSON, form-encoded or plain text bodies. The saved origin must match exactly, including port. Redirects and unsafe network destinations are rejected through the shared remote-request policy. Requests follow the existing action approval rules, have a 30-second deadline and a 1 MB response limit, and return at most 20,000 characters of redacted response content without response headers.

Calling `request_secret` again with the same name and configuration returns the saved reference. Add `"replace": true` to show another protected card and replace its value. `forget_secret` with `{"name":"example_api"}` removes the stored value and prevents future use; an already-started request may finish. Remove a credential before changing its origin or authentication configuration. Each user can save up to 100 credentials per bot, with values limited to 16,384 characters.

The model has no tool for reading saved credential values, and the backend removes direct and common encoded echoes from API responses. The approved service still receives the credential: redaction cannot defend against a malicious service deliberately transforming it. Choose a service you trust and use appropriately scoped credentials.

## Capture from a bot computer

When a one-time token is already visible in a bot's computer, the bot may click the site's **Copy** control and then call `capture_secret_from_clipboard` with the exact credential destination. By default it is saved for that bot; pass exactly one `target_bot_id` or `target_name` to save it directly for another active bot owned by the same user in the same organization, avoiding a second delegation step. This is an explicit-approval action: the provider consumes and clears the computer's plain-text clipboard, the backend validates and encrypts the value, and the tool returns metadata only. The token is never placed in model input, chat, files, logs, shell command arguments or prompts. This is deliberately a one-shot credential capture, not a general clipboard-reading tool.

If the computer provider cannot capture its clipboard, use the protected `request_secret` card instead. Use `delegate_secret` only when the credential was already saved on a bot and needs a separate approved bot-to-bot transfer.

## Explicit bot-to-bot transfer

When the user explicitly asks one of their bots to pass a saved credential to another of their bots, either bot can call `delegate_secret`: the source uses `target_bot_id`/`confirm_name`, while the destination uses `source_bot_id`/`source_name`. The action always pauses for user approval, verifies that both bots belong to the same user and organization, and creates an independent credential in the destination bot's scope. The backend decrypts and re-encrypts the value in memory; the value is never returned to the model, sent through `message_bot`, or written to chat, files, prompts, or shell commands. The destination can then use its own `list_secrets` and `secret_request` flow. Revoke or replace the destination copy independently when needed.

This boundary supports authenticated HTTP requests. Injecting credentials into arbitrary AI-controlled shell commands, files or environment variables would let those commands read them, so those paths are not exposed. APIs needing request signing, OAuth refresh, multiple credentials or custom protocols should use a connector adapter. Existing `request_secret` calls with a `connectionId` retain their one-use connector-code flow; website sign-in uses `request_takeover`.
