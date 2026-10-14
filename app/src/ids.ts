// The shapes of the ids Koppler passes between its page, its files and its commands: one place, so each is checked alike.

/** An app, a process or a queue. Never starts with a dash: given to `koppler` as an argument, it must not read as a flag. */
export const APP_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** A run or a Stop. */
export const RUN_ID = /^[a-z0-9]{6,40}$/;
