# Working on Koppler

## Golden rule: nobody edits JSON by hand

No user should ever need to open a Koppler JSON file: not `stack.json`, not the state files, not a board.
Every change a user needs has a `koppler` command and a control on the canvas.
A change that would need a hand edit is a missing feature: build the command and the control first.
Agents use the command too wherever one exists.
Where an agent still writes a fact into `stack.json` itself (how an app runs, its ports, its prerequisites), that is a gap to close with a command, not a pattern to copy.
