### Added
- Factory Droid joins the agent catalog: Chat reads its native session log, and its permission
  and AskUser prompts can be answered from Chat (a choice per question, tabs across a
  questionnaire, and a typed custom answer).
- Droid's `/` commands and skills are listed in Chat from the catalog cache its running agent
  writes.
- Pictures in a Droid session — a prompt's own, or one a tool returned — show in Chat and open in
  the viewer.
- A Droid subagent or background Execute that ends after its turn shows as the background-task
  card, with its report on request, rather than as a user prompt.
- A Droid compaction shows where the conversation was folded, with its summary.

### Fixed
- A long free-text answer to a Droid AskUser prompt is submitted whole, and a row clicked while
  droid's free-text editor is open leaves the editor before answering.
