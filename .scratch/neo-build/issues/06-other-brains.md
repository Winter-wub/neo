# 06: Switch between brains and models

**What to build:** All provider types work and can be chosen: ACP agents over stdio JSON-RPC (permission requests with the 30 s window), OpenAI-compatible endpoints, HTTP providers, acpx registry discovery and ACP probes, custom provider config with API keys from the named `apiKeyFile`/`apiKeyEnv` only. Exposed as `neo provider list|use|discover|config …` and `neo model list|use`, plus the spoken provider/model switch fast phrases. Source: spec §5, §7, neo-command.md.

**Blocked by:** 04 Type a question, get a card

**Status:** done

Spec: [../../neo-split/spec.md](../../neo-split/spec.md)

- [x] `neo provider use <acp agent>` then `neo say` answers through that agent (fake agent binary in tests)
- [x] `neo provider config set <name> --file cfg.json --api-key-stdin` stores the key 0600 in NEO_HOME and never prints it
- [x] `neo model list` shows aliases and models; `neo model use` emits `model` then a card
- [x] Saying "สลับไปใช้ X" / "ใช้โมเดล X" switches without asking the Brain

Parity (from ticket 22): when done, delete the `06` rules from the PENDING list in the contract suite's NeoCli driver and make those tests pass (`cd contract && bun run test:neocli`).
