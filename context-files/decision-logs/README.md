# Decision Logs

Founder-facing audit trail. Each agent appends a short entry here whenever it
makes a non-trivial choice. **Agents write; they do not read these to inform
work** (source of truth is the context files + ADRs).

- Purpose: let the founder track what each builder agent actually did and why,
  without reading every diff.
- Difference from ADRs: ADRs in `../decisions/` are binding architectural
  contracts. These logs are a lightweight running record.
- Format per line: `YYYY-MM-DD  <branch/PR>  — decision — rejected alternative — why`

One file per agent: `architect.md`, `engine-dev.md`, `integrations-dev.md`,
`interface-dev.md`, `qa-test.md`.
