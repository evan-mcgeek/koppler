# Glossary

**Area**
A part of a big stack a person can choose to see, such as Payments or Shipping, defined once under `areas` in the stack.
An app is in any number of areas, and an app in none shows in every area.
A board's area is set by hand, or else is the area most of its apps are in.
A view only: runs, environments and secrets stay the same.

**Category**
What a card on Discover's map is, worked out from the stack's facts.
It is a service or client, a job or function, an outside system, a queue or topic, a database, or a cloud resource.
An app with a `schedule`, or of kind `lambda` or `workflow`, is a job; one of kind `compose` is a database.
Discover's **Show** menu hides a whole category, or one queue type, in this browser.

**Plain words**
The writing rules of Simplified Technical English (ASD-STE100) that Koppler holds its text to.
They ask for one idea a sentence and the active voice.
An instruction or a step's summary has at most 20 words, and a description at most 25.
`koppler board edit` refuses a summary that breaks them.

**Step**
One link a feature board uses, numbered by its phase: `2.3` is the third step of the second phase.
It says what happens in three parts.
The **summary** is one plain sentence the panel shows.
The **values** are the names it uses under one-word labels such as Route or Flag.
The agent's **note** holds its findings in full.
