# Puffer Architecture Documentation

This directory holds the architectural blueprint for Puffer, originally
authored as the single `PUFFER-GUIDE.md` at the repo root. It has been
split by topic so contributors can navigate each concern independently.

| Document                                               | Covers                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| [overview.md](./overview.md)                           | Project identity, high-level architecture, repo structure                      |
| [implementation-phases.md](./implementation-phases.md) | The 6 build phases (proxy, discovery, 7-layer pipeline, CLI, dashboard, hooks) |
| [operations.md](./operations.md)                       | Configuration system + audit logging                                           |
| [testing.md](./testing.md)                             | Testing strategy and adversarial test approach                                 |
| [packaging-and-release.md](./packaging-and-release.md) | npm packaging, docs, build order, final notes                                  |

For day-to-day product info (install, commands, supported agents), see the
[root README](../../README.md). For active refactor progress, see
[../PROGRESS.md](../PROGRESS.md).
