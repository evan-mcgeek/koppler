// Spike only: which Svelte Flow extras are switched on, from `?try=minimap,toolbar,snap,visible,children,reconnect`.
export const tries = new Set((new URLSearchParams(location.search).get('try') ?? '').split(',').filter(Boolean));
