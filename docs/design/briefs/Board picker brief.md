# Board picker in the top bar, in every view

In Discover the bar reads `koppler / Acme Shop / Checkout`: the stack and the board picked from one path.
In Plan and Live the board picker sits instead at the top of the side panel, above Apps (Header design: "Discover: no side panel, so the board picker sits in the bar").
The user wants the board picker in the bar in Plan and Live too, the way Discover has it.

## Why

- The picker stays in one place when the view changes, instead of jumping between the bar and the panel.
- Stack and board are switched from the same spot, and both now behave the same when something runs: switching asks to stop what runs.
- With the side panel closed, Plan and Live have no board picker at all today.
- The side panel then only lists apps, which is what it is for.

## The room it needs (measured at 1280, Acme Shop examples)

| View     | Bar holds                                                                                                                                              | Spare  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Plan     | panel toggle 32, koppler 82, / Acme Shop 113, Discover/Plan/Live 168, QA/PROD 95, 0 running + No agent 181, Activity 109, Settings 94, Stop 93, Run 89 | 95 px  |
| Live     | the same without Run                                                                                                                                   | 194 px |
| Discover | koppler, / Acme Shop, / Web Shop 101, views, envs, Read again 109, Settings 94                                                                         | 425 px |

The picker with a short board name (`/ Web Shop`) takes about 101 px, so Plan is already short at 1280; a real name such as `Checkout (local)` needs about 150 px.
The bar already gives up its words step by step as it narrows (Header design); the board name needs a place in that order.

## To design

1. **The bar in Plan and Live with the board picker**, at 1280 and 1440, with a long board name such as `Checkout (local)` ("(local)" is added when a team board is changed on this Mac). What gives way first as it narrows: the board name truncating, the status chips, the words of Activity, Settings, Stop.
2. **One look for both pickers.** Today in Discover the stack picker is plain text with a chevron (`Acme Shop ⌄`), while the board picker beside it is a boxed field with a hairline border (`[ Web Shop ⌄ ]`). Should they read as one path?
3. **The side panel's top** once the picker leaves it: today a 57 px row holds only the picker, above the `Apps  1 of 4 on the board  Sort: A-Z` heading. Does Apps simply move up?
4. **The board menu itself** (team boards, your boards, new board, share) opening from the bar instead of the panel: its width and where it anchors.

Keep the system's rules: Patch bay type (Barlow, Barlow Semi Condensed, Sometype Mono), square corners, hairlines, sentence-case sans for words.
Names are the Acme Shop examples.
