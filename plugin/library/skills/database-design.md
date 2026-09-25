---
name: database-design
triggers: [schema design, database schema, data model, normal form, new table, foreign keys]
source: alirezarezvani/claude-skills · engineering/skills/database-designer/SKILL.md @19392f7 · MIT
---
# Database design

Design from the queries, not the nouns. Before drawing tables, write down the ten hottest reads and writes the application will run; the schema exists to make those cheap and correct. A model built from the domain alone normalises beautifully, then needs six joins for the home page.

**Normalise to third normal form first, then denormalise only for a named query.** The three violations worth hunting: a delimited list or repeating group in one column, a column that depends on part of a composite key, and a column that depends on another non-key column. When you do denormalise, record which query it serves and what keeps the copy in sync, because an undocumented copy drifts.

**Let types and constraints carry the rules.** Every table gets a primary key; every `_id` column that points at another table gets a foreign key with an explicit `ON DELETE`. Booleans are boolean, dates are timestamps, money is decimal or integer cents, never float. Default to `NOT NULL` and make a column nullable only when absence means something. `VARCHAR(255)` on every string means nobody thought about the length.

**Index every foreign key and every hot predicate, and nothing else yet.** In a multi-column index put equality columns first, most selective first, then the range or sort column. A flag like `deleted` rarely earns an index unless it is partial.

Normal forms, index types and the engine decision tree: `vibekit skills reference database-design`.
