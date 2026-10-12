# Development

## Packages

| Package | What it is |
|---|---|
| `packages/core` | Engine: assess / plan / coach. Depends on interfaces only. |
| `packages/providers` | LLM provider interface and the `AnthropicProvider`, `OpenAICompatibleProvider` and `OllamaProvider` adapters. |
| `packages/storage` | Storage interface and `LocalFileStorageAdapter` (local files). |
| `packages/curriculum` | The read-only problem catalog (links and difficulty). |
| `packages/cli` | The `ibai` CLI: `assess`, `plan`, `coach`. Frozen; the web app is the product. |
| `packages/web` | The localhost server and the React app: Home, Notes, Interview (quiz), Analytics, Data, Settings. |

Details: [packages/web/README.md](../packages/web/README.md),
[packages/cli/README.md](../packages/cli/README.md),
[packages/storage/README.md](../packages/storage/README.md),
[packages/providers/README.md](../packages/providers/README.md),
[packages/curriculum/README.md](../packages/curriculum/README.md).

## Build and verify

```bash
npm ci
npm run verify   # typecheck -> lint -> format -> build -> test
```

`npm start` builds what is out of date, then starts the server. It needs
`npm ci` first.

## Run

```bash
npm start                             # web app: http://127.0.0.1:4173/
node packages/cli/dist/cli.js --help  # CLI (frozen; after a build)
```

The server listens on 127.0.0.1 only. On start it prints the address, the
data folder and the provider (never a key).

## Contributing

Project context, architecture notes, ADRs and current status are kept as
local maintainer notes and are not published in this repository. ADR numbers
cited in the docs and code (for example "ADR 0015") refer to those notes.
