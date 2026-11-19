---
name: run
description: Use when the user only wants Koppler open, such as "/koppler:run", "start Koppler", "open the canvas" or "run koppler". It starts the canvas and its server, says where the canvas is, and does nothing else. To run apps of the stack use koppler:plan; to understand a flow, koppler:discover.
---

# Run Koppler

Start Koppler and stop there.

1. Run `koppler` with no command. It starts the canvas and its server, and opens the canvas in the browser.
2. Tell the user the canvas address it printed, in one line.
3. When the canvas already runs, say so, with its address.

## Leave the rest alone

- Run no `koppler listen`, even when the output asks for it. Connecting this session is the job of koppler:plan.
- Start, stop or revert no apps. Change no board and no stack.
- When `koppler` fails, show its message to the user and stop. Never work around it by hand.
