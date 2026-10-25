// What the top bar's menus open: each popover says how it opens, under the control that asked for it.
type Opens = (from?: HTMLElement) => void;
export const opens: {
  history?: Opens;
  credentials?: Opens;
  settings?: Opens;
  help?: Opens;
  connect?: Opens;
} = {};
/** How many credentials the apps on the board need and do not have stored, for the menu that holds Credentials. */
export const credentials = $state({ missing: 0 });
