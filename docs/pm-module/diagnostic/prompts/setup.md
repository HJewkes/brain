I just installed brain (npm install -g @titan-design/brain). Help me set up project management for ~/Documents/projects/voltras-workspace

First, run `brain init --notes-dir ~/brain --embedder local` to initialize the database and index reference documentation (including PM command docs). Wait for it to complete before proceeding.

Then use `brain pm onboard "voltras-workspace" --prefix VOLT` — always pass `--prefix VOLT` explicitly. Do not omit the --prefix flag or let it auto-derive.
