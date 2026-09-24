---
name: threat-model
triggers: [threat model, threat modeling, stride, attack surface, trust boundary, dread score]
source: alirezarezvani/claude-skills · engineering-team/skills/senior-security/SKILL.md @19392f7 · MIT
---
# Threat model

Draw the data flow before listing threats. Name every external entity, process, data store and flow, and mark each trust boundary a flow crosses. Threats live at the boundaries; a model without them is a list of worries.

**STRIDE per element, not per system.** Ask only the questions that fit the element: an external entity can be spoofed or repudiate; a data flow can be tampered with, disclosed or flooded; a data store adds repudiation; a process gets all six. Write one concrete scenario per applicable letter, with its attack vector, before moving on. An element with no row was not analysed.

**Score with DREAD, then act on the number.** Rate damage, reproducibility, exploitability, affected users and discoverability from 1 to 10 and average them. At 7 or above, the threat needs a named owner and a mitigation before the design ships; below 4, record it as accepted risk with a reason. Match the mitigation to the property violated: spoofing to authentication, tampering to integrity checks, repudiation to tamper-evident logs, disclosure to encryption and access control, denial to rate limits, elevation to server-side authorisation.

**Close the loop.** While the code is open, sweep it for hardcoded keys, tokens and private keys; any hit blocks merge until rotated and moved to a secret manager. The done signal is a re-check after mitigations land, not the document.

The full source, with scoring rubrics and attack trees: `vibekit skills reference threat-model`.
