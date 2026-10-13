# Working on Koppler

## Golden rule: nobody edits JSON by hand

Nobody writes a Koppler JSON file directly: not `stack.json`, not the state files, not a board.
That holds for users and for agents alike, with no exceptions.
Every change goes through a `koppler` command, and every change that is the user's to make also has a control on the canvas.
A change with no command yet is a missing feature: build the command (and the control) first, then make the change with it.
